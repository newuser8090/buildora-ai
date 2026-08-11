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
  waitForWorkspaceRevision,
  waitForLeaseReleased,
  listWorkspaces,
  uniqueSuffix,
} from "./helpers/workspaces";

// ---------------------------------------------------------------------------
// Phase P14 — E2E: workspace collaboration
//
// Flow (deterministic mock backend, two browser contexts = two accounts):
//   1. user A signs up
//   2. A creates a workspace
//   3. A creates a project inside the workspace
//   4. A invites user B as editor
//   5. B accepts the invitation
//   6. B sees the workspace + project
//   7. B opens the project editable
//   8. B edits the project
//   9. the server save persists (optimistic concurrency revision bumps)
//  10. A reloads and sees B's persisted change
//  11. permissions remain correct (B is an editor, not owner)
// ---------------------------------------------------------------------------

test.describe("Workspace collaboration", () => {
  test("two users collaborate on a workspace project", async ({ browser }) => {
    test.setTimeout(240_000);

    const emailA = `owner-${uniqueSuffix()}@example.com`;
    const emailB = `editor-${uniqueSuffix()}@example.com`;
    const wsName = `Acme ${uniqueSuffix().slice(-4)}`;
    const projectName = "Shared Landing";

    // ----------------------------- User A -----------------------------
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const auditA = attachRuntimeAudit(pageA);

    await openDashboardAndSignUp(pageA, emailA);

    // 2. Create a workspace.
    await createWorkspace(pageA, wsName);

    // 3. Create a project inside the workspace.
    const projectId = await createProjectInWorkspace(pageA, projectName);

    // 4. Invite B as editor.
    await openWorkspaceSettings(pageA);
    await inviteMember(pageA, emailB, "editor");
    await pageA.locator('[data-testid="workspace-settings-close"]').click();
    await expect(pageA.locator('[data-testid="workspace-settings-dialog"]')).toBeHidden();

    // ----------------------------- User B -----------------------------
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    const auditB = attachRuntimeAudit(pageB);

    await openDashboardAndSignUp(pageB, emailB);

    // 5. B accepts the invitation.
    await acceptInvitation(pageB);
    // 6. B sees the workspace (listed as shared) and can open it.
    const listingB = await listWorkspaces(pageB);
    const sharedWs = [...listingB.owned, ...listingB.shared].find((w) => w.name === wsName);
    expect(sharedWs).toBeTruthy();
    expect(sharedWs?.memberRole).toBe("editor");
    await selectWorkspace(pageB, wsName);

    // 7. B opens the workspace project editable.
    await openWorkspaceProjectFromDashboard(pageB, projectId);
    await expectEditingIndicator(pageB, "Editing");

    // 8. B edits the project: change the blank hero headline via the inspector.
    // The blank template's hero headline is editable through the inspector.
    await expect(pageB.locator('[data-testid="preview-content"]')).toBeVisible({
      timeout: 15000,
    });
    // Select the hero section (first section-wrapper) and edit its text.
    await pageB.locator('[data-testid="section-wrapper"]').first().click();
    await expect(pageB.locator('[data-testid="inspector-panel"]')).toBeVisible({ timeout: 10000 });
    const textarea = pageB.locator('[data-testid="inspector-panel"] textarea').first();
    await textarea.fill("Collaborative hero title");
    await expect(
      pageB.locator('[data-testid="preview-content"]').getByText("Collaborative hero title"),
    ).toBeVisible({ timeout: 10000 });

    // 9. The debounced server save lands (revision bumps from 1 to 2).
    const wsId = sharedWs!.id;
    await waitForWorkspaceRevision(pageB, wsId, projectId, 2);
    const afterSave = await fetchWorkspaceProject(pageB, wsId, projectId);
    expect(JSON.stringify(afterSave.project)).toContain("Collaborative hero title");
    // B's save succeeded via optimistic concurrency — revision is now 2.
    expect(afterSave.revision).toBe(2);

    // B exits the editor. (Phase P16: ordinary editing is no longer exclusive
    // — the lease is null by default, so this wait is a harmless no-op that
    // keeps the P14 helper contract exercised.)
    await pageB.getByRole("button", { name: "Back to Dashboard" }).click();
    await expect(pageB.locator('[data-testid="workspace-switcher"]')).toBeVisible({
      timeout: 30000,
    });
    await waitForLeaseReleased(pageB, wsId, projectId);

    // 10. A reloads the dashboard and sees B's persisted change.
    await pageA.reload();
    await pageA.waitForLoadState("networkidle");
    // A is signed in and the workspace persists.
    await selectWorkspace(pageA, wsName);
    await openWorkspaceProjectFromDashboard(pageA, projectId);
    await expectEditingIndicator(pageA, "Editing");
    await expect(pageA.locator('[data-testid="preview-content"]')).toBeVisible({ timeout: 15000 });
    await pageA.locator('[data-testid="section-wrapper"]').first().click();
    await expect(pageA.locator('[data-testid="inspector-panel"]')).toBeVisible({ timeout: 10000 });
    await expect(pageA.locator('[data-testid="inspector-panel"] textarea').first()).toHaveValue(
      "Collaborative hero title",
      { timeout: 10000 },
    );

    // 11. Permissions: A is owner, B is editor.
    const listingA = await listWorkspaces(pageA);
    const ownedWs = [...listingA.owned, ...listingA.shared].find((w) => w.name === wsName);
    expect(ownedWs?.memberRole).toBe("owner");
    expect(sharedWs?.memberRole).toBe("editor");

    assertRuntimeClean(auditA.state);
    assertRuntimeClean(auditB.state);

    await contextA.close();
    await contextB.close();
  });
});
