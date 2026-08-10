import { expect, type Page } from "@playwright/test";
import { mockToken } from "./workspaces";

// ---------------------------------------------------------------------------
// Phase P15 — Presence, Activity & Version History: shared E2E helpers
//
// Workspace features use the same deterministic mock backend as P6/P14 (state
// in the dev-server process), so two browser contexts share ONE "cloud". These
// helpers assert the /api/workspaces + /api/presence wire contract so tests
// can verify server-authoritative behavior (actor derivation, revision
// semantics, retention) deterministically without bypassing product behavior.
// ---------------------------------------------------------------------------

async function authHeaders(page: Page): Promise<Record<string, string>> {
  const token = await mockToken(page);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface ActivityEvent {
  id: string;
  workspaceId: string;
  projectId: string | null;
  actorUserId: string;
  actorName?: string | null;
  type: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface VersionMeta {
  id: string;
  workspaceId: string;
  projectId: string;
  revision: number;
  createdBy: string;
  createdByName?: string | null;
  createdAt: string;
  reason: string;
  contentHash: string;
}

/** Fetch the workspace activity feed (latest first, bounded page). */
export async function listActivity(
  page: Page,
  workspaceId: string,
  filter?: string,
): Promise<{ events: ActivityEvent[]; nextCursor: string | null }> {
  const url = new URL(`http://localhost:3000/api/workspaces/${workspaceId}/activity`);
  if (filter) url.searchParams.set("filter", filter);
  const res = await page.request.get(url.toString(), { headers: await authHeaders(page) });
  expect(res.ok()).toBe(true);
  const envelope = (await res.json()) as { ok: boolean; data: { events: ActivityEvent[]; nextCursor: string | null } };
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

/** Metadata-only version list for a workspace project. */
export async function listProjectVersions(
  page: Page,
  workspaceId: string,
  projectId: string,
): Promise<VersionMeta[]> {
  const res = await page.request.get(
    `http://localhost:3000/api/workspaces/${workspaceId}/projects/${encodeURIComponent(projectId)}/versions`,
    { headers: await authHeaders(page) },
  );
  expect(res.ok()).toBe(true);
  const envelope = (await res.json()) as { ok: boolean; data: VersionMeta[] };
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

/** Fetch a full version snapshot (lazy — only when previewing/restoring). */
export async function fetchProjectVersion(
  page: Page,
  workspaceId: string,
  projectId: string,
  versionId: string,
): Promise<{ id: string; revision: number; project: { name: string } }> {
  const res = await page.request.get(
    `http://localhost:3000/api/workspaces/${workspaceId}/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}`,
    { headers: await authHeaders(page) },
  );
  expect(res.ok()).toBe(true);
  const envelope = (await res.json()) as { ok: boolean; data: { id: string; revision: number; project: { name: string } } };
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

/** Attempt a restore with an explicit expectedRevision (optimistic). */
export async function restoreVersionViaApi(
  page: Page,
  workspaceId: string,
  projectId: string,
  versionId: string,
  expectedRevision: number,
): Promise<{ ok: boolean; status: number; code?: string }> {
  const res = await page.request.post(
    `http://localhost:3000/api/workspaces/${workspaceId}/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}/restore`,
    { headers: await authHeaders(page), data: { expectedRevision } },
  );
  const envelope = (await res.json().catch(() => null)) as
    | { ok: boolean; data?: { revision: number }; error?: { code?: string } }
    | null;
  return {
    ok: res.ok() && !!envelope?.ok,
    status: res.status(),
    code: envelope?.error?.code,
  };
}

/** Live presence sessions for a workspace (server list, membership-gated). */
export async function getPresence(
  page: Page,
  workspaceId: string,
): Promise<{
  ok: boolean;
  status: number;
  code?: string;
  sessions: Array<{ userId: string; displayName: string; mode: string; sessionId: string }>;
}> {
  const res = await page.request.get(
    `http://localhost:3000/api/presence/workspace/${workspaceId}`,
    { headers: await authHeaders(page) },
  );
  const envelope = (await res.json().catch(() => null)) as
    | { ok: boolean; data?: unknown; error?: { code?: string } }
    | null;
  return {
    ok: res.ok() && !!envelope?.ok,
    status: res.status(),
    code: envelope?.error?.code,
    sessions: (envelope?.data as never) ?? [],
  };
}

/** Open the editor version-history dialog (workspace projects only). */
export async function openVersionHistory(page: Page): Promise<void> {
  await page.locator('[data-testid="topnav-history-button"]').click();
  await expect(page.locator('[data-testid="version-history-dialog"]')).toBeVisible({
    timeout: 10000,
  });
}
