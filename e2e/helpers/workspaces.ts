import { expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Phase P14 — Team Workspaces & Controlled Collaboration: shared E2E helpers
//
// Workspace features use the same deterministic mock backend as P6 (state in
// the dev-server process), so two browser contexts share ONE "cloud" and the
// E2E can simulate two accounts collaborating on the same project.
//
// Helpers drive the REAL product UI (dashboard switcher, settings dialog,
// invitations panel, editor) and use the same /api/workspaces wire contract
// for deterministic assertions (never bypass product behavior).
// ---------------------------------------------------------------------------

/** Unique-ish suffix so dev-server mock accounts never collide between tests. */
export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

// ---------------------------------------------------------------------------
// Dashboard entry
// ---------------------------------------------------------------------------

/**
 * Open the dashboard and sign up with a fresh account (mock backend has no
 * email confirmation). Uses the real dashboard auth flow.
 */
export async function openDashboardAndSignUp(page: Page, email: string): Promise<void> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[data-testid="cloud-sync-status"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-testid="cloud-sync-status"]').click();
  await page.getByRole("menuitem", { name: "Sign in to back up", exact: true }).click();
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill("password123");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  // Auth dialog closes on success (no local pieces → no merge prompt).
  await expect(
    page.getByRole("dialog", { name: /Welcome back|Create your account/ }),
  ).toBeHidden({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 15000 });
}

// ---------------------------------------------------------------------------
// Workspace switcher + management
// ---------------------------------------------------------------------------

/** Open the switcher menu and click "New workspace" → create a workspace. */
export async function createWorkspace(page: Page, name: string): Promise<string> {
  // P16 note: waits are 20s (not 10s) so a COLD webpack dev server's first
  // on-demand compile of / + /api/workspaces (measured 6–14s on Windows) can
  // never exceed the helper timeout. Timeout bumps only — no assertion changes.
  await page.locator('[data-testid="workspace-switcher"]').click();
  await page.getByRole("menuitem", { name: "New workspace", exact: true }).click();
  await expect(page.locator('[data-testid="workspace-settings-dialog"]')).toBeVisible({
    timeout: 20000,
  });
  await page.locator('[data-testid="workspace-create-name"]').fill(name);
  await page.locator('[data-testid="workspace-create-button"]').click();
  // Create closes the dialog and selects the new workspace.
  await expect(page.locator('[data-testid="workspace-settings-dialog"]')).toBeHidden({
    timeout: 20000,
  });
  await expect(page.locator('[data-testid="workspace-view-title"]')).toHaveText(name, {
    timeout: 20000,
  });
  return name;
}

/**
 * Open the settings dialog for the currently selected workspace. When the
 * user is not the owner there is no Manage button, so opening the settings is
 * only valid for owners (tests gate on this elsewhere).
 */
export async function openWorkspaceSettings(page: Page): Promise<void> {
  await page.locator('[data-testid="workspace-manage-button"]').click();
  await expect(page.locator('[data-testid="workspace-settings-dialog"]')).toBeVisible({
    timeout: 10000,
  });
}



/** Invite a member with a role (owner only). */
export async function inviteMember(
  page: Page,
  email: string,
  role: "editor" | "viewer",
): Promise<void> {
  await page.locator('[data-testid="workspace-invite-email"]').fill(email);
  await page.locator('[data-testid="workspace-invite-role"]').selectOption(role);
  await page.locator('[data-testid="workspace-invite-button"]').click();
  await expect(page.locator('[data-testid="workspace-settings-success"]')).toBeVisible({
    timeout: 10000,
  });
  await expect(page.locator('[data-testid="workspace-settings-success"]')).toContainText(
    "Invitation sent",
  );
}

/** Accept the current user's pending invitation via the invitations panel. */
export async function acceptInvitation(page: Page): Promise<void> {
  // The switcher shows the pending-invitation entry.
  await page.locator('[data-testid="workspace-switcher"]').click();
  await page.getByRole("menuitem", { name: /pending invitation/ }).click();
  await expect(page.locator('[data-testid="workspace-invitations-panel"]')).toBeVisible({
    timeout: 10000,
  });
  await page.locator('[data-testid^="workspace-accept-invite-"]').first().click();
  await expect(page.locator('[data-testid="workspace-invitations-panel"]')).toContainText(
    "No pending invitations",
    { timeout: 10000 },
  );
  // Close the panel.
  await page.getByRole("button", { name: "Close invitations", exact: true }).click();
}

/** Select a workspace in the switcher (by name). */
export async function selectWorkspace(page: Page, name: string): Promise<void> {
  await page.locator('[data-testid="workspace-switcher"]').click();
  await page.getByRole("menuitem", { name }).click();
  await expect(page.locator('[data-testid="workspace-view-title"]')).toHaveText(name, {
    timeout: 10000,
  });
}

// ---------------------------------------------------------------------------
// Workspace projects
// ---------------------------------------------------------------------------

/**
 * Create a project inside the currently selected workspace via the real
 * dashboard flow (workspace "New Project" → template). Returns the project id.
 */
export async function createProjectInWorkspace(page: Page, name: string): Promise<string> {
  await page.locator('[data-testid="workspace-new-project-button"]').click();
  await expect(page.getByRole("dialog", { name: "New Project" })).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Use Blank Project" }).first().click();
  await page.locator("#new-project-name").fill(name);
  await page.locator('[data-testid="create-project-button"]').click();
  // The workspace grid refreshes with the new card (no navigation).
  await expect(page.locator('[data-testid^="workspace-project-card-"]')).toHaveCount(1, {
    timeout: 20000,
  });
  // Extract the project id from the card testid.
  const testId = await page
    .locator('[data-testid^="workspace-project-card-"]')
    .first()
    .getAttribute("data-testid");
  if (!testId) throw new Error("Workspace project card not found");
  return testId.replace(/^workspace-project-card-/, "");
}

/**
 * Open a workspace project from its dashboard card (real UI flow) and wait
 * for the editor. Returns once the editor root is visible.
 */
export async function openWorkspaceProjectFromDashboard(page: Page, projectId: string): Promise<void> {
  await page.locator(`[data-testid="workspace-project-card-${projectId}"]`).click();
  await page.waitForURL(/\/editor\/.+/, { timeout: 30000 });
  await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({ timeout: 30000 });
}

/** Assert the editor's collaboration indicator text (e.g. "Editing", "Read only"). */
export async function expectEditingIndicator(page: Page, text: string): Promise<void> {
  await expect(page.locator('[data-testid="workspace-editing-indicator"]')).toContainText(text, {
    timeout: 20000,
  });
}

// ---------------------------------------------------------------------------
// Mock API helpers (deterministic assertions against the wire contract)
// ---------------------------------------------------------------------------

/** The mock session token stored by the dev-only auth service. */
export async function mockToken(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem("buildora.mock_session"));
}

async function authHeaders(page: Page): Promise<Record<string, string>> {
  const token = await mockToken(page);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface WorkspaceApiProject {
  projectId: string;
  workspaceId: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  project?: unknown;
}

/** Fetch the server-authoritative workspace project (raw payload). */
export async function fetchWorkspaceProject(
  page: Page,
  workspaceId: string,
  projectId: string,
): Promise<WorkspaceApiProject> {
  const res = await page.request.get(
    `http://localhost:3000/api/workspaces/${workspaceId}/projects/${encodeURIComponent(projectId)}`,
    { headers: await authHeaders(page) },
  );
  expect(res.ok()).toBe(true);
  const envelope = (await res.json()) as { ok: boolean; data: WorkspaceApiProject };
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

/** List workspaces the current user belongs to. */
export async function listWorkspaces(page: Page): Promise<{
  owned: Array<{ id: string; name: string; memberRole: string }>;
  shared: Array<{ id: string; name: string; memberRole: string }>;
}> {
  const res = await page.request.get("http://localhost:3000/api/workspaces", {
    headers: await authHeaders(page),
  });
  expect(res.ok()).toBe(true);
  const envelope = (await res.json()) as { ok: boolean; data: unknown };
  expect(envelope.ok).toBe(true);
  return envelope.data as never;
}

/** Save a workspace project with an explicit expectedRevision (optimistic). */
export async function saveWorkspaceProject(
  page: Page,
  input: {
    workspaceId: string;
    projectId: string;
    project: unknown;
    expectedRevision: number;
  },
): Promise<{ ok: boolean; status: number; code?: string }> {
  const res = await page.request.post("http://localhost:3000/api/workspaces/save", {
    headers: await authHeaders(page),
    data: input,
  });
  const envelope = (await res.json().catch(() => null)) as
    | { ok: boolean; data?: unknown; error?: { code?: string } }
    | null;
  return {
    ok: res.ok() && !!envelope?.ok,
    status: res.status(),
    code: envelope?.error?.code,
  };
}

/** Wait until the server revision of a workspace project reaches a value. */
export async function waitForWorkspaceRevision(
  page: Page,
  workspaceId: string,
  projectId: string,
  minRevision: number,
  timeout = 30000,
): Promise<void> {
  await expect
    .poll(
      async () => (await fetchWorkspaceProject(page, workspaceId, projectId)).revision,
      { timeout, intervals: [500, 1000, 2000] },
    )
    .toBeGreaterThanOrEqual(minRevision);
}

/** Current edit lease for a project (null when none). */
export async function getEditLease(
  page: Page,
  workspaceId: string,
  projectId: string,
): Promise<{ leaseId: string; userId: string } | null> {
  const res = await page.request.get(
    `http://localhost:3000/api/workspaces/${workspaceId}/projects/${encodeURIComponent(projectId)}/lease`,
    { headers: await authHeaders(page) },
  );
  expect(res.ok()).toBe(true);
  const envelope = (await res.json()) as { ok: boolean; data: { leaseId: string; userId: string } | null };
  return envelope.data;
}

/** Wait until no active lease remains on the project (deterministic handover). */
export async function waitForLeaseReleased(
  page: Page,
  workspaceId: string,
  projectId: string,
  timeout = 30000,
): Promise<void> {
  await expect
    .poll(
      async () => (await getEditLease(page, workspaceId, projectId)) === null,
      { timeout, intervals: [300, 500, 1000] },
    )
    .toBe(true);
}
