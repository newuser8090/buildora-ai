import { expect, type Page } from "@playwright/test";
import { importHtmlAndSaveAsMyBlock, createBlankProjectAndOpenEditor } from "./projects";

// ---------------------------------------------------------------------------
// Phase P6 — shared E2E helpers
//
// The mock cloud backend lives in the dev-server process (Next.js API routes
// under /api/cloud/...), so two browser contexts hitting the same dev server
// share ONE "cloud" — that is what makes cross-device e2e possible. Each
// context has its own IndexedDB/localStorage (its own "device").
//
// Two helpers deliberately manipulate data at the edges of the system and
// are documented as such:
//   - uploadCloudBlock() simulates "another device edited this block" by
//     writing a modified payload through the same API the app uses.
//   - editLocalBlockTree() simulates "this device edited the design" by
//     writing the resulting record into this device's IndexedDB. The product
//     intentionally has no "edit saved block" UI yet, so the data state a UI
//     edit would produce is written directly; the CONFLICT detection,
//     dialog, Keep-both resolution, fresh ids and durability are all real.
// ---------------------------------------------------------------------------

export const IMPORTED_HTML = `<section class="hero">
  <h1>My Blocks hero</h1>
  <p>Reuse this design anywhere.</p>
  <button class="cta">Get started</button>
</section>`;

/** Unique-ish suffix so dev-server mock accounts never collide between tests. */
export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

// ---------------------------------------------------------------------------
// Editor + My Blocks
// ---------------------------------------------------------------------------

/** Open a fresh blank project in the editor (fresh context = fresh device). */
export async function openEditor(page: Page): Promise<string> {
  return createBlankProjectAndOpenEditor(page);
}

export async function openMyBlocks(page: Page): Promise<void> {
  await page.locator('[data-testid="topnav-my-blocks-button"]').click();
  await expect(page.locator('[data-testid="my-blocks-library"]')).toBeVisible({ timeout: 5000 });
}

export async function closeMyBlocks(page: Page): Promise<void> {
  await page.locator('[data-testid="my-blocks-close"]').click();
}

/** Save a standard hero design as a personal My Block (works signed-out). */
export async function createBlockViaImport(page: Page, blockName: string): Promise<void> {
  await importHtmlAndSaveAsMyBlock(page, IMPORTED_HTML, blockName);
}

/** Return the LOCAL library record id of the card whose name matches. */
export async function blockIdOf(page: Page, name: string): Promise<string> {
  await openMyBlocks(page);
  const card = page.locator('[data-testid^="my-block-card-"]').filter({ hasText: name }).first();
  await expect(card).toBeVisible({ timeout: 10000 });
  const testId = await card.getAttribute("data-testid");
  await closeMyBlocks(page);
  if (!testId) throw new Error(`Could not find saved block "${name}"`);
  return testId.replace(/^my-block-card-/, "");
}

/** Rename a saved block via its card menu (library metadata edit). */
export async function renameBlock(page: Page, blockId: string, newName: string): Promise<void> {
  await openMyBlocks(page);
  await page.locator(`[data-testid="my-block-menu-${blockId}"]`).click();
  await page.locator(`[data-testid="my-block-rename-${blockId}"]`).click();
  await expect(page.locator('[data-testid="rename-my-block-dialog"]')).toBeVisible({ timeout: 5000 });
  await page.locator('[data-testid="rename-my-block-input"]').fill(newName);
  await page.locator('[data-testid="rename-my-block-save"]').click();
  await expect(page.locator('[data-testid="rename-my-block-dialog"]')).toBeHidden({ timeout: 5000 });
  await expect(page.locator('[data-testid="my-blocks-toast"]')).toBeVisible({ timeout: 5000 });
  await closeMyBlocks(page);
}

// ---------------------------------------------------------------------------
// Sync status control (TopNav)
// ---------------------------------------------------------------------------

export function statusControl(page: Page) {
  return page.locator('[data-testid="cloud-sync-status"]');
}

/** Assert the compact status label (e.g. "Synced", "Offline — changes saved here"). */
export async function expectStatusLabel(
  page: Page,
  label: string,
  timeout = 20000,
): Promise<void> {
  await expect(statusControl(page)).toContainText(label, { timeout });
}

/** Click the status control → "Sync now". */
export async function syncNow(page: Page): Promise<void> {
  await statusControl(page).click();
  await page.getByRole("menuitem", { name: "Sync now", exact: true }).click();
}

/** Open the status control menu and click "Review conflicts". */
export async function openConflicts(page: Page): Promise<void> {
  await statusControl(page).click();
  await page.getByRole("menuitem", { name: "Review conflicts", exact: true }).click();
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function openAuthDialog(page: Page): Promise<void> {
  await statusControl(page).click();
  await page.getByRole("menuitem", { name: "Sign in to back up", exact: true }).click();
  await expect(authDialog(page)).toBeVisible({ timeout: 5000 });
}

/** The sign-in/sign-up dialog (its accessible name changes with the mode). */
function authDialog(page: Page) {
  return page.getByRole("dialog", { name: /Welcome back|Create your account/ });
}

/** Sign up with a fresh email (mock backend has no email confirmation). */
export async function signUp(page: Page, email: string, password: string): Promise<void> {
  await openAuthDialog(page);
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  // The AUTH dialog closes on success — the initial-merge prompt may open
  // right after, so only assert on the auth dialog itself.
  await expect(authDialog(page)).toBeHidden({ timeout: 10000 });
}

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await openAuthDialog(page);
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(authDialog(page)).toBeHidden({ timeout: 10000 });
}

/**
 * Answer the initial-merge prompt. The dialog appears after the first
 * sign-in on a device that already has pieces on either side.
 */
export async function chooseInitialMerge(
  page: Page,
  choice: "Merge both" | "Download cloud library" | "Upload this device's pieces" | "Review differences",
): Promise<void> {
  const dialog = page.getByRole("dialog", { name: /Buildora found saved pieces/ });
  await expect(dialog).toBeVisible({ timeout: 15000 });
  // NOTE: the recommended option carries a "Recommended" badge INSIDE the
  // button, so the accessible name is "Merge both Recommended". Match
  // without exact:true (substring) to hit it.
  await dialog.getByRole("button", { name: choice }).click();
  await expect(dialog).toBeHidden({ timeout: 30000 });
}

/** Sign out via the account menu. Local data is retained by design. */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Mock backend (the dev-server "cloud"). These hit the SAME API routes the
// app uses so e2e observes the exact wire contract.
// ---------------------------------------------------------------------------

/** The mock session token stored by the dev-only auth service. */
export async function mockToken(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem("buildora.mock_session"));
}

async function authHeaders(page: Page): Promise<Record<string, string>> {
  const token = await mockToken(page);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Fetch every cloud block record owned by the signed-in user. */
export async function fetchCloudBlocks(page: Page): Promise<unknown[]> {
  const res = await page.request.get("http://localhost:3000/api/cloud/changes?limit=200", {
    headers: await authHeaders(page),
  });
  expect(res.ok()).toBe(true);
  const envelope = (await res.json()) as { ok: boolean; data: { blocks: unknown[] } };
  expect(envelope.ok).toBe(true);
  return envelope.data.blocks;
}

/** Push a (modified) cloud block payload — simulates an edit made elsewhere. */
export async function uploadCloudBlock(page: Page, block: unknown): Promise<void> {
  const res = await page.request.post("http://localhost:3000/api/cloud/blocks/batch", {
    headers: await authHeaders(page),
    data: { blocks: [block] },
  });
  expect(res.ok()).toBe(true);
}

/**
 * Poll the mock cloud until a block with the given name exists (or timeout).
 * The sync status label is sticky ("Synced" persists), so tests must wait on
 * ACTUAL cloud/library content — not the label — to avoid racing the 4s
 * change debounce and the async engine run.
 */
export async function waitForCloudBlockName(
  page: Page,
  name: string,
  timeout = 30000,
): Promise<void> {
  await expect
    .poll(async () => {
      const blocks = await fetchCloudBlocks(page);
      return blocks.some(
        (b) =>
          typeof (b as { name?: unknown }).name === "string" &&
          (b as { name: string }).name === name,
      );
    }, { timeout, intervals: [500, 1000, 2000] })
    .toBe(true);
}

/** Deep-clone a payload, change its first text prop, and bump the tree epoch. */
export function withEditedTree(payload: unknown, newText: string): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(payload)) as {
    tree?: { nodes?: Record<string, { props?: Record<string, unknown> }> };
    contentRevision?: number;
    updatedAt?: string;
  };
  const nodes = Object.values(clone.tree?.nodes ?? {});
  const textNode = nodes.find((n) => typeof n.props?.text === "string");
  if (textNode) (textNode.props as Record<string, unknown>).text = newText;
  clone.contentRevision = (clone.contentRevision ?? 1) + 1;
  clone.updatedAt = new Date().toISOString();
  return clone as Record<string, unknown>;
}

/**
 * Simulate a local design edit on THIS device: write the edited record
 * directly into this device's IndexedDB (myBlocks store). The record gains a
 * different tree + a bumped contentRevision + a fresh updatedAt, exactly the
 * data state a UI edit would produce.
 */
export async function editLocalBlockTree(
  page: Page,
  name: string,
  newText: string,
): Promise<{ ok: boolean; reason?: string }> {
  return page.evaluate(async ({ name, newText }) => {
    const open = (dbName: string) =>
      new Promise<IDBDatabase>((resolve, reject) => {
        // No explicit version: always opens the database at its CURRENT
        // version. (Pinning a version here would throw VersionError once the
        // app upgrades the schema — e.g. Phase P7 bumped it to 6.)
        const req = indexedDB.open(dbName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

    try {
      const db = await open("buildora");
      const tx = db.transaction("myBlocks", "readwrite");
      const store = tx.objectStore("myBlocks");
      const records = await new Promise<Record<string, unknown>[]>((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result as Record<string, unknown>[]);
      });
      const target = records.find((b) => b && typeof b.name === "string" && b.name === name);
      if (!target) {
        db.close();
        return { ok: false, reason: `no local record named "${name}"` };
      }
      const record = JSON.parse(JSON.stringify(target)) as {
        tree?: { nodes?: Record<string, { props?: Record<string, unknown> }> };
        contentRevision?: number;
        updatedAt?: string;
      };
      const nodes = Object.values(record.tree?.nodes ?? {});
      const textNode = nodes.find((n) => typeof n.props?.text === "string");
      if (textNode) (textNode.props as Record<string, unknown>).text = newText;
      record.contentRevision = (record.contentRevision ?? 1) + 1;
      record.updatedAt = new Date().toISOString();
      await new Promise<void>((resolve, reject) => {
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      db.close();
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }, { name, newText });
}

// ---------------------------------------------------------------------------
// Account menu / shared libraries
// ---------------------------------------------------------------------------

/** Open the account menu and click "Shared libraries". */
export async function openSharedLibraries(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Shared libraries", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Shared libraries" }),
  ).toBeVisible({ timeout: 10000 });
}
