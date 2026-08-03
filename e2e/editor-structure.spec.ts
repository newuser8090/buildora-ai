import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
  assertNoFailedRequests,
} from "./helpers/runtime-audit";
import { createBlankProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Ordered structure rows: [{ id, type, hidden }] in DOM order. */
async function getStructureOrder(page: Page) {
  return page.locator('[data-testid^="structure-row-"]').evaluateAll((els) =>
    els.map((el) => ({
      id: el.getAttribute("data-structure-row-id") ?? "",
      type: el.getAttribute("data-section-type") ?? "",
      hidden: el.querySelector('[data-testid^="hidden-badge-"]') !== null,
    })),
  );
}

/** Ordered visible section ids rendered on the canvas. */
async function getCanvasOrder(page: Page) {
  return page
    .locator('[data-testid="preview-content"] [data-section-id]')
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-section-id") ?? ""),
    );
}

async function expectStructureTypes(page: Page, types: string[]) {
  await expect
    .poll(async () => (await getStructureOrder(page)).map((r) => r.type), {
      timeout: 5000,
    })
    .toEqual(types);
}

/** Canvas order must equal the visible structure order (same ids). */
async function expectCanvasMatchesStructure(page: Page) {
  const rows = await getStructureOrder(page);
  const visible = rows.filter((r) => !r.hidden).map((r) => r.id);
  await expect
    .poll(async () => getCanvasOrder(page), { timeout: 5000 })
    .toEqual(visible);
}

async function openStructureTab(page: Page) {
  await page.locator('[data-testid="right-tab-structure"]').click();
  await expect(page.locator('[data-testid="structure-panel"]')).toBeVisible();
}

/**
 * Open the Add Section dialog, pick a card, and confirm. The dialog is opened
 * from the structure panel; after a successful insert the sidebar switches to
 * the Design tab (documented UX), so callers re-open the Structure tab.
 */
async function addSection(page: Page, type: string) {
  await page.locator('[data-testid="add-section-button"]').click();
  const dialog = page.getByRole("dialog", { name: "Add Section" });
  await expect(dialog).toBeVisible();
  await page.locator(`[data-testid="section-card-${type}"]`).click();
  await page.locator('[data-testid="confirm-add-section"]').click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });
}

/** Select the nth structure row of a given type (for before/after positions). */
async function selectRowOfType(page: Page, type: string, nth = 0) {
  const row = page.locator(`[data-section-type="${type}"]`).nth(nth);
  await expect(row).toBeVisible();
  await row.click();
}

/** Pointer-drag a section row onto another row (real dnd-kit drag). */
async function dragSectionOnto(page: Page, fromType: string, toType: string) {
  const handle = page
    .locator(`[data-section-type="${fromType}"] [data-testid^="drag-handle-"]`)
    .first();
  const target = page.locator(`[data-section-type="${toType}"]`).first();
  await expect(handle).toBeVisible();
  await handle.scrollIntoViewIfNeeded();
  const hb = await handle.boundingBox();
  const tb = await target.boundingBox();
  if (!hb || !tb) throw new Error("Drag handles have no bounding box");
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  // Let dnd-kit's PointerSensor (activation constraint 6px) register the
  // press before we start moving, then land on the target row's top edge so
  // closestCenter deterministically resolves to the target row.
  await page.waitForTimeout(80);
  await page.mouse.move(tb.x + tb.width / 2, tb.y + 4, { steps: 15 });
  await page.mouse.up();
}

/** Run an action from a row's action menu. */
async function runRowAction(page: Page, type: string, action: string, nth = 0) {
  const row = page.locator(`[data-section-type="${type}"]`).nth(nth);
  await expect(row).toBeVisible();
  const menu = row.locator('[data-testid^="section-menu-"]').first();
  await menu.click();
  await page.locator(`[data-testid="section-action-${action}"]`).click();
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

test.describe("Editor structure flow", () => {
  test("add, reorder, duplicate, hide, delete, undo/redo, persist", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const audit = attachRuntimeAudit(page);

    // 1. Create a Blank project and open the editor.
    await createBlankProjectAndOpenEditor(page);
    await openStructureTab(page);

    // Blank template ships a single starter hero.
    await expectStructureTypes(page, ["hero"]);

    // 4. Add Header (appended to the end — no selection yet).
    await addSection(page, "header");
    await openStructureTab(page);
    await expectStructureTypes(page, ["hero", "header"]);

    // 5. Add Hero after Header (select Header first → default after).
    await selectRowOfType(page, "header");
    await addSection(page, "hero");
    await openStructureTab(page);
    await expectStructureTypes(page, ["hero", "header", "hero"]);

    // 6. Add Features after the newly inserted Hero.
    await selectRowOfType(page, "hero", 1);
    await addSection(page, "features");
    await openStructureTab(page);
    await expectStructureTypes(page, ["hero", "header", "hero", "features"]);

    // 7. Verify section order (structure + canvas agree).
    await expectCanvasMatchesStructure(page);

    // 8-10. Drag Features above the first Hero.
    await dragSectionOnto(page, "features", "hero");
    await expectStructureTypes(page, ["features", "hero", "header", "hero"]);
    await expectCanvasMatchesStructure(page);

    // 11-12. Undo restores the previous order.
    await page.locator('[data-testid="undo-button"]').click();
    await expectStructureTypes(page, ["hero", "header", "hero", "features"]);
    await expectCanvasMatchesStructure(page);

    // 13-14. Redo reapplies the reordered state.
    await page.locator('[data-testid="redo-button"]').click();
    await expectStructureTypes(page, ["features", "hero", "header", "hero"]);
    await expectCanvasMatchesStructure(page);

    // 15-16. Duplicate the first Hero → fresh id, inserted right after.
    const beforeDup = await getStructureOrder(page);
    await runRowAction(page, "hero", "duplicate", 0);
    const afterDup = await getStructureOrder(page);
    expect(afterDup).toHaveLength(beforeDup.length + 1);
    expect(afterDup.map((r) => r.type)).toEqual([
      "features",
      "hero",
      "hero",
      "header",
      "hero",
    ]);
    // New id, original hero untouched.
    expect(afterDup[2].id).not.toBe(afterDup[1].id);
    expect(afterDup[1].id).toBe(beforeDup[1].id);
    await expectCanvasMatchesStructure(page);

    // 17-19. Hide the duplicated Hero: canvas hides it, structure keeps it.
    await runRowAction(page, "hero", "toggle-visible", 1);
    const hiddenRows = await getStructureOrder(page);
    expect(hiddenRows).toHaveLength(5);
    expect(hiddenRows[2].hidden).toBe(true);
    await expectCanvasMatchesStructure(page);

    // 20. Delete the duplicated Hero.
    await runRowAction(page, "hero", "delete", 1);
    await expectStructureTypes(page, ["features", "hero", "header", "hero"]);

    // 21. Undo delete → duplicate restored (still hidden).
    await page.locator('[data-testid="undo-button"]').click();
    const restored = await getStructureOrder(page);
    expect(restored).toHaveLength(5);
    expect(restored[2].hidden).toBe(true);
    expect(restored.map((r) => r.type)).toEqual([
      "features",
      "hero",
      "hero",
      "header",
      "hero",
    ]);

    // 22. Save. The flush is async — wait until the save indicator reaches
    // "Saved" before reloading, otherwise the reload can abort the in-flight
    // IndexedDB write and the final undo-delete would be lost.
    const saveBtn = page.locator('header button[title*="Save"]');
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();
    await expect(saveBtn).toHaveAttribute("title", "Saved", { timeout: 5000 });

    // 23-24. Reload the editor → final structure persists from IndexedDB.
    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
      timeout: 15000,
    });
    await openStructureTab(page);
    const persisted = await getStructureOrder(page);
    expect(persisted.map((r) => r.type)).toEqual([
      "features",
      "hero",
      "hero",
      "header",
      "hero",
    ]);
    expect(persisted[2].hidden).toBe(true);
    await expectCanvasMatchesStructure(page);

    // 25-26. Return to the dashboard; the project remains available.
    await page.getByRole("button", { name: "Back to Dashboard" }).click();
    await page.waitForURL("/", { timeout: 15000 });
    await expect(
      page.locator('[data-testid="project-thumbnail"]').first(),
    ).toBeVisible({ timeout: 10000 });

    // 27-29. No console errors / page errors / failed requests.
    assertNoFailedRequests(audit.state);
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  // -------------------------------------------------------------------------
  // Keyboard-only flow
  // -------------------------------------------------------------------------

  test("keyboard-only: add via dialog, reorder, action menu, hide/show", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const audit = attachRuntimeAudit(page);

    await createBlankProjectAndOpenEditor(page);
    await openStructureTab(page);

    // Add a CTA section entirely via keyboard.
    const addButton = page.locator('[data-testid="add-section-button"]');
    await addButton.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add Section" });
    await expect(dialog).toBeVisible();

    // Search box receives focus; type to filter to the CTA card.
    await expect(page.getByLabel("Search sections")).toBeFocused({
      timeout: 2000,
    });
    await page.keyboard.type("Call to Action");

    // Tab until the CTA card is focused, activate it, then tab to Add.
    await page.keyboard.press("Tab");
    for (let i = 0; i < 20; i += 1) {
      const active = await page.evaluate(
        () => document.activeElement?.getAttribute("data-testid") ?? "",
      );
      if (active === "section-card-cta") break;
      await page.keyboard.press("Tab");
    }
    await page.keyboard.press("Enter"); // select the card
    for (let i = 0; i < 20; i += 1) {
      const active = await page.evaluate(
        () => document.activeElement?.getAttribute("data-testid") ?? "",
      );
      if (active === "confirm-add-section") break;
      await page.keyboard.press("Tab");
    }
    await page.keyboard.press("Enter"); // insert
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // CTA appended after the starter hero.
    await openStructureTab(page);
    await expectStructureTypes(page, ["hero", "cta"]);

    // Keyboard reorder: focus the CTA row and press Alt+ArrowUp.
    const ctaRow = page.locator('[data-section-type="cta"]').first();
    await ctaRow.focus();
    await page.keyboard.press("Alt+ArrowUp");
    await expectStructureTypes(page, ["cta", "hero"]);

    // Action menu via keyboard: open with Enter, tab to Hide, activate.
    const ctaId = (await getStructureOrder(page))[0].id;
    const menuButton = page.locator(
      `[data-testid="section-menu-${ctaId}"]`,
    );
    await menuButton.focus();
    await page.keyboard.press("Enter");
    for (let i = 0; i < 20; i += 1) {
      const active = await page.evaluate(
        () => document.activeElement?.getAttribute("data-testid") ?? "",
      );
      if (active === "section-action-toggle-visible") break;
      await page.keyboard.press("Tab");
    }
    await page.keyboard.press("Enter"); // hide
    const hidden = await getStructureOrder(page);
    expect(hidden[0].hidden).toBe(true);
    await expectCanvasMatchesStructure(page);

    // Show it again through the same keyboard path.
    await page.locator(`[data-testid="section-menu-${ctaId}"]`).focus();
    await page.keyboard.press("Enter");
    for (let i = 0; i < 20; i += 1) {
      const active = await page.evaluate(
        () => document.activeElement?.getAttribute("data-testid") ?? "",
      );
      if (active === "section-action-toggle-visible") break;
      await page.keyboard.press("Tab");
    }
    await page.keyboard.press("Enter"); // show
    const shown = await getStructureOrder(page);
    expect(shown[0].hidden).toBe(false);
    await expectCanvasMatchesStructure(page);

    assertNoFailedRequests(audit.state);
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
