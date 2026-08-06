import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// My Blocks helpers (Phase P4/P5)
// ---------------------------------------------------------------------------

/**
 * Import an HTML snippet through the Import Studio, then save the converted
 * design as a My Block with the given name. Leaves the editor clean (all
 * dialogs closed). Used by the My Blocks E2E specs to seed the library.
 */
export async function importHtmlAndSaveAsMyBlock(
  page: Page,
  html: string,
  blockName: string,
  category?: string,
): Promise<void> {
  // Open Import Studio from the Blocks tab.
  await page.locator('[data-testid="right-tab-blocks"]').click();
  await expect(page.locator('[data-testid="build-tree-panel"]')).toBeVisible();
  await page.locator('[data-testid="build-tree-import-code"]').click();
  await expect(page.locator('[data-testid="code-import-dialog"]')).toBeVisible({ timeout: 5000 });
  await page.locator('[data-testid="code-import-source"]').fill(html);
  await page.locator('[data-testid="code-import-analyse"]').click();
  await expect(page.locator('[data-testid="analysis-result"]')).toBeVisible({ timeout: 10000 });
  await page.locator('[data-testid="analysis-continue"]').click();
  await expect(page.locator('[data-testid="review-step"]')).toBeVisible();
  await page.locator('[data-testid="review-continue"]').click();
  await expect(page.locator('[data-testid="placement-step"]')).toBeVisible();
  await page.locator('[data-testid="insert-button"]').click();
  await expect(page.locator('[data-testid="import-success"]')).toBeVisible({ timeout: 5000 });

  // Save as My Block.
  await page.locator('[data-testid="success-save-block"]').click();
  await expect(page.locator('[data-testid="save-my-block-dialog"]')).toBeVisible({ timeout: 5000 });
  await page.locator('[data-testid="save-block-name"]').fill(blockName);
  if (category) {
    // The save dialog defaults to "other" — set the category explicitly when
    // a test needs to exercise the category filter.
    await page.locator('[data-testid="save-block-category"]').selectOption(category);
  }
  await page.locator('[data-testid="save-block-submit"]').click();
  await expect(page.locator('[data-testid="my-blocks-toast"]')).toContainText("saved to My Blocks", {
    timeout: 5000,
  });
}

// ---------------------------------------------------------------------------
// Shared dashboard → editor flow
//
// The dashboard (/) creates projects from templates and navigates to
// /editor/[projectId] on success. Every Playwright test gets a fresh browser
// context (empty IndexedDB), so helpers here always start from the first-run
// empty dashboard state. Used by both editor.spec.ts and thumbnails.spec.ts
// so the flow never drifts between specs.
// ---------------------------------------------------------------------------

/**
 * Open the dashboard and create a project from the SaaS template, landing in
 * the editor at /editor/<projectId>. Returns the created project id.
 */
export async function createSaaSProjectAndOpenEditor(page: Page): Promise<string> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // First-run empty dashboard — no automatic project is created.
  await expect(
    page.getByRole("heading", { name: "Welcome to Buildora" }),
  ).toBeVisible({ timeout: 10000 });

  await page.getByRole("button", { name: "New Project" }).first().click();
  await expect(page.getByRole("dialog", { name: "New Project" })).toBeVisible();

  // The SaaS card may appear in both the featured strip and the full grid —
  // click the first match.
  await page.getByRole("button", { name: "Use SaaS Landing Page" }).first().click();
  await expect(page.locator("#new-project-name")).toHaveValue("SaaS Landing Page");

  await page.locator('[data-testid="create-project-button"]').click();
  // Generous timeout: on a cold webpack dev server (Windows junction
  // workaround) the first compile of the editor route can take >30s and
  // the router push is blocked until the chunk is ready.
  await page.waitForURL(/\/editor\/.+/, { timeout: 90000 });

  await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
    timeout: 90000,
  });

  const match = page.url().match(/\/editor\/([^/?]+)/);
  const projectId = match ? match[1] : "";
  expect(projectId).not.toBe("");
  return projectId;
}

/**
 * Open the dashboard and create a project from the Blank template (single
 * starter hero section), landing in the editor. Returns the project id.
 */
export async function createBlankProjectAndOpenEditor(
  page: Page,
): Promise<string> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByRole("heading", { name: "Welcome to Buildora" }),
  ).toBeVisible({ timeout: 10000 });

  await page.getByRole("button", { name: "New Project" }).first().click();
  await expect(page.getByRole("dialog", { name: "New Project" })).toBeVisible();

  // Blank template card — click the first match.
  await page.getByRole("button", { name: "Use Blank Project" }).first().click();
  await expect(page.locator("#new-project-name")).toHaveValue("Untitled Project");

  await page.locator('[data-testid="create-project-button"]').click();
  // Generous timeout: on a cold webpack dev server (Windows junction
  // workaround) the first compile of the editor route can take >30s and
  // the router push is blocked until the chunk is ready.
  await page.waitForURL(/\/editor\/.+/, { timeout: 90000 });

  await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
    timeout: 90000,
  });

  const match = page.url().match(/\/editor\/([^/?]+)/);
  const projectId = match ? match[1] : "";
  expect(projectId).not.toBe("");
  return projectId;
}
