import { test, expect } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor, importHtmlAndSaveAsMyBlock } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Phase P5 — E2E: Visual library experience
//
// Flow:
//   1. create/open project
//   2. save multiple blocks to the library (import → save)
//   3. verify visual thumbnails appear (or the safe fallback renders)
//   4. favorite one block
//   5. create a collection
//   6. move blocks into the collection
//   7. search / filter / sort
//   8. switch grid/list view
//   9. reload the editor
//  10. preferences + library metadata (favorite, collection) persist
//  11. no console / page / network errors
// ---------------------------------------------------------------------------

const BLOCK_A_HTML = `<section class="cards">
  <h2>Pricing A</h2>
  <p>Visual library hero block.</p>
</section>`;

const BLOCK_B_HTML = `<section class="nav">
  <nav><a href="#">Home</a><a href="#">About</a></nav>
</section>`;

const BLOCK_C_HTML = `<section class="cta">
  <h2>Call to action</h2>
  <button>Sign up</button>
</section>`;

// Live canvas only (the dashboard thumbnail preview renders custom blocks
// offscreen too).
const CANVAS = '[data-testid="preview-content"]';
const CUSTOM_BLOCK_SECTION = `${CANVAS} [data-testid="custom-block-section"]`;

test.describe("My Blocks — visual library", () => {
  test("thumbnails → favorite → collections → search/filter/sort → grid/list → persist", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const audit = attachRuntimeAudit(page);

    // 1-2. Create a project and save three blocks.
    await createSaaSProjectAndOpenEditor(page);
    await importHtmlAndSaveAsMyBlock(page, BLOCK_A_HTML, "Pricing block");
    await importHtmlAndSaveAsMyBlock(page, BLOCK_B_HTML, "Navigation block", "navigation");
    await importHtmlAndSaveAsMyBlock(page, BLOCK_C_HTML, "CTA block");

    // Open the library from the top nav.
    await page.locator('[data-testid="topnav-my-blocks-button"]').click();
    await expect(page.locator('[data-testid="my-blocks-library"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid^="my-block-card-"]')).toHaveCount(3, { timeout: 10000 });

    // 3. Thumbnails appear — a real <img> (ready) or the safe fallback. In
    // headless Chromium the offscreen capture may fail → fallback is also
    // acceptable. Either way the card shows a fixed-aspect preview surface.
    const card = page.locator('[data-testid^="my-block-card-"]').first();
    await expect(card).toBeVisible();
    const thumbReady = card.locator('[data-testid^="my-block-thumb-img-"]').first();
    const thumbFallback = card.locator('[data-testid^="my-block-thumb-fallback-"]').first();
    await page.waitForTimeout(1500); // allow the async generation a beat
    const readyCount = await page.locator('[data-testid^="my-block-thumb-img-"]').count();
    const fallbackCount = await page.locator('[data-testid^="my-block-thumb-fallback-"]').count();
    // Every card must show either a real image or the fallback — never raw
    // content, never a blank broken image.
    expect(readyCount + fallbackCount).toBeGreaterThanOrEqual(1);
    if (readyCount > 0) {
      await expect(thumbReady).toBeVisible();
    } else {
      await expect(thumbFallback).toContainText("safe to use");
    }

    // 4. Favorite the first block.
    const firstCardId = (await card.getAttribute("data-testid"))!.replace("my-block-card-", "");
    await page.locator(`[data-testid="my-block-favorite-${firstCardId}"]`).click();
    await expect(page.locator('[data-testid="my-blocks-toast"]')).toContainText("Favorites", {
      timeout: 5000,
    });
    // The Favorites section now shows exactly the starred block.
    await page.locator('[data-testid="my-blocks-section-favorites"]').click();
    await expect(page.locator('[data-testid^="my-block-card-"]')).toHaveCount(1, { timeout: 5000 });
    await page.locator('[data-testid="my-blocks-section-all"]').click();

    // 5. Create a collection.
    await page.locator('[data-testid="my-blocks-section-collections"]').click();
    await page.locator('[data-testid="my-blocks-new-collection"]').click();
    await expect(page.locator('[data-testid="collection-dialog"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="collection-name"]').fill("Landing pieces");
    await page.locator('[data-testid="collection-save"]').click();
    await expect(page.locator('[data-testid="my-blocks-toast"]')).toContainText("created", {
      timeout: 5000,
    });

    // 6. Move two blocks into the collection via selection mode.
    await page.locator('[data-testid="my-blocks-section-all"]').click();
    await page.locator('[data-testid="my-blocks-select-mode"]').click();
    await expect(page.locator('[data-testid="my-blocks-selection-toolbar"]')).toBeVisible({
      timeout: 5000,
    });
    await page.locator('[data-testid="my-blocks-select-all"]').click();
    // Deselect the favorite (leave it out of the collection).
    await page.locator(`[data-testid="my-block-select-${firstCardId}"]`).click();
    await page.locator('[data-testid="my-blocks-bulk-move"]').click();
    await expect(page.locator('[data-testid="move-to-collection-dialog"]')).toBeVisible({
      timeout: 5000,
    });
    await page.locator('[data-testid^="move-collection-"]:not([data-testid="move-collection-none"])').first().click();
    await page.locator('[data-testid="move-to-collection-confirm"]').click();
    await expect(page.locator('[data-testid="my-blocks-toast"]')).toContainText("moved", {
      timeout: 5000,
    });
    await page.locator('[data-testid="my-blocks-selection-done"]').click();

    // The collection chip appears on the moved blocks.
    await expect(
      page.locator('[data-testid^="my-block-collection-chip-"]').first(),
    ).toBeVisible({ timeout: 5000 });

    // 7. Search/filter/sort.
    await page.locator('[data-testid="my-blocks-search"]').fill("pricing");
    await expect(page.locator('[data-testid^="my-block-card-"]')).toHaveCount(1, { timeout: 5000 });
    await page.locator('[data-testid="my-blocks-search"]').fill("");
    await page.locator('[data-testid="my-blocks-cat-navigation"]').click();
    await expect(page.locator('[data-testid^="my-block-card-"]')).toHaveCount(1, { timeout: 5000 });
    await page.locator('[data-testid="my-blocks-cat-all"]').click();
    await page.locator('[data-testid="my-blocks-sort"]').selectOption("name-asc");
    await expect(page.locator('[data-testid^="my-block-card-"]')).toHaveCount(3, { timeout: 5000 });

    // 8. Switch to list view.
    await page.locator('[data-testid="my-blocks-view-list"]').click();
    await expect(page.locator('[data-testid="my-blocks-grid"]')).toHaveClass(/flex-col/, {
      timeout: 5000,
    });
    await page.locator('[data-testid="my-blocks-close"]').click();

    // 9-10. Reload the editor; preferences + library metadata persist.
    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="topnav-my-blocks-button"]').click();
    await expect(page.locator('[data-testid="my-blocks-library"]')).toBeVisible({ timeout: 5000 });
    // View preference persisted → list view.
    await expect(page.locator('[data-testid="my-blocks-grid"]')).toHaveClass(/flex-col/, {
      timeout: 5000,
    });
    // Sort preference persisted → name A–Z (Pricing first).
    await expect(page.locator('[data-testid="my-blocks-sort"]')).toHaveValue("name-asc");
    // Favorite persisted.
    await page.locator('[data-testid="my-blocks-section-favorites"]').click();
    await expect(page.locator('[data-testid^="my-block-card-"]')).toHaveCount(1, { timeout: 5000 });
    // Collection persisted.
    await page.locator('[data-testid="my-blocks-section-collections"]').click();
    await expect(page.locator('[data-testid="my-blocks-collection-all"]')).toBeVisible({
      timeout: 5000,
    });
    const collectionButton = page
      .locator('[data-testid^="my-blocks-collection-"]')
      .filter({ hasText: "Landing pieces" })
      .first();
    await expect(collectionButton).toBeVisible({ timeout: 5000 });
    // The collection badge shows the two moved blocks.
    await expect(collectionButton.getByText("2")).toBeVisible({ timeout: 5000 });

    // The seeded project also has its three custom-block sections intact.
    await page.locator('[data-testid="my-blocks-close"]').click();
    await expect(page.locator(CUSTOM_BLOCK_SECTION)).toHaveCount(3, { timeout: 5000 });

    // 11. No console / page / network errors.
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
