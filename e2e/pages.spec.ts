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

/** [{ id, title, selected }] for every page tab, in DOM order. */
async function getPageTabs(page: Page) {
  return page.locator('[data-testid^="page-tab-"]').evaluateAll((els) =>
    els
      .filter((el) => el.getAttribute("data-testid") !== "page-tab-add")
      .map((el) => {
        const tab = el.querySelector('[role="tab"]');
        return {
          id: (el.getAttribute("data-testid") ?? "").replace("page-tab-", ""),
          title: tab?.querySelector("span")?.textContent ?? "",
          selected: tab?.getAttribute("aria-selected") === "true",
        };
      }),
  );
}

/** Ordered structure row types for the ACTIVE page. */
async function getStructureTypes(page: Page) {
  return page
    .locator('[data-testid^="structure-row-"]')
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-section-type") ?? ""),
    );
}

async function openStructureTab(page: Page) {
  await page.locator('[data-testid="right-tab-structure"]').click();
  await expect(page.locator('[data-testid="structure-panel"]')).toBeVisible();
}

/** Add a section of the given type through the Add Section dialog. */
async function addSection(page: Page, type: string) {
  await page.locator('[data-testid="add-section-button"]').click();
  const dialog = page.getByRole("dialog", { name: "Add Section" });
  await expect(dialog).toBeVisible();
  await page.locator(`[data-testid="section-card-${type}"]`).click();
  await page.locator('[data-testid="confirm-add-section"]').click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });
}

/** Run an action from a page tab's action menu. */
async function runPageAction(page: Page, pageId: string, action: string) {
  await page.locator(`[data-testid="page-menu-${pageId}"]`).click();
  await page.locator(`[data-testid="page-action-${action}"]`).click();
}

/** Rename the currently-inline-renaming page tab. */
async function finishRename(page: Page, title: string) {
  const input = page.locator('[data-testid="page-rename-input"]');
  await expect(input).toBeVisible();
  await input.fill(title);
  await input.press("Enter");
  await expect(input).not.toBeVisible({ timeout: 5000 });
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

test.describe("Multi-page editor flow", () => {
  test("add, rename, reorder, switch, delete, persist pages", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const audit = attachRuntimeAudit(page);

    // 1. Create a Blank project and open the editor — single Home page.
    await createBlankProjectAndOpenEditor(page);
    let tabs = await getPageTabs(page);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ title: "Home", selected: true });
    await openStructureTab(page);
    await expect.poll(async () => getStructureTypes(page)).toEqual(["hero"]);

    // 2. Add a page → auto-named and immediately in rename mode.
    await page.locator('[data-testid="page-tab-add"]').click();
    await finishRename(page, "About");
    tabs = await getPageTabs(page);
    expect(tabs.map((t) => t.title)).toEqual(["Home", "About"]);
    expect(tabs[1].selected).toBe(true);

    // 3. The new page is independent: add a CTA to it.
    await addSection(page, "cta");
    await openStructureTab(page);
    await expect
      .poll(async () => getStructureTypes(page), { timeout: 5000 })
      .toEqual(["hero", "cta"]);

    // 4. Switch back to Home — its sections are untouched.
    const homeTab = tabs[0];
    await page.locator(`[data-testid="page-tab-${homeTab.id}"]`).click();
    await expect
      .poll(async () => getStructureTypes(page), { timeout: 5000 })
      .toEqual(["hero"]);
    const homeTabSelected = (await getPageTabs(page))[0].selected;
    expect(homeTabSelected).toBe(true);

    // 5. Keyboard navigation: arrow keys move between tabs.
    await page.keyboard.press("ArrowRight");
    tabs = await getPageTabs(page);
    expect(tabs[1].selected).toBe(true);

    // 6. Rename "About" → "About Us" via the action menu.
    await runPageAction(page, tabs[1].id, "rename");
    await finishRename(page, "About Us");
    tabs = await getPageTabs(page);
    expect(tabs.map((t) => t.title)).toEqual(["Home", "About Us"]);

    // 7. Reorder: move "About Us" to the front.
    await runPageAction(page, tabs[1].id, "move-left");
    tabs = await getPageTabs(page);
    expect(tabs.map((t) => t.title)).toEqual(["About Us", "Home"]);

    // 8. Delete "About Us" (confirm dialog) → Home remains, selected.
    await runPageAction(page, tabs[0].id, "delete");
    const dialog = page.getByRole("dialog", { name: "Delete page?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(dialog).not.toBeVisible();
    tabs = await getPageTabs(page);
    expect(tabs.map((t) => t.title)).toEqual(["Home"]);
    expect(tabs[0].selected).toBe(true);

    // 9. Add "Contact" and persist: save, reload, verify both pages remain.
    await page.locator('[data-testid="page-tab-add"]').click();
    await finishRename(page, "Contact");
    const saveBtn = page.locator('header button[title*="Save"]');
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();
    await expect(saveBtn).toHaveAttribute("title", "Saved", { timeout: 5000 });

    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
      timeout: 15000,
    });
    const persisted = await getPageTabs(page);
    expect(persisted.map((t) => t.title)).toEqual(["Home", "Contact"]);

    // 10. Clean runtime — no console errors / failed requests.
    assertNoFailedRequests(audit.state);
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
