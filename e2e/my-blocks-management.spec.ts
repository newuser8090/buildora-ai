import { test, expect } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Phase P4 — E2E: My Blocks management
//
// Flow:
//   1. create project A and save a block to the library (import → save)
//   2. insert the block into the project (a live project copy)
//   3. rename the library record
//   4. duplicate it — verify the duplicate-safe name ("… 2")
//   5. export one .buildora-block.json file
//   6. delete the original library record
//   7. verify the existing project copy remains on the page
//   8. import the exported block file back
//   9. verify a new library record appears
//  10. insert the imported record — a fresh section appears
//  11. no console / page / network errors
//
// File transfer is exercised through the real browser download/upload path
// (Playwright handles both); the transfer payload itself is additionally
// covered by the unit tests in my-block-file.test.ts.
// ---------------------------------------------------------------------------

const IMPORTED_HTML = `<section class="features">
  <h2>Managed block</h2>
  <p>Rename, duplicate, export and re-import me.</p>
</section>`;

// The live canvas only — the dashboard's thumbnail generator mounts an
// offscreen <ThumbnailProjectPreview> (left:-100000px) that ALSO renders
// custom-block sections. Scoping to the live preview keeps assertions on
// the real page content and immune to thumbnail machinery.
const CANVAS = '[data-testid="preview-content"]';
const CUSTOM_BLOCK_SECTION = `${CANVAS} [data-testid="custom-block-section"]`;

test.describe("My Blocks — library management", () => {
  test.use({ acceptDownloads: true });

  test("rename → duplicate → export → delete (copy survives) → re-import → insert", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const audit = attachRuntimeAudit(page);

    // 1. Create project A + save a block via import → save.
    await createSaaSProjectAndOpenEditor(page);
    await page.locator('[data-testid="right-tab-blocks"]').click();
    await expect(page.locator('[data-testid="build-tree-panel"]')).toBeVisible();
    await page.locator('[data-testid="build-tree-import-code"]').click();
    await expect(page.locator('[data-testid="code-import-dialog"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="code-import-source"]').fill(IMPORTED_HTML);
    await page.locator('[data-testid="code-import-analyse"]').click();
    await expect(page.locator('[data-testid="analysis-result"]')).toBeVisible({ timeout: 10000 });
    await page.locator('[data-testid="analysis-continue"]').click();
    await expect(page.locator('[data-testid="review-step"]')).toBeVisible();
    await page.locator('[data-testid="review-continue"]').click();
    await expect(page.locator('[data-testid="placement-step"]')).toBeVisible();
    await page.locator('[data-testid="insert-button"]').click();
    await expect(page.locator('[data-testid="import-success"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="success-save-block"]').click();
    await expect(page.locator('[data-testid="save-my-block-dialog"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="save-block-submit"]').click();
    await expect(page.locator('[data-testid="my-blocks-toast"]')).toContainText(
      "saved to My Blocks",
      { timeout: 5000 },
    );

    // 2. Insert the block into the project so a live project copy exists.
    // The imported design from step 1 is already a custom-block section on
    // the page, so the browser insert makes TWO custom-block sections.
    await page.locator('[data-testid="right-tab-blocks"]').click();
    await page.locator('[data-testid="open-block-browser"]').click();
    await page.locator('[data-testid="block-cat-my-blocks"]').click();
    const addButton = page.locator('[data-testid^="my-block-browser-add-"]').first();
    await expect(addButton).toBeVisible({ timeout: 5000 });
    await addButton.click();
    await expect(page.locator(CUSTOM_BLOCK_SECTION)).toHaveCount(2, {
      timeout: 5000,
    });
    await expect(
      page.locator(CUSTOM_BLOCK_SECTION).getByText("Managed block", { exact: true }).first(),
    ).toBeVisible({ timeout: 5000 });

    // Open the library (Command Palette → open my blocks).
    await page.keyboard.press("Control+k");
    await expect(page.locator('[data-testid="command-palette"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="command-open-my-blocks"]').click();
    await expect(page.locator('[data-testid="my-blocks-library"]')).toBeVisible({ timeout: 5000 });

    const card = page.locator('[data-testid^="my-block-card-"]').first();
    const blockId = (await card.getAttribute("data-testid"))!.replace("my-block-card-", "");

    // 3. Rename the library record.
    await page.locator(`[data-testid="my-block-menu-${blockId}"]`).click();
    await page.locator(`[data-testid="my-block-rename-${blockId}"]`).click();
    await expect(page.locator('[data-testid="rename-my-block-dialog"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="rename-my-block-input"]').fill("Renamed block");
    await page.locator('[data-testid="rename-my-block-save"]').click();
    await expect(page.locator('[data-testid="my-blocks-library"]')).toContainText("Renamed block", {
      timeout: 5000,
    });

    // 4. Duplicate it — duplicate-safe name ("Renamed block 2").
    const renamedCard = page.locator('[data-testid^="my-block-card-"]').first();
    const renamedId = (await renamedCard.getAttribute("data-testid"))!.replace("my-block-card-", "");
    await page.locator(`[data-testid="my-block-menu-${renamedId}"]`).click();
    await page.locator(`[data-testid="my-block-duplicate-${renamedId}"]`).click();
    await expect(page.locator('[data-testid="my-blocks-library"]')).toContainText(
      "Renamed block 2",
      { timeout: 5000 },
    );

    // 5. Export one .buildora-block.json file via the details dialog. In the
    // Phase P5 card the Preview action lives in the More menu — open it first.
    const exportCard = page.locator('[data-testid^="my-block-card-"]').first();
    const exportCardId = (await exportCard.getAttribute("data-testid"))!.replace("my-block-card-", "");
    await page.locator(`[data-testid="my-block-menu-${exportCardId}"]`).click();
    await page.locator(`[data-testid="my-block-preview-${exportCardId}"]`).click();
    await expect(page.locator('[data-testid="my-block-details"]')).toBeVisible({ timeout: 5000 });
    const downloadPromise = page.waitForEvent("download", { timeout: 10000 });
    await page.locator('[data-testid="my-block-details-export"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.buildora-block\.json$/);
    const exportPath = await download.path();
    expect(exportPath).toBeTruthy();

    // 6. Delete the original library record.
    await page.locator('[data-testid="my-block-details-close"]').click();
    const cards = page.locator('[data-testid^="my-block-card-"]');
    const firstCardId = (await cards.first().getAttribute("data-testid"))!.replace("my-block-card-", "");
    await page.locator(`[data-testid="my-block-menu-${firstCardId}"]`).click();
    await page.locator(`[data-testid="my-block-delete-${firstCardId}"]`).click();
    await expect(page.locator('[data-testid="delete-my-block-dialog"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="delete-my-block-confirm"]').click();

    // 7. The project copies remain on the page (delete touched the library only).
    await page.locator('[data-testid="my-blocks-close"]').click();
    await expect(
      page.locator(CUSTOM_BLOCK_SECTION).getByText("Managed block", { exact: true }).first(),
    ).toBeVisible({ timeout: 5000 });

    // 8. Import the exported block file back (Phase P5 review → import flow).
    await page.keyboard.press("Control+k");
    await page.locator('[data-testid="command-open-my-blocks"]').click();
    await expect(page.locator('[data-testid="my-blocks-library"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="my-blocks-import"]').click();
    await expect(page.locator('[data-testid="import-my-block-dialog"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="import-my-block-file"]').setInputFiles(exportPath!);
    // The file parses into the review step — confirm the import.
    await expect(page.locator('[data-testid="import-review-list"]')).toBeVisible({ timeout: 10000 });
    await page.locator('[data-testid="import-review-confirm"]').click();
    await expect(page.locator('[data-testid="import-summary"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="import-summary-imported"]')).toHaveText("1");
    await page.locator('[data-testid="import-my-block-done"]').click();
    await expect(page.locator('[data-testid="my-blocks-toast"]')).toContainText("imported to My Blocks", {
      timeout: 10000,
    });

    // 9. A new library record appears.
    await expect(page.locator('[data-testid="my-blocks-library"]')).toContainText("Renamed block", {
      timeout: 5000,
    });

    // 10. Insert the imported record — a fresh section appears. (Two custom
    // blocks already exist: the imported design + the earlier browser copy.)
    await page.locator('[data-testid="my-blocks-close"]').click();
    await page.locator('[data-testid="right-tab-blocks"]').click();
    await page.locator('[data-testid="open-block-browser"]').click();
    await page.locator('[data-testid="block-cat-my-blocks"]').click();
    await page.locator('[data-testid^="my-block-browser-add-"]').first().click();
    await expect(page.locator(CUSTOM_BLOCK_SECTION)).toHaveCount(3, {
      timeout: 5000,
    });

    // 11. No console / page / network errors.
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
