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
  mockToken,
  uniqueSuffix,
} from "./helpers/workspaces";
import {
  openHeroInspector,
  headlineTextarea,
  subheadlineTextarea,
  waitForCollabStatus,
} from "./helpers/collab";

// ---------------------------------------------------------------------------
// Phase P14→P16 — E2E: edit coordination under simultaneous editing
//
// Phase P16 removed the EXCLUSIVE ordinary edit lease: multiple owner/editor
// members now edit the same workspace project at the same time, and the
// collaboration session owns realtime sync + durable checkpoints. The P14
// lease endpoints remain for backward compatibility and are reused as the
// OWNER-ONLY maintenance lock (version restore / import coordination).
//
// Deterministic flow (two browser contexts = two accounts):
//   1. A (owner) opens the project → editable (no lease acquisition needed)
//   2. B (editor) opens the SAME project simultaneously → ALSO editable
//      (no "being edited" blocker — the P16 behavior)
//   3. A and B edit different fields concurrently → both changes persist and
//      the server revision bumps (no last-write-wins overwrite)
//   4. wire-level optimistic concurrency is retained: a direct stale save
//      with an old expectedRevision is rejected with STALE_REVISION
//   5. the maintenance lock is OWNER-ONLY: an editor cannot acquire it, and a
//      second owner gets LOCKED while the first holds it (restore exclusivity)
//   6. runtime audit clean
// ---------------------------------------------------------------------------

async function authHeaders(page: import("@playwright/test").Page): Promise<Record<string, string>> {
  const token = await mockToken(page);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

test.describe("Workspace simultaneous editing", () => {
  test("two editors edit at once with no blocker; stale saves rejected; owner-only maintenance lock", async ({
    browser,
  }) => {
    test.setTimeout(300_000);

    const emailA = `lease-a-${uniqueSuffix()}@example.com`;
    const emailB = `lease-b-${uniqueSuffix()}@example.com`;
    const wsName = `Lease ${uniqueSuffix().slice(-4)}`;
    const projectName = "Lease Project";

    // ----------------------------- Setup -----------------------------
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const auditA = attachRuntimeAudit(pageA);

    await openDashboardAndSignUp(pageA, emailA);
    await createWorkspace(pageA, wsName);
    const projectId = await createProjectInWorkspace(pageA, projectName);
    await openWorkspaceSettings(pageA);
    await inviteMember(pageA, emailB, "editor");
    await pageA.locator('[data-testid="workspace-settings-close"]').click();

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    const auditB = attachRuntimeAudit(pageB);

    await openDashboardAndSignUp(pageB, emailB);
    await acceptInvitation(pageB);
    const listingB = await listWorkspaces(pageB);
    const wsId = [...listingB.owned, ...listingB.shared].find((w) => w.name === wsName)!.id;

    // 1. A opens the project editable.
    await selectWorkspace(pageA, wsName);
    await openWorkspaceProjectFromDashboard(pageA, projectId);
    await expectEditingIndicator(pageA, "Editing");
    await waitForCollabStatus(pageA, "collab-status-synced");
    await openHeroInspector(pageA);

    // 2. B opens the SAME project while A is still in it → editable too
    // (P16: no exclusive lease, no "being edited" blocker).
    await selectWorkspace(pageB, wsName);
    await openWorkspaceProjectFromDashboard(pageB, projectId);
    await expectEditingIndicator(pageB, "Editing");
    await expect(
      pageB.locator('[data-testid="workspace-being-edited-dialog"]'),
    ).toHaveCount(0);
    await waitForCollabStatus(pageB, "collab-status-synced");
    await openHeroInspector(pageB);

    // 3. Concurrent edits to DIFFERENT fields persist (no overwrite, no
    // blocker). Both clients converge to the combined result.
    const aText = `A headline ${uniqueSuffix().slice(-4)}`;
    const bText = `B subheadline ${uniqueSuffix().slice(-4)}`;
    await headlineTextarea(pageA).fill(aText);
    await subheadlineTextarea(pageB).fill(bText);
    await expect(headlineTextarea(pageA)).toHaveValue(aText, { timeout: 15000 });
    await expect(headlineTextarea(pageB)).toHaveValue(aText, { timeout: 15000 });
    await expect(subheadlineTextarea(pageA)).toHaveValue(bText, { timeout: 15000 });
    await expect(subheadlineTextarea(pageB)).toHaveValue(bText, { timeout: 15000 });
    // Both edits land on the server; the revision advanced.
    await expect
      .poll(
        async () => {
          const server = await fetchWorkspaceProject(pageA, wsId, projectId);
          const raw = JSON.stringify(server.project);
          return raw.includes(aText) && raw.includes(bText) && server.revision >= 2;
        },
        { timeout: 30000, intervals: [500, 1000, 2000] },
      )
      .toBe(true);

    // 4. Optimistic concurrency retained at the wire: a DIRECT stale save
    // (old expectedRevision) is rejected — never a silent overwrite.
    const current = await fetchWorkspaceProject(pageA, wsId, projectId);
    const staleAttempt = await saveWorkspaceProject(pageA, {
      workspaceId: wsId,
      projectId,
      project: { ...(current.project as object), name: "stale overwrite" },
      expectedRevision: current.revision - 1,
    });
    expect(staleAttempt.status).toBe(409);
    expect(staleAttempt.code).toBe("STALE_REVISION");
    const after = await fetchWorkspaceProject(pageA, wsId, projectId);
    expect((after.project as { name: string }).name).not.toBe("stale overwrite");

    // 5. Maintenance lock is OWNER-ONLY: an editor cannot acquire it.
    const editorLock = await pageB.request.post(
      `http://localhost:3000/api/collab/rooms/${wsId}/${projectId}/lock`,
      { headers: await authHeaders(pageB) },
    );
    expect(editorLock.status()).toBe(403);
    // Owner CAN acquire it; a second owner is refused while held (LOCKED).
    const ownerLock = await pageA.request.post(
      `http://localhost:3000/api/collab/rooms/${wsId}/${projectId}/lock`,
      { headers: await authHeaders(pageA) },
    );
    expect(ownerLock.status()).toBe(200);
    const secondLock = await pageA.request.post(
      `http://localhost:3000/api/collab/rooms/${wsId}/${projectId}/lock`,
      { headers: await authHeaders(pageA) },
    );
    expect(secondLock.status()).toBe(200); // same holder is idempotent
    await pageA.request.post(
      `http://localhost:3000/api/collab/rooms/${wsId}/${projectId}/unlock`,
      { headers: await authHeaders(pageA) },
    );

    assertRuntimeClean(auditA.state);
    assertRuntimeClean(auditB.state);

    await contextA.close();
    await contextB.close();
  });
});
