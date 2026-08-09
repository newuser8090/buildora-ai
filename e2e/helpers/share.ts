import { expect, type Page } from "@playwright/test";
import { createBlankProjectAndOpenEditor } from "./projects";
import { signUp, mockToken, uniqueSuffix } from "./cloud-sync";

// ---------------------------------------------------------------------------
// Phase P12 — shared E2E helpers
//
// The mock share backend lives in the dev-server process (Next.js API routes
// under /api/share/...), so two browser contexts hitting the same dev server
// share ONE "share cloud". Owner endpoints require the mock bearer session
// (same localStorage key as the P6 mock cloud); the public viewer endpoints
// are anonymous and scoped strictly by the raw token.
// ---------------------------------------------------------------------------

/** Open a fresh blank project in the editor (owner device). */
export async function openOwnerEditor(page: Page): Promise<string> {
  return createBlankProjectAndOpenEditor(page);
}

/**
 * Sign the owner up with deterministic mock auth. Dismisses the P6
 * initial-merge prompt when it appears (a fresh device with a fresh account
 * has nothing on either side, so it usually does not appear).
 */
export async function signInOwner(page: Page, email: string, password: string): Promise<void> {
  await signUp(page, email, password);
  await dismissMergeIfPresent(page);
}

async function dismissMergeIfPresent(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: /Buildora found saved pieces/ });
  try {
    await dialog.waitFor({ state: "visible", timeout: 4000 });
  } catch {
    return; // no merge prompt — nothing to dismiss
  }
  await dialog.getByRole("button", { name: "Merge both" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 15000 });
}

/** Open the canonical share dialog from the TopNav. */
export async function openShareDialog(page: Page): Promise<void> {
  await page.locator('[data-testid="topnav-share-button"]').click();
  await expect(page.locator('[data-testid="share-dialog"]')).toBeVisible({
    timeout: 15000,
  });
}

export interface CreateReviewLinkOptions {
  feedbackEnabled?: boolean;
  preset?: string;
}

/**
 * Create a review link through the UI (owner must be signed in). Returns the
 * FULL share URL (e.g. http://localhost:3000/share/<token>). The dialog is
 * closed afterwards so subsequent owner actions are not blocked.
 */
export async function createReviewLink(
  page: Page,
  options: CreateReviewLinkOptions = {},
): Promise<string> {
  await openShareDialog(page);
  if (options.feedbackEnabled === false) {
    await page.locator('[data-testid="share-feedback-toggle"]').uncheck();
  }
  if (options.preset) {
    await page.locator('[data-testid="share-expiry-select"]').selectOption(options.preset);
  }
  await page.locator('[data-testid="share-create-button"]').click();
  await expect(page.locator('[data-testid="share-created-card"]')).toBeVisible({
    timeout: 15000,
  });
  const url = await page.locator('[data-testid="share-created-url"]').inputValue();
  expect(url).toMatch(/^http:\/\/localhost:3000\/share\/[A-Za-z0-9_-]{40,}$/);
  await page.locator('[data-testid="share-dialog-close"]').click();
  return url;
}

/** Extract the raw token from a share URL. */
export function tokenOf(shareUrl: string): string {
  const match = shareUrl.match(/\/share\/([A-Za-z0-9_-]+)$/);
  if (!match) throw new Error(`Not a share URL: ${shareUrl}`);
  return match[1];
}

/** Revoke the first active review link via the management UI. */
export async function revokeFirstLink(page: Page): Promise<void> {
  await openShareDialog(page);
  const revoke = page.locator('[data-testid^="share-revoke-"]').first();
  await expect(revoke).toBeVisible({ timeout: 10000 });
  await revoke.click();
  await expect(page.locator('[data-testid="share-confirm-dialog"]')).toBeVisible();
  await page.locator('[data-testid="share-confirm-action"]').click();
  await expect(page.locator('[data-testid="share-confirm-dialog"]')).toBeHidden({
    timeout: 10000,
  });
  await page.locator('[data-testid="share-dialog-close"]').click();
}

// ---------------------------------------------------------------------------
// Raw API access (used by the security spec to fabricate edge states like
// expired / revoked / cross-project shares deterministically).
// ---------------------------------------------------------------------------

async function authHeaders(page: Page): Promise<Record<string, string>> {
  const token = await mockToken(page);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface ApiCreateShareBody {
  projectId: string;
  feedbackEnabled?: boolean;
  requireName?: boolean;
  preset?: string;
  expiresAt?: string | null;
}

/** Create a share through the same API the app uses (owner bearer session). */
export async function apiCreateShare(
  page: Page,
  body: ApiCreateShareBody,
): Promise<{ link: Record<string, unknown>; rawToken: string; url: string }> {
  const res = await page.request.post("http://localhost:3000/api/share", {
    headers: await authHeaders(page),
    data: body,
  });
  expect(res.ok()).toBe(true);
  const envelope = (await res.json()) as { ok: boolean; data: unknown };
  expect(envelope.ok).toBe(true);
  return envelope.data as { link: Record<string, unknown>; rawToken: string; url: string };
}

/** Push a valid sanitized projection onto a share (required for resolve). */
export async function apiPushProjection(
  page: Page,
  shareId: string,
  projection: unknown,
): Promise<void> {
  const res = await page.request.post(
    `http://localhost:3000/api/share/${encodeURIComponent(shareId)}/snapshot`,
    {
      headers: await authHeaders(page),
      data: { projection: JSON.stringify(projection), projectionRevision: 1 },
    },
  );
  expect(res.ok()).toBe(true);
}

/** Revoke a share through the API (owner bearer session). */
export async function apiRevokeShare(page: Page, shareId: string): Promise<void> {
  const res = await page.request.post(
    `http://localhost:3000/api/share/${encodeURIComponent(shareId)}/revoke`,
    { headers: await authHeaders(page) },
  );
  expect(res.ok()).toBe(true);
}

export interface ApiResolveResult {
  status: number;
  body: { ok: boolean; data?: unknown; error?: { code?: string; message?: string } };
}

/** Anonymous public resolve of a raw token. */
export async function apiResolveToken(page: Page, rawToken: string): Promise<ApiResolveResult> {
  const res = await page.request.get(
    `http://localhost:3000/api/share/view/${encodeURIComponent(rawToken)}`,
  );
  return { status: res.status(), body: (await res.json()) as ApiResolveResult["body"] };
}

/** Anonymous comment submission against a share (token in body). */
export async function apiSubmitComment(
  page: Page,
  shareId: string,
  rawToken: string,
  input: { body: string; authorName?: string; pageId?: string },
): Promise<{ status: number; body: { ok: boolean; error?: { code?: string; message?: string } } }> {
  const res = await page.request.post(
    `http://localhost:3000/api/share/${encodeURIComponent(shareId)}/feedback`,
    { data: { ...input, token: rawToken } },
  );
  return { status: res.status(), body: (await res.json()) as never };
}

/** Minimal valid projection payload for API-fabricated shares. */
export function minimalProjection(name: string, projectId: string): Record<string, unknown> {
  return {
    id: "",
    name,
    theme: { palette: {} },
    pages: [
      {
        id: `${projectId}-page`,
        title: "Home",
        slug: "/",
        sections: [],
      },
    ],
    assets: [],
  };
}

/** Unique-ish owner email for a test. */
export function ownerEmail(prefix: string): string {
  return `${prefix}-${uniqueSuffix()}@example.com`;
}
