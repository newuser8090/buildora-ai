import { test, expect } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor, importHtmlAndSaveAsMyBlock } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Phase P5 — E2E: drag-and-drop insertion of a saved block
//
// Flow:
//   1. create project
//   2. save a reusable block (import → save)
//   3. open My Blocks
//   4. begin a drag from the card drag handle
//   5. verify drop zones appear on the canvas
//   6. drop at a valid section boundary
//   7. verify the inserted block
//   8. one Undo removes the whole copy
//   9. Redo restores it
//  10. a drop outside any zone is a no-op (invalid target rejected)
//  11. save + reload preserves the valid insertion
//  12. keyboard / placement-picker insertion remains available
//  13. no console / page / network errors
//
// The library overlay and the canvas live in the SAME DndContext (the
// MyBlockDndProvider wraps the editor shell), so a real pointer drag from a
// library card handle to a canvas drop zone exercises the canonical drop
// path end to end (drop → insertMyBlock → one history entry).
// ---------------------------------------------------------------------------

const BLOCK_HTML = `<section class="feature">
  <h2>Draggable block</h2>
  <p>Drag me onto the page.</p>
</section>`;

const CANVAS = '[data-testid="preview-content"]';
const CUSTOM_BLOCK_SECTION = `${CANVAS} [data-testid="custom-block-section"]`;

test.describe("My Blocks — drag insertion", () => {
  test("drag from library → valid drop zone → insert → undo/redo → invalid no-op → persist", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const audit = attachRuntimeAudit(page);

    // 1-2. Create project + save a reusable block.
    await createSaaSProjectAndOpenEditor(page);
    await importHtmlAndSaveAsMyBlock(page, BLOCK_HTML, "Draggable block");

    // 3. Open My Blocks.
    await page.locator('[data-testid="topnav-my-blocks-button"]').click();
    await expect(page.locator('[data-testid="my-blocks-library"]')).toBeVisible({ timeout: 5000 });
    const card = page.locator('[data-testid^="my-block-card-"]').first();
    await expect(card).toBeVisible({ timeout: 10000 });
    const cardId = (await card.getAttribute("data-testid"))!.replace("my-block-card-", "");

    // Close the library but keep the editor mounted — drags start from the
    // card handle inside the library overlay in the same DndContext.
    const dragHandle = page.locator(`[data-testid="my-block-drag-${cardId}"]`);
    await expect(dragHandle).toBeVisible();

    // 4-5. Start the drag; drop zones appear on the canvas.
    const hb = await dragHandle.boundingBox();
    if (!hb) throw new Error("Drag handle has no bounding box");
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.move(hb.x + hb.width / 2 + 24, hb.y + hb.height / 2 + 24, { steps: 6 });
    await page.waitForTimeout(250); // let the drop zones mount AND register with dnd-kit

    // A drop zone must now be visible (before/after the existing sections).
    const afterZone = page.locator('[data-testid^="my-block-drop-zone-after-section-"]').first();
    await expect(afterZone).toBeVisible({ timeout: 5000 });

    // 6. Drop at the after-section boundary of the first section. The zone
    // mounted DURING the drag and may sit far outside the viewport (the canvas
    // can be scrolled) — an off-screen pointer target makes dnd-kit autoScroll
    // chase it and the zone keeps moving. Scroll the zone onto the screen
    // first, let dnd-kit re-measure, then move the pointer to its center.
    await afterZone.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const db = await afterZone.boundingBox();
    if (!db) throw new Error("Drop zone has no bounding box");
    await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2, { steps: 10 });
    await page.waitForTimeout(150);
    // Small jiggle forces fresh collision checks after the pointer settles.
    await page.mouse.move(db.x + db.width / 2 + 8, db.y + db.height / 2, { steps: 4 });
    await page.waitForTimeout(80);
    await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2, { steps: 4 });
    await page.waitForTimeout(80);
    // The zone should be visually active while hovered.
    await expect(afterZone).toHaveAttribute("data-drop-zone-active", "true", { timeout: 3000 });
    await page.mouse.up();

    // 7. The drop inserted a SECOND custom-block section — the saved import
    // in step 2 already placed one copy on the page, and the drag adds another.
    await expect(page.locator(CUSTOM_BLOCK_SECTION)).toHaveCount(2, { timeout: 5000 });
    await expect(
      page.locator(CUSTOM_BLOCK_SECTION).getByText("Draggable block", { exact: true }).first(),
    ).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="my-blocks-toast"]')).toContainText("added to your page", {
      timeout: 5000,
    });

    // 8-9. One Undo removes the whole drag copy (the import's copy remains);
    // Redo restores it. The library overlay covers the top nav, so close it
    // first.
    await page.locator('[data-testid="my-blocks-close"]').click();
    await page.locator('[data-testid="undo-button"]').click();
    await page.waitForTimeout(400);
    await expect(page.locator(CUSTOM_BLOCK_SECTION)).toHaveCount(1, { timeout: 5000 });
    await page.locator('[data-testid="redo-button"]').click();
    await page.waitForTimeout(400);
    await expect(page.locator(CUSTOM_BLOCK_SECTION)).toHaveCount(2, { timeout: 5000 });

    // 10. A second drag that ends OUTSIDE any drop zone is a no-op. Reopen the
    // library — the cancel path must leave the project untouched.
    await page.locator('[data-testid="topnav-my-blocks-button"]').click();
    await expect(page.locator('[data-testid="my-blocks-library"]')).toBeVisible({ timeout: 5000 });
    const dragHandle2 = page.locator(`[data-testid="my-block-drag-${cardId}"]`);
    const hb2 = await dragHandle2.boundingBox();
    if (!hb2) throw new Error("Drag handle 2 has no bounding box");
    await page.mouse.move(hb2.x + hb2.width / 2, hb2.y + hb2.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.move(hb2.x + hb2.width / 2 + 24, hb2.y + hb2.height / 2 + 24, { steps: 6 });
    // Move somewhere far from any zone: the top-left corner of the viewport
    // (over the top nav) is not a droppable region.
    await page.mouse.move(12, 12, { steps: 8 });
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(300);
    await expect(page.locator(CUSTOM_BLOCK_SECTION)).toHaveCount(2, { timeout: 5000 });
    // The library is still open (cancel path left it untouched).
    await expect(page.locator('[data-testid="my-blocks-library"]')).toBeVisible();

    // Close the library; the valid insertion remains.
    await page.locator('[data-testid="my-blocks-close"]').click();

    // 11. Save + reload — the valid insertion persists.
    await page.locator('[data-testid="topnav-save-button"]').click();
    await expect(page.locator('[data-testid="topnav-save-button"]')).toContainText("Saved", {
      timeout: 10000,
    });
    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator(CUSTOM_BLOCK_SECTION)).toHaveCount(2, { timeout: 10000 });
    await expect(
      page.locator(CUSTOM_BLOCK_SECTION).getByText("Draggable block", { exact: true }).first(),
    ).toBeVisible({ timeout: 10000 });

    // 12. Keyboard / placement-picker insertion remains available: Insert →
    // picker → choose a spot.
    await page.locator('[data-testid="topnav-my-blocks-button"]').click();
    await expect(page.locator('[data-testid="my-blocks-library"]')).toBeVisible({ timeout: 5000 });
    const insertButton = page.locator('[data-testid^="my-block-insert-"]').first();
    await expect(insertButton).toBeVisible({ timeout: 5000 });
    await insertButton.click();
    await expect(page.locator('[data-testid="placement-picker-dialog"]')).toBeVisible({ timeout: 5000 });
    // "End of page" is always valid ("Below selected part" needs a selected
    // section, which is not guaranteed after a reload).
    await page.locator('[data-testid="placement-option-end"]').click();
    await expect(page.locator(CUSTOM_BLOCK_SECTION)).toHaveCount(3, { timeout: 5000 });
    await expect(page.locator('[data-testid="my-blocks-toast"]')).toContainText("added to your page", {
      timeout: 5000,
    });

    // 13. No console / page / network errors.
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
