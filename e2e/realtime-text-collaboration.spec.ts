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
  reloadEditor,
  waitForServerContent,
  waitForCollabStatus,
  forceCollabDisconnect,
  forceCollabReconnect,
} from "./helpers/collab";

// ---------------------------------------------------------------------------
// Phase P16 — E2E: realtime SAME-TEXT collaboration
//
// This spec proves genuine concurrent text editing (NOT sequential):
//
//   base:      "Hello world"
//   A inserts: "beautiful "  → "Hello beautiful world"
//   B inserts: "!"           → "Hello world!"
//
// Deterministic controlled timing: BOTH clients pause realtime delivery
// (forceDisconnect) BEFORE either edits, so both local diffs are computed
// against the SAME base "Hello world" — neither has seen the other's change.
// The two independent Yjs insert transactions are then flushed on reconnect
// and merged by the CRDT into a deterministic "Hello beautiful world!".
//
// Assertions:
//   1. both contributions survive (contains "beautiful" AND "!")
//   2. both clients converge to the IDENTICAL merged text
//   3. reload retains the merged text (durable checkpoint)
//   4. runtime audit clean
// ---------------------------------------------------------------------------

test.describe("Realtime same-text collaboration", () => {
  test("concurrent inserts into the same text field both survive and converge", async ({
    browser,
  }) => {
    test.setTimeout(300_000);

    const emailA = `txt-a-${uniqueSuffix()}@example.com`;
    const emailB = `txt-b-${uniqueSuffix()}@example.com`;
    const wsName = `TextCollab ${uniqueSuffix().slice(-4)}`;
    const projectName = "Text Project";

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

    // Both open the SAME project and select the hero section.
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

    // Establish the shared base "Hello world" (replaces the blank template's
    // default headline). Wait until BOTH clients show it — a converged base.
    await headlineTextarea(pageA).fill("Hello world");
    await expect(headlineTextarea(pageA)).toHaveValue("Hello world", {
      timeout: 15000,
    });
    await expect(headlineTextarea(pageB)).toHaveValue("Hello world", {
      timeout: 15000,
    });

    // Deterministic controlled timing: pause BOTH transports so neither
    // client receives the other's update before it makes its own edit.
    await forceCollabDisconnect(pageA);
    await forceCollabDisconnect(pageB);
    await expect(pageA.locator('[data-testid="collab-status-offline"]')).toBeVisible({
      timeout: 15000,
    });

    // A inserts "beautiful " while B inserts "!" — both computed against the
    // SAME base "Hello world" (genuine concurrency, not sequential relay).
    await headlineTextarea(pageA).fill("Hello beautiful world");
    await headlineTextarea(pageB).fill("Hello world!");

    // Reconnect both: the queued updates flush, the room relays, and the CRDT
    // merges the two independent inserts.
    await forceCollabReconnect(pageA);
    await forceCollabReconnect(pageB);
    await waitForCollabStatus(pageA, "collab-status-synced");
    await waitForCollabStatus(pageB, "collab-status-synced");

    // 1 + 2. Both contributions survive and both clients converge to the
    // IDENTICAL merged text.
    await expect
      .poll(
        async () => ({
          a: await headlineTextarea(pageA).inputValue(),
          b: await headlineTextarea(pageB).inputValue(),
        }),
        { timeout: 20000, intervals: [300, 500, 1000] },
      )
      .toEqual({ a: "Hello beautiful world!", b: "Hello beautiful world!" });

    // The merged text deterministically contains both contributions.
    const mergedA = await headlineTextarea(pageA).inputValue();
    expect(mergedA).toContain("beautiful");
    expect(mergedA).toContain("!");
    expect(mergedA).toBe("Hello beautiful world!");

    // 3. Durable: the merged doc is checkpointed and reload retains it.
    await waitForServerContent(pageA, wsId, projectId, [
      "Hello beautiful world!",
    ]);
    await reloadEditor(pageA);
    await expectEditingIndicator(pageA, "Editing");
    await waitForCollabStatus(pageA, "collab-status-synced");
    await openHeroInspector(pageA);
    await expect(headlineTextarea(pageA)).toHaveValue(
      "Hello beautiful world!",
      { timeout: 15000 },
    );

    await reloadEditor(pageB);
    await expectEditingIndicator(pageB, "Editing");
    await waitForCollabStatus(pageB, "collab-status-synced");
    await openHeroInspector(pageB);
    await expect(headlineTextarea(pageB)).toHaveValue(
      "Hello beautiful world!",
      { timeout: 15000 },
    );

    // 4. Runtime audit clean on both clients.
    assertRuntimeClean(auditA.state);
    assertRuntimeClean(auditB.state);

    await contextA.close();
    await contextB.close();
  });
});
