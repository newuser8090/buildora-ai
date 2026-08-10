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
} from "./helpers/workspaces";

// ---------------------------------------------------------------------------
// Phase P14 — E2E: workspace permissions
//
// Verifies the permission matrix end-to-end (the mock backend enforces the
// SAME rules as the Supabase RLS/RPCs):
//   - viewer: genuinely read-only (no editor mutations, no publish, no share
//     management, no Copilot edit actions)
//   - editor: can edit but cannot manage members / owner-only actions
//   - owner: can manage members
//   - role downgrade editor → viewer takes effect
//   - removed member loses access
//   - cross-workspace project access denied
//   - sign-out does not leak workspace cache into the next account
// ---------------------------------------------------------------------------

test.describe("Workspace permissions", () => {
  test("roles are enforced and authorization changes take effect", async ({ browser }) => {
    test.setTimeout(300_000);

    const emailA = `perm-a-${uniqueSuffix()}@example.com`;
    const emailB = `perm-b-${uniqueSuffix()}@example.com`;
    const emailC = `perm-c-${uniqueSuffix()}@example.com`;
    const emailD = `perm-d-${uniqueSuffix()}@example.com`;
    const wsName = `Perm ${uniqueSuffix().slice(-4)}`;
    const projectName = "Perm Project";

    // ----------------------------- Setup -----------------------------
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const auditA = attachRuntimeAudit(pageA);

    await openDashboardAndSignUp(pageA, emailA);
    await createWorkspace(pageA, wsName);
    const projectId = await createProjectInWorkspace(pageA, projectName);
    // Invite B (editor), C (viewer).
    await openWorkspaceSettings(pageA);
    await inviteMember(pageA, emailB, "editor");
    await inviteMember(pageA, emailC, "viewer");
    await pageA.locator('[data-testid="workspace-settings-close"]').click();

    const listingA = await listWorkspaces(pageA);
    const wsId = [...listingA.owned, ...listingA.shared].find((w) => w.name === wsName)!.id;

    // B: editor account.
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    const auditB = attachRuntimeAudit(pageB);
    await openDashboardAndSignUp(pageB, emailB);
    await acceptInvitation(pageB);

    // C: viewer account.
    const contextC = await browser.newContext();
    const pageC = await contextC.newPage();
    const auditC = attachRuntimeAudit(pageC);
    await openDashboardAndSignUp(pageC, emailC);
    await acceptInvitation(pageC);

    // D: unrelated account with its own workspace (cross-workspace check).
    const contextD = await browser.newContext();
    const pageD = await contextD.newPage();
    const auditD = attachRuntimeAudit(pageD);
    await openDashboardAndSignUp(pageD, emailD);
    await createWorkspace(pageD, `Other ${uniqueSuffix().slice(-4)}`);

    // -------------------------------------------------------------------
    // 1. Viewer is genuinely read-only.
    // -------------------------------------------------------------------
    await selectWorkspace(pageC, wsName);
    await openWorkspaceProjectFromDashboard(pageC, projectId);
    await expect(pageC.locator('[data-testid="workspace-readonly-banner"]')).toBeVisible({
      timeout: 20000,
    });
    await expectEditingIndicator(pageC, "Read only");
    // Mutations blocked at the store boundary: undo is disabled.
    await expect(pageC.locator('[data-testid="undo-button"]')).toBeDisabled();
    // Publish + share management are disabled for viewers.
    await expect(pageC.locator('[data-testid="topnav-publish-button"]')).toBeDisabled();
    await expect(pageC.locator('[data-testid="topnav-share-button"]')).toBeDisabled();
    // Copilot is available but edit actions are rejected: the read-only
    // notice is shown inside the panel.
    await pageC.locator('[data-testid="topnav-copilot-button"]').click();
    await expect(pageC.locator('[data-testid="copilot-panel"]')).toBeVisible({ timeout: 15000 });
    await expect(pageC.locator('[data-testid="copilot-readonly-notice"]')).toBeVisible({
      timeout: 10000,
    });
    // The inspector edit cannot persist: attempting an edit keeps the editor
    // read-only (no revision bump, no save).
    await expect(pageC.locator('[data-testid="preview-content"]')).toBeVisible({ timeout: 15000 });
    await pageC.locator('[data-testid="section-wrapper"]').first().click();
    await expect(pageC.locator('[data-testid="inspector-panel"]')).toBeVisible({ timeout: 10000 });
    await pageC.locator('[data-testid="inspector-panel"] textarea').first().fill("viewer edit attempt");
    // Give the debounced save window time — a viewer edit must NOT land.
    await pageC.waitForTimeout(4000);
    const serverProject = await fetchWorkspaceProject(pageA, wsId, projectId);
    expect(JSON.stringify(serverProject.project)).not.toContain("viewer edit attempt");

    // -------------------------------------------------------------------
    // 2. Editor can edit but cannot manage members / owner-only actions.
    // -------------------------------------------------------------------
    await selectWorkspace(pageB, wsName);
    await openWorkspaceProjectFromDashboard(pageB, projectId);
    await expectEditingIndicator(pageB, "Editing");
    // Editor CAN save (revision bumps).
    await expect(pageB.locator('[data-testid="preview-content"]')).toBeVisible({ timeout: 15000 });
    await pageB.locator('[data-testid="section-wrapper"]').first().click();
    await expect(pageB.locator('[data-testid="inspector-panel"]')).toBeVisible({ timeout: 10000 });
    await pageB.locator('[data-testid="inspector-panel"] textarea').first().fill("editor's change");
    // Editor's save succeeds (this bumps revision 1 → 2).
    await expect
      .poll(
        async () => (await fetchWorkspaceProject(pageA, wsId, projectId)).revision,
        { timeout: 30000, intervals: [500, 1000, 2000] },
      )
      .toBeGreaterThanOrEqual(2);
    // Editor cannot manage members: the workspace settings show no member
    // management controls for an editor.
    await pageB.getByRole("button", { name: "Back to Dashboard" }).click();
    await pageB.waitForURL(/\/$/, { timeout: 30000 });
    await selectWorkspace(pageB, wsName);
    // The Manage button is owner-only — editors don't see it.
    await expect(pageB.locator('[data-testid="workspace-manage-button"]')).toHaveCount(0);
    // Server-side: an editor's attempt to list members is rejected.
    const membersRes = await pageB.request.get(
      `http://localhost:3000/api/workspaces/${wsId}/members`,
      { headers: await authHeaders(pageB) },
    );
    expect(membersRes.status()).toBe(403);
    // Server-side: an editor's attempt to change a role is rejected.
    const roleRes = await pageB.request.patch(
      `http://localhost:3000/api/workspaces/${wsId}/members/some-user-id`,
      { headers: await authHeaders(pageB), data: { role: "viewer" } },
    );
    expect(roleRes.status()).toBe(403);

    // -------------------------------------------------------------------
    // 3. Owner can manage members (invite worked; role change works).
    // -------------------------------------------------------------------
    await selectWorkspace(pageA, wsName);
    await openWorkspaceSettings(pageA);
    await expect(pageA.locator('[data-testid="workspace-invite-email"]')).toBeVisible();
    await expect(pageA.locator(`[data-testid="workspace-member-${emailB}"]`)).toBeVisible({
      timeout: 10000,
    });

    // -------------------------------------------------------------------
    // 4. Role downgrade editor → viewer takes effect (server-authoritative).
    // -------------------------------------------------------------------
    // Owner changes B's role to viewer.
    const memberB = (await fetchMembers(pageA, wsId)).find((m) => m.email === emailB);
    expect(memberB).toBeTruthy();
    const downgradeRes = await pageA.request.patch(
      `http://localhost:3000/api/workspaces/${wsId}/members/${encodeURIComponent(memberB!.userId)}`,
      { headers: await authHeaders(pageA), data: { role: "viewer" } },
    );
    expect(downgradeRes.ok()).toBe(true);
    // B is now viewer: their next save is rejected server-side.
    const staleSave = await saveWorkspaceProject(pageB, {
      workspaceId: wsId,
      projectId,
      project: JSON.parse(JSON.stringify((await fetchWorkspaceProject(pageB, wsId, projectId)).project)),
      expectedRevision: 2,
    });
    expect(staleSave.ok).toBe(false);
    expect(staleSave.code).toBe("PERMISSION_DENIED");
    // B's dashboard no longer lists the workspace as shared with editor role.
    const listingBAfter = await listWorkspaces(pageB);
    const bWs = [...listingBAfter.owned, ...listingBAfter.shared].find((w) => w.name === wsName);
    expect(bWs?.memberRole).toBe("viewer");

    // -------------------------------------------------------------------
    // 5. Removed member loses access (server-authoritative + UI).
    // -------------------------------------------------------------------
    const memberC = (await fetchMembers(pageA, wsId)).find((m) => m.email === emailC);
    expect(memberC).toBeTruthy();
    const removeRes = await pageA.request.delete(
      `http://localhost:3000/api/workspaces/${wsId}/members/${encodeURIComponent(memberC!.userId)}`,
      { headers: await authHeaders(pageA) },
    );
    expect(removeRes.ok()).toBe(true);
    // C's future access is denied immediately.
    const deniedFetch = await pageC.request.get(
      `http://localhost:3000/api/workspaces/${wsId}/projects/${projectId}`,
      { headers: await authHeaders(pageC) },
    );
    expect(deniedFetch.status()).toBe(403);

    // -------------------------------------------------------------------
    // 6. Cross-workspace access denied.
    // -------------------------------------------------------------------
    const crossRes = await pageD.request.get(
      `http://localhost:3000/api/workspaces/${wsId}/projects/${projectId}`,
      { headers: await authHeaders(pageD) },
    );
    expect(crossRes.status()).toBe(403);
    // D cannot list the workspace's projects either.
    const crossList = await pageD.request.get(
      `http://localhost:3000/api/workspaces/${wsId}/projects`,
      { headers: await authHeaders(pageD) },
    );
    expect(crossList.status()).toBe(403);

    // -------------------------------------------------------------------
    // 7. Sign-out does not leak workspace cache into the next account.
    // -------------------------------------------------------------------
    // D signs out; the workspace switcher (account-scoped) must not surface
    // any of A's workspace context after signing in as a fresh account in
    // the SAME context.
    await pageD.getByRole("button", { name: "Account menu" }).click();
    await pageD.getByRole("menuitem", { name: "Sign out", exact: true }).click();
    await expect(pageD.getByRole("button", { name: "Account menu" })).toBeVisible({
      timeout: 15000,
    });
    // Sign in with a brand-new account in D's context.
    const emailE = `perm-e-${uniqueSuffix()}@example.com`;
    await openDashboardAndSignUp(pageD, emailE);
    // E has no workspaces: the switcher shows Personal only and no stale
    // workspace from D/A/B/C.
    await pageD.locator('[data-testid="workspace-switcher"]').click();
    await expect(pageD.getByRole("menuitem", { name: "Personal", exact: true })).toBeVisible();
    await expect(pageD.getByRole("menuitem", { name: wsName, exact: true })).toHaveCount(0);
    // And the personal project grid is empty (no leaked project cards).
    await expect(pageD.getByText("Welcome to Buildora")).toBeVisible({ timeout: 10000 });

    assertRuntimeClean(auditA.state);
    assertRuntimeClean(auditB.state);
    assertRuntimeClean(auditC.state);
    assertRuntimeClean(auditD.state);

    await contextA.close();
    await contextB.close();
    await contextC.close();
    await contextD.close();
  });
});

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

async function authHeaders(page: import("@playwright/test").Page): Promise<Record<string, string>> {
  const token = await page.evaluate(() => localStorage.getItem("buildora.mock_session"));
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchMembers(
  page: import("@playwright/test").Page,
  workspaceId: string,
): Promise<Array<{ userId: string; email: string; role: string }>> {
  const res = await page.request.get(
    `http://localhost:3000/api/workspaces/${workspaceId}/members`,
    { headers: await authHeaders(page) },
  );
  expect(res.ok()).toBe(true);
  const envelope = (await res.json()) as { ok: boolean; data: Array<{ userId: string; email: string; role: string }> };
  return envelope.data;
}
