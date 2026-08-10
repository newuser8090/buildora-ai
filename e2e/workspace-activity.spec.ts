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
import { createReviewLink, openShareDialog } from "./helpers/share";
import { listActivity, getPresence } from "./helpers/p15";

// ---------------------------------------------------------------------------
// Phase P15 — E2E: workspace activity
//
// Deterministic flow (three browser contexts = three accounts):
//   1. A creates a workspace + project (workspace.created, project.created)
//   2. A invites B; B joins (member.invited, member.joined)
//   3. B edits and saves (project.saved, actor = B — server-derived)
//   4. A creates + revokes a review link (share.created, share.revoked —
//      bridged events, no raw tokens in metadata)
//   5. The dashboard Activity tab renders plain-language events with actor
//      names; internal type names are never shown
//   6. Non-member C can read no activity (membership-gated)
//   7. runtime audit clean
// ---------------------------------------------------------------------------

test.describe("Workspace activity", () => {
  test("records meaningful member/project/share events with server actors and hides them from non-members", async ({
    browser,
  }) => {
    test.setTimeout(300_000);

    const emailA = `act-a-${uniqueSuffix()}@example.com`;
    const emailB = `act-b-${uniqueSuffix()}@example.com`;
    const wsName = `Activity ${uniqueSuffix().slice(-4)}`;
    const projectName = "Activity Project";

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

    // 3. B edits and saves (B holds the lease — no editor open on A's side).
    await selectWorkspace(pageB, wsName);
    await openWorkspaceProjectFromDashboard(pageB, projectId);
    // Wait for the editor session to resolve as editable (access + lease + a
    // re-hydration of the server project) BEFORE editing — an edit made while
    // access is still resolving would be discarded by the re-hydration.
    await expectEditingIndicator(pageB, "Editing");
    await expect(pageB.locator('[data-testid="section-wrapper"]').first()).toBeVisible({
      timeout: 15000,
    });
    await pageB.locator('[data-testid="section-wrapper"]').first().click();
    await expect(pageB.locator('[data-testid="inspector-panel"]')).toBeVisible({ timeout: 10000 });
    await pageB
      .locator('[data-testid="inspector-panel"] textarea')
      .first()
      .fill("Edited by B for activity");
    await expect
      .poll(
        async () => (await fetchWorkspaceProject(pageB, wsId, projectId)).revision,
        { timeout: 30000, intervals: [500, 1000, 2000] },
      )
      .toBeGreaterThanOrEqual(2);
    // B exits → lease released so A can open the project.
    await pageB.getByRole("button", { name: "Back to Dashboard" }).click();
    await pageB.waitForURL(/\//, { timeout: 30000 });

    // 4. A opens the project → creates + revokes a review link (bridged
    // activity events fire while the workspace context is active).
    await selectWorkspace(pageA, wsName);
    await openWorkspaceProjectFromDashboard(pageA, projectId);
    await createReviewLink(pageA);
    await openShareDialog(pageA);
    await pageA.locator('[data-testid^="share-revoke-"]').first().click();
    await expect(pageA.locator('[data-testid="share-confirm-dialog"]')).toBeVisible({
      timeout: 10000,
    });
    await pageA.locator('[data-testid="share-confirm-action"]').click();
    await expect(pageA.locator('[data-testid="share-confirm-dialog"]')).toBeHidden({
      timeout: 10000,
    });
    await pageA.locator('[data-testid="share-dialog-close"]').click();
    await pageA.getByRole("button", { name: "Back to Dashboard" }).click();
    await pageA.waitForURL(/\//, { timeout: 30000 });

    // Server-side: the feed is ordered newest-first and every event has a
    // server-derived actor + allow-listed metadata (no tokens, ever).
    const feed = await listActivity(pageA, wsId);
    const types = feed.events.map((e) => e.type);
    expect(types).toContain("workspace.created");
    // The dashboard "new project in workspace" flow creates the project
    // locally then moves it into the workspace (origin: "move-in").
    expect(types).toContain("project.moved_in");
    expect(types).toContain("member.invited");
    expect(types).toContain("member.joined");
    expect(types).toContain("project.saved");
    expect(types).toContain("share.created");
    expect(types).toContain("share.revoked");
    expect(feed.events[0]).toBeDefined();
    // Newest first.
    for (let i = 1; i < feed.events.length; i++) {
      expect(feed.events[i - 1].createdAt >= feed.events[i].createdAt).toBe(true);
    }
    // The save's actor is B (server-derived from B's session, never client
    // forged) and share events carry no token-like metadata. The display name
    // follows the server-side email heuristic ("act-b-…" → "Act B").
    const savedEvent = feed.events.find((e) => e.type === "project.saved");
    expect(savedEvent?.actorUserId).toBeTruthy();
    expect(savedEvent?.actorName).toBe("Act B");
    for (const type of ["share.created", "share.revoked"]) {
      const event = feed.events.find((e) => e.type === type);
      expect(event).toBeTruthy();
      expect(event!.metadata).toBeDefined();
      expect(JSON.stringify(event!.metadata)).not.toMatch(/token|secret|share\/[A-Za-z0-9]{20,}/i);
    }

    // 5. Dashboard Activity tab renders plain-language events with actor
    // names; internal type names are never shown.
    await expect(pageA.locator('[data-testid="workspace-switcher"]')).toBeVisible({
      timeout: 15000,
    });
    await pageA.locator('[data-testid="workspace-tab-activity"]').click();
    await expect(pageA.locator('[data-testid="workspace-activity-panel"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(pageA.locator('[data-testid="activity-event"]').first()).toBeVisible({
      timeout: 15000,
    });
    // Actor names (email-derived, server-provided): the newest event is A's
    // share.revoked ("act-a-…" → "Act A").
    await expect(pageA.locator('[data-testid="activity-event"]').first()).toContainText(
      "Act A",
    );
    // Plain-language sentences; internal type names are never shown verbatim.
    await expect(pageA.locator('[data-testid="workspace-activity-panel"]')).toContainText(
      "created a review link",
    );
    expect(await pageA.locator('[data-testid="workspace-activity-panel"]').textContent()).not.toMatch(
      /share\.revoked|member\.invited|project\.created/,
    );

    // 6. Isolation: a signed-in non-member C reads no activity and no
    // presence (403 on both wire endpoints).
    const contextC = await browser.newContext();
    const pageC = await contextC.newPage();
    await openDashboardAndSignUp(pageC, `act-c-${uniqueSuffix()}@example.com`);
    const deniedActivity = await pageC.request.get(
      `http://localhost:3000/api/workspaces/${wsId}/activity`,
      { headers: { Authorization: `Bearer ${(await pageC.evaluate(() => localStorage.getItem("buildora.mock_session"))) ?? ""}` } },
    );
    expect(deniedActivity.status()).toBe(403);
    const deniedPresence = await getPresence(pageC, wsId);
    expect(deniedPresence.status).toBe(403);
    await contextC.close();

    assertRuntimeClean(auditA.state);
    assertRuntimeClean(auditB.state);

    await contextA.close();
    await contextB.close();
  });
});
