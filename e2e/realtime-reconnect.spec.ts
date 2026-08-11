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
  subheadlineTextarea,
  reloadEditor,
  waitForServerContent,
  waitForCollabStatus,
  forceCollabDisconnect,
  forceCollabReconnect,
} from "./helpers/collab";

// ---------------------------------------------------------------------------
// Phase P16 — E2E: realtime reconnect (offline edit + merge, no duplicate)
//
// Deterministic flow (mock transport test controls pause/resume the room):
//   1. A + B connected and synced
//   2. A force-disconnects → honest "offline" status
//   3. A edits the headline locally while offline (bounded offline queue)
//   4. B edits the subheadline online → relayed to the room
//   5. A reconnects → queued update flushes + room updates apply → merge
//   6. BOTH changes converge on BOTH clients (no full-project overwrite)
//   7. no duplicate update (the offline edit lands exactly once)
//   8. reload both → converged state is durable
//   9. runtime audit clean
// ---------------------------------------------------------------------------

test.describe("Realtime reconnect", () => {
  test("offline edit + online edit merge after reconnect without loss or duplication", async ({
    browser,
  }) => {
    test.setTimeout(300_000);

    const emailA = `rec-a-${uniqueSuffix()}@example.com`;
    const emailB = `rec-b-${uniqueSuffix()}@example.com`;
    const wsName = `Reconnect ${uniqueSuffix().slice(-4)}`;
    const projectName = "Reconnect Project";

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

    // 1. Both connected and synced, both on the hero.
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

    // 2. A goes offline → honest "offline" sync status.
    await forceCollabDisconnect(pageA);
    await expect(pageA.locator('[data-testid="collab-status-offline"]')).toBeVisible({
      timeout: 15000,
    });

    // 3. A edits the headline while offline (queued locally, bounded).
    const aText = `A offline headline ${uniqueSuffix().slice(-4)}`;
    await headlineTextarea(pageA).fill(aText);

    // 4. B edits the subheadline online → reaches the room.
    const bText = `B online subheadline ${uniqueSuffix().slice(-4)}`;
    await subheadlineTextarea(pageB).fill(bText);

    // 5. A reconnects → queue flushes, room updates apply, CRDT merges.
    await forceCollabReconnect(pageA);
    await waitForCollabStatus(pageA, "collab-status-synced");

    // 6. BOTH changes converge on BOTH clients (no last-write-wins overwrite).
    await expect(headlineTextarea(pageA)).toHaveValue(aText, { timeout: 20000 });
    await expect(headlineTextarea(pageB)).toHaveValue(aText, { timeout: 20000 });
    await expect(subheadlineTextarea(pageA)).toHaveValue(bText, { timeout: 20000 });
    await expect(subheadlineTextarea(pageB)).toHaveValue(bText, { timeout: 20000 });

    // 7. Durable + no duplicate: the server project contains each edit EXACTLY
    // once (Yjs updates are idempotent; the offline queue flush never dupes).
    await waitForServerContent(pageA, wsId, projectId, [aText, bText]);
    const server = await fetchWorkspaceProject(pageA, wsId, projectId);
    const raw = JSON.stringify(server.project);
    // Each edit appears exactly once — the offline-queue flush never dupes.
    expect(raw.split(aText).length - 1).toBe(1);
    expect(raw.split(bText).length - 1).toBe(1);

    // 8. Reload both → the merged state persists.
    await reloadEditor(pageA);
    await expectEditingIndicator(pageA, "Editing");
    await waitForCollabStatus(pageA, "collab-status-synced");
    await openHeroInspector(pageA);
    await expect(headlineTextarea(pageA)).toHaveValue(aText, { timeout: 15000 });
    await expect(subheadlineTextarea(pageA)).toHaveValue(bText, { timeout: 15000 });

    await reloadEditor(pageB);
    await expectEditingIndicator(pageB, "Editing");
    await waitForCollabStatus(pageB, "collab-status-synced");
    await openHeroInspector(pageB);
    await expect(headlineTextarea(pageB)).toHaveValue(aText, { timeout: 15000 });
    await expect(subheadlineTextarea(pageB)).toHaveValue(bText, { timeout: 15000 });

    // 9. Runtime audit clean.
    assertRuntimeClean(auditA.state);
    assertRuntimeClean(auditB.state);

    await contextA.close();
    await contextB.close();
  });
});
