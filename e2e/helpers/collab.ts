import { expect, type Page } from "@playwright/test";
import { fetchWorkspaceProject } from "./workspaces";

// ---------------------------------------------------------------------------
// Phase P16 — Realtime Collaborative Editing: shared E2E helpers
//
// Deterministic multi-user collaboration uses the same dev-server mock backend
// as P14/P15, so two browser contexts share ONE collab room. The mock collab
// transport polls every 500 ms, so remote changes land within ~1 s — tests use
// generous polling assertions instead of arbitrary sleeps.
//
// Reconnect/offline specs drive the mock transport's dev-only test controls
// (exposed on window.__buildoraCollabTestControls by useCollaborationSession
// when the environment is mock + dev): forceDisconnect stops polling and queues
// local Yjs updates, forceReconnect flushes and resumes — the same semantics as
// the Supabase reconnect path.
// ---------------------------------------------------------------------------

/** Force the active collab transport offline (polling stops, edits queue). */
export async function forceCollabDisconnect(page: Page): Promise<void> {
  const ok = await page.evaluate(() => {
    const controls = (
      window as unknown as Record<string, unknown>
    ).__buildoraCollabTestControls;
    if (!controls) return false;
    (controls as { forceDisconnect: () => void }).forceDisconnect();
    return true;
  });
  expect(ok, "collab test controls are not exposed on this page").toBe(true);
}

/** Reconnect the active collab transport (queue flushes, polling resumes). */
export async function forceCollabReconnect(page: Page): Promise<void> {
  const ok = await page.evaluate(() => {
    const controls = (
      window as unknown as Record<string, unknown>
    ).__buildoraCollabTestControls;
    if (!controls) return false;
    (controls as { forceReconnect: () => void }).forceReconnect();
    return true;
  });
  expect(ok, "collab test controls are not exposed on this page").toBe(true);
}

/** Wait until the collab status chip with the given testid is visible. */
export async function waitForCollabStatus(
  page: Page,
  testid: "collab-status-synced" | "collab-status-offline" | "collab-status-reconnecting" | "collab-status-error",
  timeout = 15000,
): Promise<void> {
  await expect(page.locator(`[data-testid="${testid}"]`)).toBeVisible({
    timeout,
  });
}

/**
 * Select the first (hero) section and wait for the inspector panel. Also
 * switches the right sidebar to the Design tab — the inspector only renders
 * there, so this is required after any flow that opened the Structure tab.
 *
 * The canvas wrapper testid flips between `section-wrapper` (unselected) and
 * `selected-section` (selected), so we must match BOTH: once a section is
 * selected, the first `section-wrapper` may be a DIFFERENT (later) section,
 * which would open the inspector on the wrong section.
 */
export async function openHeroInspector(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="preview-content"]')).toBeVisible({
    timeout: 15000,
  });
  const firstSection = page
    .locator('[data-testid="section-wrapper"], [data-testid="selected-section"]')
    .first();
  await firstSection.click();
  await page.locator('[data-testid="right-tab-design"]').click();
  await expect(page.locator('[data-testid="inspector-panel"]')).toBeVisible({
    timeout: 10000,
  });
}

/** The hero headline textarea (first textarea in the inspector). */
export function headlineTextarea(page: Page) {
  return page.locator('[data-testid="inspector-panel"] textarea').first();
}

/** The hero subheadline textarea (second textarea in the inspector). */
export function subheadlineTextarea(page: Page) {
  return page.locator('[data-testid="inspector-panel"] textarea').nth(1);
}

/** Wait until the server project payload contains ALL of the given strings. */
export async function waitForServerContent(
  page: Page,
  workspaceId: string,
  projectId: string,
  strings: string[],
  timeout = 30000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const server = await fetchWorkspaceProject(page, workspaceId, projectId);
        const raw = JSON.stringify(server.project);
        return strings.every((s) => raw.includes(s));
      },
      { timeout, intervals: [500, 1000, 2000] },
    )
    .toBe(true);
}

/** Reload the editor and wait for the canvas + collab status to settle. */
export async function reloadEditor(page: Page): Promise<void> {
  await page.reload();
  await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
    timeout: 30000,
  });
}

/** Open the structure tab (right sidebar). */
export async function openStructureTab(page: Page): Promise<void> {
  await page.locator('[data-testid="right-tab-structure"]').click();
  await expect(page.locator('[data-testid="structure-panel"]')).toBeVisible({
    timeout: 10000,
  });
}

/**
 * Add a section of the given type via the real Add Section dialog (structure
 * panel). The button only exists in the Structure tab, so this helper opens
 * it first. After a successful insert the sidebar switches to the Design tab
 * (documented UX), so callers re-open the Structure tab when needed.
 */
export async function addSection(page: Page, type: string): Promise<void> {
  await openStructureTab(page);
  await page.locator('[data-testid="add-section-button"]').click();
  const dialog = page.getByRole("dialog", { name: "Add Section" });
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await page.locator(`[data-testid="section-card-${type}"]`).click();
  await page.locator('[data-testid="confirm-add-section"]').click();
  await expect(dialog).not.toBeVisible({ timeout: 10000 });
}

/** Number of section rows currently visible in the structure panel. */
export async function sectionRowCount(page: Page): Promise<number> {
  await openStructureTab(page);
  return page.locator('[data-section-type]').count();
}
