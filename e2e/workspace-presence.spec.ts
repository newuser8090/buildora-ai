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
  listWorkspaces,
  uniqueSuffix,
} from "./helpers/workspaces";
import { getPresence } from "./helpers/p15";

// ---------------------------------------------------------------------------
// Phase P15→P16 — E2E: workspace presence
//
// Phase P16 removed the exclusive ordinary edit lease, so BOTH editors are
// simultaneously "editing" (mode is server-truthful, never self-claimed).
//
// Deterministic flow (three browser contexts = three accounts):
//   1. A opens a workspace project → live presence: "You're editing"
//   2. B (editor) opens the SAME project while A is still in it → B is also
//      "editing" (simultaneous editing — the P16 behavior)
//   3. A sees B present as editing; B sees A present as editing
//   4. A exits → best-effort leave → B observes A leave (bounded poll)
//   5. Non-member C can read no presence (membership-gated, no leakage)
//   6. runtime audit clean
// ---------------------------------------------------------------------------

test.describe("Workspace presence", () => {
  test("members see truthful viewing/editing presence; leaving clears it; non-members see nothing", async ({
    browser,
  }) => {
    test.setTimeout(300_000);

    const emailA = `pres-a-${uniqueSuffix()}@example.com`;
    const emailB = `pres-b-${uniqueSuffix()}@example.com`;
    const wsName = `Presence ${uniqueSuffix().slice(-4)}`;
    const projectName = "Presence Project";

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

    // 1. A opens the project editable → presence session joins as "editing".
    // The indicator shows self + the live status.
    await selectWorkspace(pageA, wsName);
    await openWorkspaceProjectFromDashboard(pageA, projectId);
    await expect(pageA.locator('[data-testid="workspace-presence"]')).toBeVisible({
      timeout: 20000,
    });
    await expect(pageA.locator('[data-testid="presence-self"]')).toContainText("editing", {
      timeout: 15000,
    });

    // 2. B (editor) opens the SAME project while A is still in it → B is also
    // "editing" (P16 simultaneous editing — no exclusive lease, so both
    // editors show editing; the client never self-claims, the access boundary
    // is server-resolved and both members hold editor role).
    await selectWorkspace(pageB, wsName);
    await openWorkspaceProjectFromDashboard(pageB, projectId);
    await expect(pageB.locator('[data-testid="workspace-presence"]')).toBeVisible({
      timeout: 20000,
    });
    await expect(pageB.locator('[data-testid="presence-self"]')).toContainText("editing", {
      timeout: 15000,
    });

    // 3. Cross-observation via the shared mock "cloud": A sees B (editing),
    // B sees A (editing) — both members are editors editing simultaneously.
    const nameB = "Pres B"; // email `pres-b-…` → server display-name heuristic
    await expect(pageA.locator('[data-testid="presence-other"]').first()).toContainText(nameB, {
      timeout: 20000,
    });
    await expect(pageA.locator('[data-testid="presence-other"]').first()).toContainText(
      "is editing",
      { timeout: 20000 },
    );
    await expect(pageB.locator('[data-testid="presence-other"]').first()).toContainText(
      "is editing",
      { timeout: 20000 },
    );

    // The server list is membership-scoped and shows both sessions with the
    // same display names the UI uses; both are "editing" (simultaneous).
    const presenceForA = await getPresence(pageA, wsId);
    expect(presenceForA.ok).toBe(true);
    expect(presenceForA.sessions.length).toBeGreaterThanOrEqual(2);
    const names = presenceForA.sessions.map((s) => s.displayName);
    expect(names).toContain(nameB);
    const modes = presenceForA.sessions.map((s) => s.mode);
    expect(modes.every((m) => m === "editing" || m === "viewing")).toBe(true);

    // 4. A exits the editor → best-effort leave → B's bounded poll observes
    // A's departure (no stale "online" state after leaving).
    await pageA.getByRole("button", { name: "Back to Dashboard" }).click();
    await pageA.waitForURL(/\//, { timeout: 30000 });
    await expect(pageA.locator('[data-testid="workspace-switcher"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(pageB.locator('[data-testid="presence-other"]')).toHaveCount(0, {
      timeout: 30000,
    });

    // 5. Isolation: a signed-in non-member C cannot read the workspace's
    // presence — the server enforces membership on every read.
    const contextC = await browser.newContext();
    const pageC = await contextC.newPage();
    await openDashboardAndSignUp(pageC, `pres-c-${uniqueSuffix()}@example.com`);
    const denied = await getPresence(pageC, wsId);
    expect(denied.ok).toBe(false);
    expect(denied.status).toBe(403);
    expect(denied.code).toBe("PERMISSION_DENIED");
    await contextC.close();

    assertRuntimeClean(auditA.state);
    assertRuntimeClean(auditB.state);

    await contextA.close();
    await contextB.close();
  });
});
