import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Phase O — LEGO builder engine: Block browser (e2e/block-browser.spec.ts)
//
// The block browser opens from the build tree, targets the selected section,
// recommends the block types bound by it, searches with plain-language
// synonyms, filters by category, persists favorites (UI preference only) and
// inserts blocks as session previews.
// ---------------------------------------------------------------------------

async function openBlocksTab(page: Page): Promise<void> {
  await page.locator('[data-testid="right-tab-blocks"]').click();
  await expect(page.locator('[data-testid="blocks-panel"]')).toBeVisible();
}

async function openBrowser(page: Page): Promise<void> {
  await page.locator('[data-testid="open-block-browser"]').click();
  await expect(page.locator('[data-testid="block-browser-dialog"]')).toBeVisible();
}

test.describe("Block browser (Phase O)", () => {
  test.beforeEach(async ({ page }) => {
    await createSaaSProjectAndOpenEditor(page);
    await openBlocksTab(page);
  });

  test("opens from the build tree and recommends the target section's blocks", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await openBrowser(page);
    // The first section (header) binds heading (logo) + button (CTA).
    await expect(page.locator('[data-testid="block-recommended"]')).toBeVisible();
    await expect(page.locator('[data-testid="block-card-heading"]')).toBeVisible();
    await expect(page.locator('[data-testid="block-card-button"]')).toBeVisible();
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("search finds blocks through plain-language synonyms", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await openBrowser(page);
    await page.locator('[data-testid="block-browser-search"]').fill("reviews");
    await expect(page.locator('[data-testid="block-card-review-card"]')).toBeVisible();
    await expect(page.locator('[data-testid="block-card-heading"]')).toHaveCount(0);
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("category chips filter the grid", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await openBrowser(page);
    await page.locator('[data-testid="block-cat-layout"]').click();
    await expect(page.locator('[data-testid="block-card-container"]')).toBeVisible();
    await expect(page.locator('[data-testid="block-card-heading"]')).toHaveCount(0);
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("favorites persist across dialog opens", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await openBrowser(page);
    const fav = page.locator('[data-testid="block-fav-heading"]');
    await fav.click();
    await expect(fav).toHaveClass(/text-amber-300/);
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="block-browser-dialog"]')).not.toBeVisible();
    await openBrowser(page);
    await expect(page.locator('[data-testid="block-fav-heading"]')).toHaveClass(
      /text-amber-300/,
    );
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("adding a block inserts a session preview and records a recent", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await openBrowser(page);
    await page.locator('[data-testid="block-add-heading"]').click();
    await expect(page.locator('[data-testid="block-browser-dialog"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="session-preview-note"]')).toBeVisible();
    // Reopen — the inserted type appears in the Recent strip.
    await openBrowser(page);
    await expect(page.locator('[data-testid="block-recent-heading"]')).toBeVisible();
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("Escape closes the browser", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await openBrowser(page);
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="block-browser-dialog"]')).not.toBeVisible();
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("unknown search terms show a friendly empty state", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await openBrowser(page);
    await page.locator('[data-testid="block-browser-search"]').fill("zzzzzz");
    await expect(page.locator('[data-testid="block-browser-dialog"]').getByText(/No blocks match/)).toBeVisible();
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
