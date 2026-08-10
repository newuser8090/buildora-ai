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
  waitForLeaseReleased,
  uniqueSuffix,
} from "./helpers/workspaces";

// ---------------------------------------------------------------------------
// Phase P14 — E2E: edit lease coordination
//
// Deterministic flow (two browser contexts = two accounts):
//   1. A opens the workspace project → acquires an active edit lease
//   2. B opens the same project → sees an honest "currently being edited"
//      read-only state (blocked, not fake presence)
//   3. B cannot mutate through the UI (read-only session)
//   4. A exits the editor → releases the lease (best-effort, deterministic
//      mock backend)
//   5. B retries from the blocker → acquires the lease → becomes editable
//   6. B's save persists (revision bumps)
//   7. A newer server revision is pushed → B's stale save is rejected with a
//      safe conflict UX instead of a silent overwrite
// ---------------------------------------------------------------------------

test.describe("Workspace edit lease", () => {
  test("lease blocks concurrent editing, hands over safely, and rejects stale saves", async ({
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

    // 1. A opens the project editable → acquires the lease.
    await selectWorkspace(pageA, wsName);
    await openWorkspaceProjectFromDashboard(pageA, projectId);
    await expectEditingIndicator(pageA, "Editing");

    // 2. B opens the same project → blocked by A's active lease. The blocker
    // is honest ("Currently being edited", names the holder).
    await selectWorkspace(pageB, wsName);
    await openWorkspaceProjectFromDashboard(pageB, projectId);
    await expect(pageB.locator('[data-testid="workspace-being-edited-dialog"]')).toBeVisible({
      timeout: 20000,
    });
    await expect(pageB.locator('[data-testid="workspace-being-edited-dialog"]')).toContainText(
      "Currently being edited",
    );
    // The holder's name is surfaced (same-workspace member, never a device id).
    await expect(pageB.locator('[data-testid="workspace-being-edited-dialog"]')).toContainText(
      "is editing this project right now",
    );

    // 3. B cannot mutate while blocked: the editor session is read-only.
    // The TopNav indicator reflects the read-only state while the blocker is
    // up (reason "being-edited" → "Being edited by …", never "Editing").
    await expect(pageB.locator('[data-testid="workspace-editing-indicator"]')).toContainText(
      "Being edited by",
    );

    // 4. A exits the editor → releases the lease (best-effort release).
    await pageA.getByRole("button", { name: "Back to Dashboard" }).click();
    await pageA.waitForURL(/\/$/, { timeout: 30000 });
    await expect(pageA.locator('[data-testid="workspace-switcher"]')).toBeVisible({
      timeout: 15000,
    });
    // Deterministic handover: wait until the server no longer holds A's lease
    // (the release is best-effort, so assert the observable server state).
    await waitForLeaseReleased(pageA, wsId, projectId);

    // 5. B retries from the blocker → acquires the lease → becomes editable.
    await pageB.locator('[data-testid="workspace-retry-lease"]').click();
    await expectEditingIndicator(pageB, "Editing");
    await expect(pageB.locator('[data-testid="workspace-being-edited-dialog"]')).toBeHidden({
      timeout: 15000,
    });

    // 6. B can now edit and save (revision bumps 1 → 2).
    await expect(pageB.locator('[data-testid="preview-content"]')).toBeVisible({ timeout: 15000 });
    await pageB.locator('[data-testid="section-wrapper"]').first().click();
    await expect(pageB.locator('[data-testid="inspector-panel"]')).toBeVisible({ timeout: 10000 });
    await pageB
      .locator('[data-testid="inspector-panel"] textarea')
      .first()
      .fill("Lease handover edit");
    await expect
      .poll(
        async () => (await fetchWorkspaceProject(pageA, wsId, projectId)).revision,
        { timeout: 30000, intervals: [500, 1000, 2000] },
      )
      .toBeGreaterThanOrEqual(2);

    // 7. Stale revision protection: A pushes a NEWER server revision while
    // B's session still expects the older revision. B's next save must be
    // rejected and surfaced as a safe conflict — never a silent overwrite.
    const before = await fetchWorkspaceProject(pageA, wsId, projectId);
    const newerProject = JSON.parse(JSON.stringify(before.project)) as { name: string };
    newerProject.name = "Newer server version";
    const pushed = await saveWorkspaceProject(pageA, {
      workspaceId: wsId,
      projectId,
      project: newerProject,
      expectedRevision: before.revision,
    });
    expect(pushed.ok).toBe(true);

    // B edits again → the debounced save carries B's now-stale expected
    // revision → STALE_REVISION → safe conflict dialog. The hero section is
    // still selected from the previous edit (SelectableSection switches its
    // testid from "section-wrapper" to "selected-section"), so the inspector
    // is already open — just edit the value directly.
    await expect(pageB.locator('[data-testid="inspector-panel"]')).toBeVisible({ timeout: 10000 });
    await pageB
      .locator('[data-testid="inspector-panel"] textarea')
      .first()
      .fill("B's stale edit");
    await expect(pageB.locator('[data-testid="workspace-save-conflict-dialog"]')).toBeVisible({
      timeout: 20000,
    });
    await expect(pageB.locator('[data-testid="workspace-save-conflict-dialog"]')).toContainText(
      "This project changed since you opened it",
    );
    // Safe choices, no silent overwrite path.
    await expect(pageB.locator('[data-testid="workspace-reload-latest"]')).toBeVisible();
    await expect(pageB.locator('[data-testid="workspace-save-personal-copy"]')).toBeVisible();
    // The server copy was never overwritten by the stale save.
    const after = await fetchWorkspaceProject(pageA, wsId, projectId);
    expect((after.project as { name: string }).name).toBe("Newer server version");
    expect(after.revision).toBe(before.revision + 1);

    assertRuntimeClean(auditA.state);
    assertRuntimeClean(auditB.state);

    await contextA.close();
    await contextB.close();
  });
});
