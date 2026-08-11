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
  listWorkspaces,
  uniqueSuffix,
} from "./helpers/workspaces";
import {
  openHeroInspector,
  headlineTextarea,
  subheadlineTextarea,
  reloadEditor,
  waitForServerContent,
  waitForCollabStatus,
} from "./helpers/collab";

// ---------------------------------------------------------------------------
// Phase P16 — E2E: realtime collaboration (live simultaneous editing)
//
// Deterministic flow (two browser contexts = two accounts, one shared mock
// room):
//   1. A + B open the SAME workspace project at the same time — both become
//      active editors (no P14 exclusive-lease blocker under P16)
//   2. A edits the hero headline → B sees the change WITHOUT reload
//   3. B edits the hero subheadline → A sees the change WITHOUT reload
//   4. Both edits persist durably (collab checkpoint with optimistic
//      concurrency bumps the server revision)
//   5. Reload BOTH editors → final state identical on both
//   6. runtime audit clean (no React/realtime errors)
// ---------------------------------------------------------------------------

test.describe("Realtime collaboration", () => {
  test("two editors edit the same project live and persist both changes", async ({
    browser,
  }) => {
    test.setTimeout(300_000);

    const emailA = `rt-a-${uniqueSuffix()}@example.com`;
    const emailB = `rt-b-${uniqueSuffix()}@example.com`;
    const wsName = `Realtime ${uniqueSuffix().slice(-4)}`;
    const projectName = "Live Project";

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
    const wsId = [...listingB.owned, ...listingB.shared].find(
      (w) => w.name === wsName,
    )!.id;

    // 1. Both open the SAME project at the same time → both "Editing" (the
    // P14 exclusive lease no longer blocks anyone — P16 simultaneous editing).
    await selectWorkspace(pageA, wsName);
    await openWorkspaceProjectFromDashboard(pageA, projectId);
    await expectEditingIndicator(pageA, "Editing");
    await waitForCollabStatus(pageA, "collab-status-synced");

    await selectWorkspace(pageB, wsName);
    await openWorkspaceProjectFromDashboard(pageB, projectId);
    await expectEditingIndicator(pageB, "Editing");
    await waitForCollabStatus(pageB, "collab-status-synced");

    // Both select the hero so each can watch the other's change live.
    await openHeroInspector(pageA);
    await openHeroInspector(pageB);

    // 2. A edits the headline → B sees it WITHOUT reload (mock poll ~500 ms).
    const headlineA = `Headline by A ${uniqueSuffix().slice(-4)}`;
    await headlineTextarea(pageA).fill(headlineA);
    await expect(headlineTextarea(pageB)).toHaveValue(headlineA, {
      timeout: 15000,
    });

    // 3. B edits the subheadline → A sees it WITHOUT reload.
    const subheadlineB = `Subheadline by B ${uniqueSuffix().slice(-4)}`;
    await subheadlineTextarea(pageB).fill(subheadlineB);
    await expect(subheadlineTextarea(pageA)).toHaveValue(subheadlineB, {
      timeout: 15000,
    });

    // Both clients now show BOTH edits (fully converged, live).
    await expect(headlineTextarea(pageA)).toHaveValue(headlineA);
    await expect(headlineTextarea(pageB)).toHaveValue(headlineA);
    await expect(subheadlineTextarea(pageA)).toHaveValue(subheadlineB);
    await expect(subheadlineTextarea(pageB)).toHaveValue(subheadlineB);

    // 4. Both edits persist: the collab checkpoint (optimistic concurrency)
    // writes the merged doc to the server project.
    await waitForServerContent(pageA, wsId, projectId, [headlineA, subheadlineB]);

    // 5. Reload both editors → the persisted merged state is identical.
    await reloadEditor(pageA);
    await expectEditingIndicator(pageA, "Editing");
    await waitForCollabStatus(pageA, "collab-status-synced");
    await openHeroInspector(pageA);
    await expect(headlineTextarea(pageA)).toHaveValue(headlineA, { timeout: 15000 });
    await expect(subheadlineTextarea(pageA)).toHaveValue(subheadlineB, {
      timeout: 15000,
    });

    await reloadEditor(pageB);
    await expectEditingIndicator(pageB, "Editing");
    await waitForCollabStatus(pageB, "collab-status-synced");
    await openHeroInspector(pageB);
    await expect(headlineTextarea(pageB)).toHaveValue(headlineA, { timeout: 15000 });
    await expect(subheadlineTextarea(pageB)).toHaveValue(subheadlineB, {
      timeout: 15000,
    });

    // 6. Runtime audit clean on both clients.
    assertRuntimeClean(auditA.state);
    assertRuntimeClean(auditB.state);

    await contextA.close();
    await contextB.close();
  });
});
