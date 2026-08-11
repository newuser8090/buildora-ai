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
  listWorkspaces,
  uniqueSuffix,
} from "./helpers/workspaces";
import {
  openHeroInspector,
  headlineTextarea,
  reloadEditor,
  waitForServerContent,
  waitForCollabStatus,
  forceCollabDisconnect,
  forceCollabReconnect,
  openStructureTab,
  addSection,
  sectionRowCount,
} from "./helpers/collab";

// ---------------------------------------------------------------------------
// Phase P16 — E2E: realtime structural collaboration
//
// Concurrent structural edits (adding/reordering sections) must never corrupt
// the tree: no duplicate child references, no dangling parent ids, unique ids,
// deterministic convergence.
//
// Deterministic flow (deterministic controlled timing via paused transports):
//   1. A adds a "features" section while B concurrently edits the hero
//      headline — both changes must survive
//   2. clients converge; the tree is valid (2 sections, unique ids) on both
//   3. A reorders a section (move up) while B edits another field — both
//      survive, order converges
//   4. reload both → identical converged structure
//   5. runtime audit clean
// ---------------------------------------------------------------------------

test.describe("Realtime structural collaboration", () => {
  test("concurrent add + text edit survive; reorder converges; tree stays valid", async ({
    browser,
  }) => {
    test.setTimeout(300_000);

    const emailA = `str-a-${uniqueSuffix()}@example.com`;
    const emailB = `str-b-${uniqueSuffix()}@example.com`;
    const wsName = `Structure ${uniqueSuffix().slice(-4)}`;
    const projectName = "Structure Project";

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

    // Both open the SAME project.
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

    // -------------------------------------------------------------------
    // 1. Concurrent structural + text edit (deterministic controlled timing:
    //    both transports paused so neither sees the other's change first).
    // -------------------------------------------------------------------
    await forceCollabDisconnect(pageA);
    await forceCollabDisconnect(pageB);

    // A adds a "features" section (local UI flow → queued CRDT transaction).
    await addSection(pageA, "features");
    // B concurrently edits the hero headline.
    const bText = `Structure text ${uniqueSuffix().slice(-4)}`;
    await headlineTextarea(pageB).fill(bText);

    await forceCollabReconnect(pageA);
    await forceCollabReconnect(pageB);
    await waitForCollabStatus(pageA, "collab-status-synced");
    await waitForCollabStatus(pageB, "collab-status-synced");

    // 2. Both changes survive and clients converge:
    //    - B's headline text appears on A (assert via the preview's inline
    //      edit button — independent of whichever sidebar tab A is on)
    //    - A's new section appears on B (structure row count)
    const aHeadlineButton = pageA.getByRole("button", {
      name: "Edit Headline of hero section",
    });
    await expect(aHeadlineButton).toContainText(bText, { timeout: 20000 });
    const bHeadlineButton = pageB.getByRole("button", {
      name: "Edit Headline of hero section",
    });
    await expect(bHeadlineButton).toContainText(bText, { timeout: 20000 });
    await expect
      .poll(() => sectionRowCount(pageA), { timeout: 20000, intervals: [500, 1000] })
      .toBe(2);
    await expect
      .poll(() => sectionRowCount(pageB), { timeout: 20000, intervals: [500, 1000] })
      .toBe(2);

    // Tree validity on the server: exactly 2 sections, unique ids.
    await waitForServerContent(pageA, wsId, projectId, [bText]);
    const serverAfterAdd = await fetchWorkspaceProject(pageA, wsId, projectId);
    const sections = (serverAfterAdd.project as {
      pages: Array<{ sections: Array<{ id: string }> }>;
    }).pages.flatMap((p) => p.sections);
    expect(sections).toHaveLength(2);
    expect(new Set(sections.map((s) => s.id)).size).toBe(2);

    // -------------------------------------------------------------------
    // 3. Concurrent reorder + field edit: A moves a section up while B edits
    //    the subheadline — both survive, order converges.
    // -------------------------------------------------------------------
    await forceCollabDisconnect(pageA);
    await forceCollabDisconnect(pageB);

    // Re-open the structure tab (the insert switched the sidebar to Design).
    await openStructureTab(pageA);
    const row = pageA.locator('[data-section-type="features"]').first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.locator('[data-testid^="section-menu-"]').first().click();
    await pageA.locator('[data-testid="section-action-move-up"]').click();

    const bSub = `Sub by B ${uniqueSuffix().slice(-4)}`;
    await openHeroInspector(pageB);
    await pageB
      .locator('[data-testid="inspector-panel"] textarea')
      .nth(1)
      .fill(bSub);

    await forceCollabReconnect(pageA);
    await forceCollabReconnect(pageB);
    await waitForCollabStatus(pageA, "collab-status-synced");
    await waitForCollabStatus(pageB, "collab-status-synced");

    // The subheadline edit converges to A (preview inline button — the
    // reorder moved features above the hero, so the first section-wrapper is
    // no longer the hero; the inline anchor stays unambiguous).
    const aSubButton = pageA.getByRole("button", {
      name: "Edit Subheadline of hero section",
    });
    await expect(aSubButton).toContainText(bSub, { timeout: 20000 });
    const bSubButton = pageB.getByRole("button", {
      name: "Edit Subheadline of hero section",
    });
    await expect(bSubButton).toContainText(bSub, { timeout: 20000 });
    // The reorder converges to B: "features" is now the FIRST section row.
    await expect
      .poll(
        async () => {
          await openStructureTab(pageB);
          const first = await pageB
            .locator('[data-section-type]')
            .first()
            .getAttribute("data-section-type");
          return first;
        },
        { timeout: 20000, intervals: [500, 1000] },
      )
      .toBe("features");

    // 4. Reload both → identical converged structure (2 sections, features
    // first, both text edits persisted).
    await waitForServerContent(pageA, wsId, projectId, [bText, bSub]);
    await reloadEditor(pageA);
    await expectEditingIndicator(pageA, "Editing");
    await waitForCollabStatus(pageA, "collab-status-synced");
    await expect
      .poll(() => sectionRowCount(pageA), { timeout: 20000, intervals: [500, 1000] })
      .toBe(2);
    await openStructureTab(pageA);
    await expect(pageA.locator('[data-section-type]').first()).toHaveAttribute(
      "data-section-type",
      "features",
    );

    await reloadEditor(pageB);
    await expectEditingIndicator(pageB, "Editing");
    await waitForCollabStatus(pageB, "collab-status-synced");
    await expect
      .poll(() => sectionRowCount(pageB), { timeout: 20000, intervals: [500, 1000] })
      .toBe(2);
    await openStructureTab(pageB);
    await expect(pageB.locator('[data-section-type]').first()).toHaveAttribute(
      "data-section-type",
      "features",
    );

    // 5. Runtime audit clean.
    assertRuntimeClean(auditA.state);
    assertRuntimeClean(auditB.state);

    await contextA.close();
    await contextB.close();
  });
});
