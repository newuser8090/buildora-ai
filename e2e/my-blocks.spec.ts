import { test, expect } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Phase P4 — E2E: My Blocks cross-project reuse
//
// Flow:
//   1. create project A (SaaS)
//   2. import a static component through the Import Studio
//   3. save it as My Block (success screen action)
//   4. verify it appears in My Blocks (Command Palette → library)
//   5. create project B (blank)
//   6. open Blocks → block browser → My Blocks tab
//   7. insert the saved block
//   8. insert it again — verify the two copies share NO node ids (fresh IDs)
//   9. edit the second copy's heading — copy 1 stays unchanged (independence)
//  10. save + reload project B — inserted block persists
//  11. undo removes the inserted copy; redo restores it
//  12. reopen project A — its copy still has the original content
//  13. no console / page / network errors
// ---------------------------------------------------------------------------

const IMPORTED_HTML = `<section class="hero">
  <h1>My Blocks hero</h1>
  <p>Reuse this design anywhere.</p>
  <button class="cta">Get started</button>
</section>`;

// The live canvas only — the dashboard's thumbnail generator mounts an
// offscreen <ThumbnailProjectPreview> (left:-100000px) that ALSO renders
// custom-block sections. Scoping to the live preview keeps assertions on
// the real page content and immune to thumbnail machinery.
const CANVAS = '[data-testid="preview-content"]';
const CUSTOM_BLOCK_SECTION = `${CANVAS} [data-testid="custom-block-section"]`;

test.describe("My Blocks — cross-project save & reuse", () => {
  test("save → reuse in another project → fresh ids → independent copies → persist → undo/redo", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const audit = attachRuntimeAudit(page);

    // 1. Create project A and open the editor.
    const projectA = await createSaaSProjectAndOpenEditor(page);

    // 2. Import a static component.
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

    // 3. Save as My Block from the success screen.
    await page.locator('[data-testid="success-save-block"]').click();
    await expect(page.locator('[data-testid="save-my-block-dialog"]')).toBeVisible({ timeout: 5000 });
    const blockNameInput = page.locator('[data-testid="save-block-name"]');
    const suggestedName = (await blockNameInput.inputValue()).trim();
    expect(suggestedName.length).toBeGreaterThan(0);
    await page.locator('[data-testid="save-block-submit"]').click();
    await expect(page.locator('[data-testid="my-blocks-toast"]')).toContainText(
      "saved to My Blocks",
      { timeout: 5000 },
    );

    // 4. Verify the block appears in My Blocks (Command Palette → library).
    // NOTE: assert the card + its stable saved NAME. The card thumbnail
    // renders the block's structural preview only while idle, then swaps in an
    // <img> — so asserting on the transient h1 text would race with thumbnail
    // loading. The h1 content itself is verified deterministically later on
    // the live canvas (see lines ~160/177/198).
    await page.keyboard.press("Control+k");
    await expect(page.locator('[data-testid="command-palette"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="command-open-my-blocks"]').click();
    await expect(page.locator('[data-testid="my-blocks-library"]')).toBeVisible({ timeout: 5000 });
    const savedCard = page.locator('[data-testid^="my-block-card-"]').first();
    await expect(savedCard).toBeVisible({ timeout: 5000 });
    await expect(savedCard).toContainText(suggestedName);
    await page.locator('[data-testid="my-blocks-close"]').click();

    // Return to the dashboard (saves A) and create project B. The dashboard
    // now lists project A, so project B is created inline (the shared blank
    // helper assumes the first-run empty dashboard).
    await page.getByRole("button", { name: "Back to Dashboard" }).click();
    await page.waitForURL("/", { timeout: 15000 });
    await page.getByRole("button", { name: "New Project" }).first().click();
    await expect(page.getByRole("dialog", { name: "New Project" })).toBeVisible();
    await page.getByRole("button", { name: "Use Blank Project" }).first().click();
    await expect(page.locator("#new-project-name")).toHaveValue("Untitled Project");
    await page.locator('[data-testid="create-project-button"]').click();
    await page.waitForURL(/\/editor\/.+/, { timeout: 20000 });
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({ timeout: 20000 });
    const match = page.url().match(/\/editor\/([^/?]+)/);
    const projectB = match ? match[1] : "";
    expect(projectB).not.toBe("");
    expect(projectB).not.toBe(projectA);

    // 6-7. Open Blocks → browser → My Blocks tab → insert.
    await page.locator('[data-testid="right-tab-blocks"]').click();
    await expect(page.locator('[data-testid="build-tree-panel"]')).toBeVisible();
    await page.locator('[data-testid="open-block-browser"]').click();
    await expect(page.locator('[data-testid="block-browser-dialog"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="block-cat-my-blocks"]').click();
    const addButton = page.locator('[data-testid^="my-block-browser-add-"]').first();
    await expect(addButton).toBeVisible({ timeout: 5000 });
    await addButton.click();
    await expect(page.locator(CUSTOM_BLOCK_SECTION)).toHaveCount(1, {
      timeout: 5000,
    });

    // 8. Capture the first copy's node ids, then insert a second copy.
    // Insertion targets the hero section, so the NEW copy lands BEFORE the
    // existing one in the DOM. The ids must be completely disjoint.
    const firstCopy = page.locator(CUSTOM_BLOCK_SECTION).first();
    const firstIds = await firstCopy.locator("[data-block-id]").evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-block-id") as string),
    );
    expect(firstIds.length).toBeGreaterThan(0);

    await page.locator('[data-testid="open-block-browser"]').click();
    await page.locator('[data-testid="block-cat-my-blocks"]').click();
    await page.locator('[data-testid^="my-block-browser-add-"]').first().click();
    await expect(page.locator(CUSTOM_BLOCK_SECTION)).toHaveCount(2, {
      timeout: 5000,
    });
    // The newest copy is now first in the DOM (inserted after the hero).
    const secondCopy = page.locator(CUSTOM_BLOCK_SECTION).first();
    const secondIds = await secondCopy.locator("[data-block-id]").evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-block-id") as string),
    );
    expect(secondIds.length).toBeGreaterThan(0);
    const firstSet = new Set(firstIds);
    for (const id of secondIds) {
      expect(firstSet.has(id)).toBe(false);
    }

    // 9. Undo removes the inserted copy; redo restores it. (Two inserted
    // copies = two history entries; each undo removes one whole copy. This
    // runs BEFORE the edit so the history has exactly the two insertions.)
    await page.locator('[data-testid="undo-button"]').click();
    await page.waitForTimeout(400);
    await expect(page.locator(CUSTOM_BLOCK_SECTION)).toHaveCount(1, {
      timeout: 5000,
    });
    await page.locator('[data-testid="redo-button"]').click();
    await page.waitForTimeout(400);
    await expect(page.locator(CUSTOM_BLOCK_SECTION)).toHaveCount(2, {
      timeout: 5000,
    });

    // 10. Edit the second copy's heading — the first copy stays untouched.
    // The ORIGINAL copy is now the SECOND section in the DOM.
    const originalCopy = page.locator(CUSTOM_BLOCK_SECTION).nth(1);
    const secondHeadingId = await secondCopy
      .getByText("My Blocks hero", { exact: true })
      .getAttribute("data-block-id");
    expect(secondHeadingId).toBeTruthy();
    // Select the block through the build tree (canvas clicks do not select).
    const secondSectionBlockId = await secondCopy
      .locator('[data-block-type="container"]')
      .first()
      .getAttribute("data-block-id");
    await page
      .locator(`[data-testid="block-row-${secondSectionBlockId}"]`)
      .locator('[aria-label="Expand"]')
      .click();
    await page.locator(`[data-testid="block-row-${secondHeadingId}"]`).click();
    await expect(page.locator('[data-testid="block-inspector"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="block-inspector-text"]').fill("Edited in B");
    await page.locator('[data-testid="block-inspector-save"]').click();
    await expect(secondCopy.getByText("Edited in B", { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(originalCopy.getByText("My Blocks hero", { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(originalCopy.getByText("Edited in B", { exact: true })).toHaveCount(0);

    // 11. Save + reload project B — the inserted block persists.
    await page.locator('[data-testid="topnav-save-button"]').click();
    await expect(page.locator('[data-testid="topnav-save-button"]')).toContainText("Saved", {
      timeout: 10000,
    });
    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator(CUSTOM_BLOCK_SECTION)).toHaveCount(2, {
      timeout: 10000,
    });
    await expect(
      page.locator(CUSTOM_BLOCK_SECTION).getByText("Edited in B", { exact: true }),
    ).toBeVisible({ timeout: 10000 });

    // 12. Reopen project A — its copy still has the original content.
    await page.goto(`/editor/${projectA}`);
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({ timeout: 15000 });
    await expect(
      page.locator(CUSTOM_BLOCK_SECTION).getByText("My Blocks hero", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator(CUSTOM_BLOCK_SECTION).getByText("Edited in B", { exact: true }),
    ).toHaveCount(0);

    // 13. No console / page / network errors.
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
