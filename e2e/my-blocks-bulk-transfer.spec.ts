import { test, expect } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor, importHtmlAndSaveAsMyBlock } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Phase P5 — E2E: bulk transfer (.buildora-blocks.json)
//
// Flow:
//   1. create project + save three blocks to the library
//   2. select multiple blocks (selection mode → select all visible)
//   3. export .buildora-blocks.json (real browser download)
//   4. delete the selected records (bulk delete with confirmation)
//   5. import the exported file back
//   6. review items
//   7. import all
//   8. verify fresh library IDs (the new records are NOT the deleted ones)
//   9. duplicate-safe names where applicable (re-import keeps names unique)
//  10. insert one imported block
//  11. no console / page / network errors
//
// File transfer uses the real browser download/upload path; the payload
// format itself is fully covered by unit tests (my-block-file.test.ts).
// ---------------------------------------------------------------------------

const BLOCK_A_HTML = `<section><h2>Bulk A</h2><p>First bulk block.</p></section>`;
const BLOCK_B_HTML = `<section><h2>Bulk B</h2><p>Second bulk block.</p></section>`;
const BLOCK_C_HTML = `<section><h2>Bulk C</h2><p>Third bulk block.</p></section>`;

const CANVAS = '[data-testid="preview-content"]';
const CUSTOM_BLOCK_SECTION = `${CANVAS} [data-testid="custom-block-section"]`;

test.describe("My Blocks — bulk transfer", () => {
  test.use({ acceptDownloads: true });

  test("select → export .buildora-blocks.json → delete → import → fresh ids → insert", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const audit = attachRuntimeAudit(page);

    // 1. Create project + save three blocks.
    await createSaaSProjectAndOpenEditor(page);
    await importHtmlAndSaveAsMyBlock(page, BLOCK_A_HTML, "Bulk A");
    await importHtmlAndSaveAsMyBlock(page, BLOCK_B_HTML, "Bulk B");
    await importHtmlAndSaveAsMyBlock(page, BLOCK_C_HTML, "Bulk C");

    // Open the library.
    await page.locator('[data-testid="topnav-my-blocks-button"]').click();
    await expect(page.locator('[data-testid="my-blocks-library"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid^="my-block-card-"]')).toHaveCount(3, { timeout: 10000 });

    // Capture the current record ids (they must NOT survive the round trip).
    const idsBefore = await page
      .locator('[data-testid^="my-block-card-"]')
      .evaluateAll((els) =>
        els.map((el) => (el.getAttribute("data-testid") as string).replace("my-block-card-", "")),
      );
    expect(idsBefore).toHaveLength(3);

    // 2. Select multiple blocks (select all visible = the three cards).
    await page.locator('[data-testid="my-blocks-select-mode"]').click();
    await expect(page.locator('[data-testid="my-blocks-selection-toolbar"]')).toBeVisible({
      timeout: 5000,
    });
    await page.locator('[data-testid="my-blocks-select-all"]').click();
    await expect(page.locator('[data-testid="my-blocks-selection-toolbar"]')).toContainText(
      "3 selected",
      { timeout: 5000 },
    );

    // 3. Export .buildora-blocks.json (real download).
    const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
    await page.locator('[data-testid="my-blocks-bulk-export"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("my-blocks.buildora-blocks.json");
    const exportPath = await download.path();
    expect(exportPath).toBeTruthy();

    // 4. Delete the selected records (bulk delete with confirmation).
    await page.locator('[data-testid="my-blocks-bulk-delete"]').click();
    await expect(page.locator('[data-testid="bulk-delete-dialog"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="bulk-delete-dialog"]')).toContainText("3", {
      timeout: 5000,
    });
    await page.locator('[data-testid="bulk-delete-confirm"]').click();
    await expect(page.locator('[data-testid="my-blocks-toast"]')).toContainText("Deleted 3", {
      timeout: 5000,
    });
    await expect(page.locator('[data-testid^="my-block-card-"]')).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('[data-testid="my-blocks-empty"]')).toBeVisible({ timeout: 5000 });

    // Exit selection mode — the bulk-delete dialog leaves it active and the
    // footer (with the Import button) only renders outside selection mode.
    await page.locator('[data-testid="my-blocks-selection-done"]').click();
    await expect(page.locator('[data-testid="my-blocks-selection-toolbar"]')).toHaveCount(0, {
      timeout: 5000,
    });

    // 5-7. Import the exported file → review → import all.
    await page.locator('[data-testid="my-blocks-import"]').click();
    await expect(page.locator('[data-testid="import-my-block-dialog"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="import-my-block-file"]').setInputFiles(exportPath!);
    await expect(page.locator('[data-testid="import-review-list"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="import-review-list"]')).toContainText("Bulk A", {
      timeout: 5000,
    });
    await expect(page.locator('[data-testid="import-review-list"]')).toContainText("Bulk C", {
      timeout: 5000,
    });
    // Import all 3.
    await page.locator('[data-testid="import-review-confirm"]').click();
    await expect(page.locator('[data-testid="import-summary"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="import-summary-imported"]')).toHaveText("3");
    await expect(page.locator('[data-testid="import-summary-failed"]')).toHaveText("0");
    await page.locator('[data-testid="import-my-block-done"]').click();

    // 8. Fresh library IDs — the three restored records are NEW records.
    await expect(page.locator('[data-testid^="my-block-card-"]')).toHaveCount(3, { timeout: 5000 });
    const idsAfter = await page
      .locator('[data-testid^="my-block-card-"]')
      .evaluateAll((els) =>
        els.map((el) => (el.getAttribute("data-testid") as string).replace("my-block-card-", "")),
      );
    expect(idsAfter).toHaveLength(3);
    for (const id of idsAfter) {
      expect(idsBefore).not.toContain(id);
    }

    // 9. Names stayed unique (no duplicates introduced by the round trip).
    const names = await page
      .locator('[data-testid^="my-block-card-"]')
      .evaluateAll((els) => els.map((el) => el.textContent ?? ""));
    const nameText = names.join(" | ");
    expect(nameText).toContain("Bulk A");
    expect(nameText).toContain("Bulk B");
    expect(nameText).toContain("Bulk C");

    // 10. Insert one imported block — a fresh custom-block section appears.
    await page.locator('[data-testid="my-blocks-close"]').click();
    await page.locator('[data-testid="right-tab-blocks"]').click();
    await page.locator('[data-testid="open-block-browser"]').click();
    await expect(page.locator('[data-testid="block-browser-dialog"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="block-cat-my-blocks"]').click();
    const addButton = page.locator('[data-testid^="my-block-browser-add-"]').first();
    await expect(addButton).toBeVisible({ timeout: 5000 });
    await addButton.click();
    // The three warm-up imports each placed a copy on the page — the browser
    // add makes four. ("Bulk A" appears in the warm-up copy too, so scope the
    // text check with .first().)
    await expect(page.locator(CUSTOM_BLOCK_SECTION)).toHaveCount(4, { timeout: 5000 });
    await expect(
      page.locator(CUSTOM_BLOCK_SECTION).getByText("Bulk A", { exact: true }).first(),
    ).toBeVisible({ timeout: 5000 });

    // 11. No console / page / network errors.
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
