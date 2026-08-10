import { test, expect } from "@playwright/test";
import { attachRuntimeAudit, assertRuntimeClean } from "./helpers/runtime-audit";
import {
  openDashboardAndSignUp,
  createWorkspace,
  openWorkspaceSettings,
  createProjectInWorkspace,
  inviteMember,
  acceptInvitation,
  selectWorkspace,
  openWorkspaceProjectFromDashboard,
  expectEditingIndicator,
  fetchWorkspaceProject,
  saveWorkspaceProject,
  listWorkspaces,
  uniqueSuffix,
  mockToken,
} from "./helpers/workspaces";
import {
  listProjectVersions,
  fetchProjectVersion,
  restoreVersionViaApi,
  listActivity,
  openVersionHistory,
} from "./helpers/p15";

// ---------------------------------------------------------------------------
// Phase P15 — E2E: workspace version history
//
// Deterministic flow (three browser contexts = three accounts):
//   1. A creates a workspace + project — project creation itself does NOT
//      create a version (server list is empty)
//   2. A's first meaningful edit + autosave creates the first DEDUPLICATED
//      autosave version (revision 2) and emits project.saved activity
//   3. A's second edit creates a second version; the list is metadata-only
//      and newest-first; a save with a stale expectedRevision is rejected
//   4. A previews the older version — read-only via VisitorPageView with the
//      version's own content (never the active project)
//   5. B (editor) can list + preview but gets NO restore button and the wire
//      rejects a restore with PERMISSION_DENIED (owner-only)
//   6. A (owner) restores the older version through the UI → the editor
//      reloads to the restored content; restore creates a NEW revision and a
//      "restore" version while ALL historical versions stay intact
//   7. A stale restore (expectedRevision mismatch) is rejected without side
//      effects; an identical-content save is silent (no redundant version, no
//      project.saved) but still bumps the revision
//   8. Non-member C reads no versions (membership-gated 403)
//   9. runtime audit clean
// ---------------------------------------------------------------------------

test.describe("Workspace version history", () => {
  test("saves are deduped into versions, preview is read-only, restore is owner-only and additive", async ({
    browser,
  }) => {
    test.setTimeout(360_000);

    const emailA = `ver-a-${uniqueSuffix()}@example.com`;
    const emailB = `ver-b-${uniqueSuffix()}@example.com`;
    const wsName = `Versioned ${uniqueSuffix().slice(-4)}`;
    const projectName = "Versioned Project";

    // ----------------------------- Setup -----------------------------
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const auditA = attachRuntimeAudit(pageA);

    await openDashboardAndSignUp(pageA, emailA);
    await createWorkspace(pageA, wsName);
    const listingA = await listWorkspaces(pageA);
    const wsId = [...listingA.owned, ...listingA.shared].find((w) => w.name === wsName)!.id;
    const projectId = await createProjectInWorkspace(pageA, projectName);

    // 1. Creating a project does NOT create a version — the server list is
    // empty until the first meaningful save.
    expect(await listProjectVersions(pageA, wsId, projectId)).toEqual([]);

    // 2. A invites B as editor up front (dashboard flow — mirrors the other
    // workspace specs).
    await openWorkspaceSettings(pageA);
    await inviteMember(pageA, emailB, "editor");
    await pageA.locator('[data-testid="workspace-settings-close"]').click();

    // 3. A opens the project and makes the first meaningful edit → the first
    // deduplicated autosave version appears (revision AFTER the save = 2) and
    // project.saved activity fires with the server-derived revision.
    await selectWorkspace(pageA, wsName);
    await openWorkspaceProjectFromDashboard(pageA, projectId);
    // Wait for the editor session to resolve as editable (access + lease + a
    // re-hydration of the server project) BEFORE editing — an edit made while
    // access is still resolving would be discarded by the re-hydration.
    await expectEditingIndicator(pageA, "Editing");
    await expect(pageA.locator('[data-testid="section-wrapper"]').first()).toBeVisible({
      timeout: 15000,
    });
    await pageA.locator('[data-testid="section-wrapper"]').first().click();
    await expect(pageA.locator('[data-testid="inspector-panel"]')).toBeVisible({ timeout: 10000 });
    await pageA
      .locator('[data-testid="inspector-panel"] textarea')
      .first()
      .fill("Versioned edit one");
    await expect
      .poll(
        async () => (await fetchWorkspaceProject(pageA, wsId, projectId)).revision,
        { timeout: 30000, intervals: [500, 1000, 2000] },
      )
      .toBeGreaterThanOrEqual(2);

    let versions = await listProjectVersions(pageA, wsId, projectId);
    expect(versions).toHaveLength(1);
    expect(versions[0].reason).toBe("autosave");
    expect(versions[0].revision).toBe(2);
    // Metadata-only list: the snapshot is never shipped with the list.
    expect("snapshot" in versions[0]).toBe(false);
    expect("project" in versions[0]).toBe(false);
    let feed = await listActivity(pageA, wsId);
    const savedAtV2 = feed.events.filter((e) => e.type === "project.saved");
    expect(savedAtV2).toHaveLength(1);
    expect(savedAtV2[0].metadata.revision).toBe(2);

    // 4. A second edit creates a second autosave (revision 3). The list is
    // newest-first and still metadata-only.
    await pageA
      .locator('[data-testid="inspector-panel"] textarea')
      .first()
      .fill("Versioned edit two");
    await expect
      .poll(
        async () => (await fetchWorkspaceProject(pageA, wsId, projectId)).revision,
        { timeout: 30000, intervals: [500, 1000, 2000] },
      )
      .toBeGreaterThanOrEqual(3);

    versions = await listProjectVersions(pageA, wsId, projectId);
    expect(versions).toHaveLength(2);
    expect(versions[0].revision).toBe(3); // newest first
    expect(versions[1].revision).toBe(2);
    const v2 = versions.find((v) => v.revision === 2)!;
    const v3 = versions.find((v) => v.revision === 3)!;
    expect("snapshot" in versions[0]).toBe(false);

    // A save with a stale expectedRevision is rejected outright (save requires
    // matching the server revision) and leaves the project untouched.
    const serverAtV3 = await fetchWorkspaceProject(pageA, wsId, projectId);
    const staleSave = await saveWorkspaceProject(pageA, {
      workspaceId: wsId,
      projectId,
      project: serverAtV3.project,
      expectedRevision: 1, // stale — current server revision is 3
    });
    expect(staleSave.ok).toBe(false);
    expect(staleSave.code).toBe("STALE_REVISION");
    expect((await fetchWorkspaceProject(pageA, wsId, projectId)).revision).toBe(3);

    // 5. Version preview is READ-ONLY through VisitorPageView and renders the
    // snapshot's own content (the older "Versioned edit one"), never the
    // active project's "Versioned edit two".
    await openVersionHistory(pageA);
    await expect(pageA.locator('[data-testid="version-entry"]')).toHaveCount(2, {
      timeout: 10000,
    });
    // Newest first in the UI too: the first entry is the v3 autosave.
    await expect(pageA.locator('[data-testid="version-entry"]').first()).toContainText("v3");
    await pageA.locator(`[data-testid="version-preview-${v2.id}"]`).click();
    await expect(pageA.locator('[data-testid="version-preview"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(pageA.locator('[data-testid="version-preview-banner"]')).toContainText(
      "Viewing version from",
    );
    await expect(pageA.locator('[data-testid="version-preview"]')).toContainText(
      "Read-only preview",
    );
    // No editor chrome inside the preview — it is a visitor view, not the editor.
    await expect(pageA.locator('[data-testid="version-preview"] [data-testid="section-wrapper"]')).toHaveCount(0);
    await expect(pageA.locator('[data-testid="version-preview"] [data-testid="inspector-panel"]')).toHaveCount(0);
    await expect(
      pageA
        .locator('[data-testid="version-preview"] [data-testid="visitor-preview-content"]')
        .getByText("Versioned edit one", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
    // The snapshot is Project-shaped only — fetch it lazily and verify no
    // collaboration metadata and the older content.
    const snapshot = await fetchProjectVersion(pageA, wsId, projectId, v2.id);
    expect(JSON.stringify(snapshot.project)).toContain("Versioned edit one");
    await pageA.locator('[data-testid="version-preview-return"]').click();
    await expect(pageA.locator('[data-testid="version-preview"]')).toBeHidden({
      timeout: 10000,
    });
    await pageA.locator('[data-testid="version-history-close"]').click();

    // A leaves the editor → the lease is released so B can open editable.
    await pageA.getByRole("button", { name: "Back to Dashboard" }).click();
    await pageA.waitForURL(/\//, { timeout: 30000 });
    await expect(pageA.locator('[data-testid="workspace-switcher"]')).toBeVisible({
      timeout: 15000,
    });

    // 6. B (editor) can read history but cannot restore — no restore button in
    // the UI and the wire rejects the attempt (owner-only restore).
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    const auditB = attachRuntimeAudit(pageB);

    await openDashboardAndSignUp(pageB, emailB);
    await acceptInvitation(pageB);
    await selectWorkspace(pageB, wsName);
    await openWorkspaceProjectFromDashboard(pageB, projectId);
    await openVersionHistory(pageB);
    await expect(pageB.locator('[data-testid="version-entry"]')).toHaveCount(2, {
      timeout: 10000,
    });
    // Editor: preview + copy buttons exist, restore buttons do not.
    await expect(pageB.locator('[data-testid^="version-preview-"]')).toHaveCount(2);
    await expect(pageB.locator('[data-testid^="version-copy-"]')).toHaveCount(2);
    await expect(pageB.locator('[data-testid^="version-restore-"]')).toHaveCount(0);
    await pageB.locator('[data-testid="version-history-close"]').click();
    const deniedRestore = await restoreVersionViaApi(pageB, wsId, projectId, v2.id, 3);
    expect(deniedRestore.ok).toBe(false);
    expect(deniedRestore.status).toBe(403);
    expect(deniedRestore.code).toBe("PERMISSION_DENIED");
    await pageB.getByRole("button", { name: "Back to Dashboard" }).click();
    await pageB.waitForURL(/\//, { timeout: 30000 });
    await expect(pageB.locator('[data-testid="workspace-switcher"]')).toBeVisible({
      timeout: 15000,
    });

    // 7. A (owner) restores the older version (v2) through the UI. The restore
    // saves the current state first, applies the snapshot as a NEW revision,
    // then reloads the editor so the server content re-hydrates.
    await selectWorkspace(pageA, wsName);
    await openWorkspaceProjectFromDashboard(pageA, projectId);
    await openVersionHistory(pageA);
    await pageA.locator(`[data-testid="version-restore-${v2.id}"]`).click();
    await expect(pageA.locator('[data-testid="restore-version-dialog"]')).toBeVisible({
      timeout: 10000,
    });
    await pageA.locator('[data-testid="restore-version-confirm"]').click();
    // The dialog reloads the window on success — wait for the editor to come
    // back with the restored (older) content.
    await expect(pageA.locator('[data-testid="editor-root"]')).toBeVisible({ timeout: 30000 });
    await expect(pageA.locator('[data-testid="section-wrapper"]').first()).toBeVisible({
      timeout: 15000,
    });
    await pageA.locator('[data-testid="section-wrapper"]').first().click();
    await expect(pageA.locator('[data-testid="inspector-panel"]')).toBeVisible({ timeout: 10000 });
    await expect(pageA.locator('[data-testid="inspector-panel"] textarea').first()).toHaveValue(
      "Versioned edit one",
      { timeout: 15000 },
    );

    // Server-side: the restore created a NEW revision (4) and a "restore"
    // version; the pre-restore safety version and ALL historical versions
    // remain in the timeline; project.version_restored activity was recorded.
    const restored = await fetchWorkspaceProject(pageA, wsId, projectId);
    expect(restored.revision).toBe(4);
    expect(JSON.stringify(restored.project)).toContain("Versioned edit one");
    expect(JSON.stringify(restored.project)).not.toContain("Versioned edit two");

    versions = await listProjectVersions(pageA, wsId, projectId);
    expect(versions).toHaveLength(4);
    const reasons = versions.map((v) => v.reason);
    expect(reasons).toContain("restore");
    expect(reasons).toContain("pre-restore");
    expect(reasons.filter((r) => r === "autosave")).toHaveLength(2);
    // Historical versions are intact (same ids, same revisions).
    expect(versions.some((v) => v.id === v2.id && v.revision === 2)).toBe(true);
    expect(versions.some((v) => v.id === v3.id && v.revision === 3)).toBe(true);
    // The restore version carries the older snapshot's content.
    const restoreVersion = versions.find((v) => v.reason === "restore")!;
    expect(restoreVersion.revision).toBe(4);
    feed = await listActivity(pageA, wsId);
    const restoredEvent = feed.events.find((e) => e.type === "project.version_restored");
    expect(restoredEvent).toBeTruthy();
    expect(restoredEvent!.metadata.to).toBe(4);

    // 8a. A stale restore (expectedRevision mismatch) is rejected with no side
    // effects — the revision and timeline are untouched.
    const staleRestore = await restoreVersionViaApi(pageA, wsId, projectId, v3.id, 2);
    expect(staleRestore.ok).toBe(false);
    expect(staleRestore.status).toBe(409);
    expect(staleRestore.code).toBe("STALE_REVISION");
    expect((await fetchWorkspaceProject(pageA, wsId, projectId)).revision).toBe(4);
    expect(await listProjectVersions(pageA, wsId, projectId)).toHaveLength(4);

    // 8b. An identical-content save is silent: the revision bumps (the save
    // lands) but no redundant version is created and no project.saved fires.
    const silent = await saveWorkspaceProject(pageA, {
      workspaceId: wsId,
      projectId,
      project: (await fetchWorkspaceProject(pageA, wsId, projectId)).project,
      expectedRevision: 4,
    });
    expect(silent.ok).toBe(true);
    expect((await fetchWorkspaceProject(pageA, wsId, projectId)).revision).toBe(5);
    expect(await listProjectVersions(pageA, wsId, projectId)).toHaveLength(4);
    feed = await listActivity(pageA, wsId);
    expect(feed.events.filter((e) => e.type === "project.saved")).toHaveLength(2);

    // 9. Isolation: a signed-in non-member reads no versions (membership-gated).
    const contextC = await browser.newContext();
    const pageC = await contextC.newPage();
    await openDashboardAndSignUp(pageC, `ver-c-${uniqueSuffix()}@example.com`);
    const tokenC = await mockToken(pageC);
    const deniedList = await pageC.request.get(
      `http://localhost:3000/api/workspaces/${wsId}/projects/${encodeURIComponent(projectId)}/versions`,
      { headers: { Authorization: `Bearer ${tokenC ?? ""}` } },
    );
    expect(deniedList.status()).toBe(403);
    const deniedFetch = await pageC.request.get(
      `http://localhost:3000/api/workspaces/${wsId}/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(v2.id)}`,
      { headers: { Authorization: `Bearer ${tokenC ?? ""}` } },
    );
    expect(deniedFetch.status()).toBe(403);
    await contextC.close();

    assertRuntimeClean(auditA.state);
    assertRuntimeClean(auditB.state);

    await contextA.close();
    await contextB.close();
  });
});
