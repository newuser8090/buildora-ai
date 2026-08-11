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
  mockToken,
} from "./helpers/workspaces";
import {
  openHeroInspector,
  headlineTextarea,
  waitForCollabStatus,
  forceCollabDisconnect,
  forceCollabReconnect,
} from "./helpers/collab";

// ---------------------------------------------------------------------------
// Phase P16 — E2E: realtime permissions & authorization changes
//
// The server is authoritative for EVERY collaborative mutation — the UI
// disables buttons, but the wire must reject forged / stale / downgraded /
// removed senders. Deterministic flow (mock room, four accounts):
//
//   1. A (owner) + B (editor) both send/receive collaborative updates
//   2. C (viewer) receives live updates but cannot mutate through the UI
//   3. C cannot forge a collab update through the API (403)
//   4. A downgrades B editor → viewer
//   5. B's next local edit is rejected server-side → B flips to read-only,
//      and the edit never reaches the server
//   6. B's offline-queued edit is NOT uploaded after the downgrade
//   7. A removes B from the workspace
//   8. B loses room access entirely (join/send/seed/checkpoint all 403)
//   9. forged role/user/workspace ids are ignored — server derives authority
//  10. cross-workspace room join denied (D, unrelated member)
//  11. A remains fully functional throughout
//  12. runtime audit clean
// ---------------------------------------------------------------------------

interface Member {
  userId: string;
  email: string;
  role: string;
}

async function authHeaders(page: import("@playwright/test").Page): Promise<Record<string, string>> {
  const token = await mockToken(page);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function listMembers(
  page: import("@playwright/test").Page,
  workspaceId: string,
): Promise<Member[]> {
  const res = await page.request.get(
    `http://localhost:3000/api/workspaces/${workspaceId}/members`,
    { headers: await authHeaders(page) },
  );
  expect(res.ok()).toBe(true);
  const envelope = (await res.json()) as { ok: boolean; data: Member[] };
  return envelope.data;
}

async function changeRole(
  page: import("@playwright/test").Page,
  workspaceId: string,
  memberUserId: string,
  role: "editor" | "viewer",
): Promise<number> {
  const res = await page.request.patch(
    `http://localhost:3000/api/workspaces/${workspaceId}/members/${memberUserId}`,
    { headers: await authHeaders(page), data: { role } },
  );
  return res.status();
}

async function removeMember(
  page: import("@playwright/test").Page,
  workspaceId: string,
  memberUserId: string,
): Promise<number> {
  const res = await page.request.delete(
    `http://localhost:3000/api/workspaces/${workspaceId}/members/${memberUserId}`,
    { headers: await authHeaders(page) },
  );
  return res.status();
}

/** Direct collab API helper — returns { status, code }. */
async function collabCall(
  page: import("@playwright/test").Page,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; code?: string }> {
  const url = `http://localhost:3000/api/collab/${path}`;
  const res =
    method === "GET"
      ? await page.request.get(url, { headers: await authHeaders(page) })
      : await page.request.post(url, {
          headers: await authHeaders(page),
          data: body ?? {},
        });
  const envelope = (await res.json().catch(() => null)) as
    | { ok: boolean; error?: { code?: string } }
    | null;
  return {
    status: res.status(),
    code: envelope?.error?.code,
  };
}

test.describe("Realtime permissions", () => {
  test("viewer is live read-only, downgrade/removal are server-enforced, forged sends rejected", async ({
    browser,
  }) => {
    test.setTimeout(360_000);

    const emailA = `perm-a-${uniqueSuffix()}@example.com`;
    const emailB = `perm-b-${uniqueSuffix()}@example.com`;
    const emailC = `perm-c-${uniqueSuffix()}@example.com`;
    const emailD = `perm-d-${uniqueSuffix()}@example.com`;
    const wsName = `RtPerm ${uniqueSuffix().slice(-4)}`;
    const projectName = "RtPerm Project";

    // ----------------------------- Setup -----------------------------
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const auditA = attachRuntimeAudit(pageA);

    await openDashboardAndSignUp(pageA, emailA);
    await createWorkspace(pageA, wsName);
    const projectId = await createProjectInWorkspace(pageA, projectName);
    await openWorkspaceSettings(pageA);
    await inviteMember(pageA, emailB, "editor");
    await inviteMember(pageA, emailC, "viewer");
    await pageA.locator('[data-testid="workspace-settings-close"]').click();

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    const auditB = attachRuntimeAudit(pageB);
    await openDashboardAndSignUp(pageB, emailB);
    await acceptInvitation(pageB);

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

    const listingA = await listWorkspaces(pageA);
    const wsId = [...listingA.owned, ...listingA.shared].find(
      (w) => w.name === wsName,
    )!.id;
    const members = await listMembers(pageA, wsId);
    const bUser = members.find((m) => m.email === emailB);
    expect(bUser).toBeTruthy();
    const cUser = members.find((m) => m.email === emailC);
    expect(cUser).toBeTruthy();

    // -------------------------------------------------------------------
    // 1. A (owner) + B (editor) both send/receive live updates.
    // -------------------------------------------------------------------
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

    const aText = `A live ${uniqueSuffix().slice(-4)}`;
    const bText = `B live ${uniqueSuffix().slice(-4)}`;
    await headlineTextarea(pageA).fill(aText);
    await expect(headlineTextarea(pageB)).toHaveValue(aText, { timeout: 15000 });
    await headlineTextarea(pageB).fill(bText);
    await expect(headlineTextarea(pageA)).toHaveValue(bText, { timeout: 15000 });

    // -------------------------------------------------------------------
    // 2. C (viewer) receives live updates but is read-only in the UI.
    // -------------------------------------------------------------------
    await selectWorkspace(pageC, wsName);
    await openWorkspaceProjectFromDashboard(pageC, projectId);
    await expectEditingIndicator(pageC, "Read only");
    await waitForCollabStatus(pageC, "collab-status-synced");
    // C receives A's live edit (viewer realtime).
    await openHeroInspector(pageC);
    await expect(headlineTextarea(pageC)).toHaveValue(bText, { timeout: 15000 });
    // A edits again → C sees it without reload.
    const cLive = `A live again ${uniqueSuffix().slice(-4)}`;
    await headlineTextarea(pageA).fill(cLive);
    await expect(headlineTextarea(pageC)).toHaveValue(cLive, { timeout: 15000 });

    // C's UI edit must NOT land (store boundary blocks the mutation).
    await headlineTextarea(pageC).fill("viewer forged attempt");
    await pageC.waitForTimeout(2500);
    let server = await fetchWorkspaceProject(pageA, wsId, projectId);
    expect(JSON.stringify(server.project)).not.toContain("viewer forged attempt");

    // 3. C cannot forge a collab update through the API (server-authoritative).
    const cSend = await collabCall(pageC, "POST", `rooms/${wsId}/${projectId}/send`, {
      update: "Zm9yZ2Vk",
    });
    expect(cSend.status).toBe(403);
    expect(cSend.code).toBe("PERMISSION_DENIED");

    // -------------------------------------------------------------------
    // 4-5. Downgrade B editor → viewer: next edit rejected → read-only.
    // -------------------------------------------------------------------
    expect(await changeRole(pageA, wsId, bUser!.userId, "viewer")).toBe(200);

    // B's next local edit is rejected server-side (PERMISSION_DENIED → the
    // session transitions to an honest read-only state) and never reaches the
    // server.
    const bDowngraded = `B downgraded ${uniqueSuffix().slice(-4)}`;
    await headlineTextarea(pageB).fill(bDowngraded);
    await expectEditingIndicator(pageB, "Read only");
    await pageB.waitForTimeout(2500);
    server = await fetchWorkspaceProject(pageA, wsId, projectId);
    expect(JSON.stringify(server.project)).not.toContain(bDowngraded);

    // 6. B's offline-queued edit is NOT uploaded after the downgrade.
    await forceCollabDisconnect(pageB);
    await headlineTextarea(pageB).fill("B queued offline");
    await forceCollabReconnect(pageB);
    await pageB.waitForTimeout(2500);
    server = await fetchWorkspaceProject(pageA, wsId, projectId);
    expect(JSON.stringify(server.project)).not.toContain("B queued offline");

    // -------------------------------------------------------------------
    // 7-8. Remove B from the workspace → total loss of room access.
    // -------------------------------------------------------------------
    expect(await removeMember(pageA, wsId, bUser!.userId)).toBe(200);

    // B's client flips to an honest unauthorized read-only state.
    await expectEditingIndicator(pageB, "Read only");

    // B cannot join the room anymore.
    const bJoin = await collabCall(pageB, "POST", `rooms/${wsId}/${projectId}/join`, {});
    expect(bJoin.status).toBe(403);
    expect(bJoin.code).toBe("PERMISSION_DENIED");
    // B cannot send (even a forged role body is ignored — server derives it).
    const bSend = await collabCall(pageB, "POST", `rooms/${wsId}/${projectId}/send`, {
      update: "Zm9yZ2Vk",
      role: "owner",
    });
    expect(bSend.status).toBe(403);
    // B cannot seed room state.
    const bSeed = await collabCall(pageB, "POST", `rooms/${wsId}/${projectId}/seed`, {
      state: "Zm9yZ2Vk",
    });
    expect(bSeed.status).toBe(403);
    // B cannot checkpoint/prune.
    const bCheckpoint = await collabCall(
      pageB,
      "POST",
      `rooms/${wsId}/${projectId}/checkpoint`,
      { seq: 1 },
    );
    expect(bCheckpoint.status).toBe(403);
    // B cannot acquire the maintenance lock.
    const bLock = await collabCall(pageB, "POST", `rooms/${wsId}/${projectId}/lock`, {});
    expect(bLock.status).toBe(403);

    // 9. Forged user/workspace ids: B's token is bound to B's identity — it
    // can't read another user's presence either (membership-gated).
    const bPresence = await pageB.request.get(
      `http://localhost:3000/api/presence/workspace/${wsId}`,
      { headers: await authHeaders(pageB) },
    );
    expect(bPresence.status()).toBe(403);

    // -------------------------------------------------------------------
    // 10. Cross-workspace room join denied (D is a member of another
    //     workspace, never this one).
    // -------------------------------------------------------------------
    const dJoin = await collabCall(pageD, "POST", `rooms/${wsId}/${projectId}/join`, {});
    expect(dJoin.status).toBe(403);
    expect(dJoin.code).toBe("PERMISSION_DENIED");

    // -------------------------------------------------------------------
    // 11. A remains fully functional throughout.
    // -------------------------------------------------------------------
    await expect(headlineTextarea(pageA)).toHaveValue(cLive);
    const aFinal = `A final ${uniqueSuffix().slice(-4)}`;
    await headlineTextarea(pageA).fill(aFinal);
    await expect
      .poll(
        async () => {
          const s = await fetchWorkspaceProject(pageA, wsId, projectId);
          return JSON.stringify(s.project).includes(aFinal);
        },
        { timeout: 30000, intervals: [500, 1000, 2000] },
      )
      .toBe(true);

    // 12. Runtime audit clean on all clients.
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
