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
  uniqueSuffix,
} from "./helpers/workspaces";
import {
  openHeroInspector,
  headlineTextarea,
  subheadlineTextarea,
  waitForCollabStatus,
} from "./helpers/collab";

// ---------------------------------------------------------------------------
// Phase P16 — E2E: realtime scoped undo
//
// A's undo must revert ONLY A's own collaborative action — never B's work
// (CRDT-local-origin UndoManager; remote updates never pollute local undo).
//
// Deterministic flow:
//   1. A edits the headline, B edits the subheadline (independent fields)
//   2. both clients converge to the COMBINED result
//   3. A presses Undo → only A's headline edit disappears; B's subheadline
//      edit REMAINS on both clients (the undo transaction relays)
//   4. A presses Redo → A's headline edit is restored; both clients converge
//   5. runtime audit clean
// ---------------------------------------------------------------------------

test.describe("Realtime scoped undo", () => {
  test("A's undo reverts only A's action and never erases B's edit", async ({
    browser,
  }) => {
    test.setTimeout(300_000);

    const emailA = `undo-a-${uniqueSuffix()}@example.com`;
    const emailB = `undo-b-${uniqueSuffix()}@example.com`;
    const wsName = `UndoCollab ${uniqueSuffix().slice(-4)}`;
    const projectName = "Undo Project";

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

    // Both open the project and select the hero.
    await selectWorkspace(pageA, wsName);
    await openWorkspaceProjectFromDashboard(pageA, projectId);
    await expectEditingIndicator(pageA, "Editing");
    await waitForCollabStatus(pageA, "collab-status-synced");
    await openHeroInspector(pageA);

    await selectWorkspace(pageB, wsName);
    await openWorkspaceProjectFromDashboard(pageB, projectId);
    await expectEditingIndicator(pageB, "Editing");
    await waitForCollabStatus(pageB, "collab-status-synced");
    await openHeroInspector(pageB);

    // 1. A edits the headline, B edits the subheadline (independent fields).
    const baseHeadline = (await headlineTextarea(pageA).inputValue()) || "Untitled";
    const aHeadline = `A's headline ${uniqueSuffix().slice(-4)}`;
    const bSubheadline = `B's subheadline ${uniqueSuffix().slice(-4)}`;
    await headlineTextarea(pageA).fill(aHeadline);
    await subheadlineTextarea(pageB).fill(bSubheadline);

    // 2. Both clients converge to the COMBINED result.
    await expect(headlineTextarea(pageA)).toHaveValue(aHeadline, { timeout: 15000 });
    await expect(headlineTextarea(pageB)).toHaveValue(aHeadline, { timeout: 15000 });
    await expect(subheadlineTextarea(pageA)).toHaveValue(bSubheadline, {
      timeout: 15000,
    });
    await expect(subheadlineTextarea(pageB)).toHaveValue(bSubheadline, {
      timeout: 15000,
    });

    // 3. A presses Undo → ONLY A's headline reverts; B's subheadline stays.
    const undoButton = pageA.locator('[data-testid="undo-button"]');
    await expect(undoButton).toBeEnabled({ timeout: 10000 });
    await undoButton.click();

    // A's headline is back to the base value.
    await expect(headlineTextarea(pageA)).toHaveValue(baseHeadline, {
      timeout: 15000,
    });
    // B's subheadline is untouched by A's undo (scoped undo).
    await expect(subheadlineTextarea(pageA)).toHaveValue(bSubheadline);
    // The undo transaction relays → B also sees the headline revert.
    await expect(headlineTextarea(pageB)).toHaveValue(baseHeadline, {
      timeout: 15000,
    });
    await expect(subheadlineTextarea(pageB)).toHaveValue(bSubheadline);

    // 4. A presses Redo → A's headline edit is restored; both converge.
    const redoButton = pageA.locator('[data-testid="redo-button"]');
    await expect(redoButton).toBeEnabled({ timeout: 10000 });
    await redoButton.click();
    await expect(headlineTextarea(pageA)).toHaveValue(aHeadline, { timeout: 15000 });
    await expect(headlineTextarea(pageB)).toHaveValue(aHeadline, { timeout: 15000 });
    // B's subheadline still intact after A's redo.
    await expect(subheadlineTextarea(pageA)).toHaveValue(bSubheadline);
    await expect(subheadlineTextarea(pageB)).toHaveValue(bSubheadline);

    // 5. Runtime audit clean on both clients.
    assertRuntimeClean(auditA.state);
    assertRuntimeClean(auditB.state);

    await contextA.close();
    await contextB.close();
  });
});
