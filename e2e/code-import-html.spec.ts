import { test, expect } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Phase P3 — E2E: HTML import through the Import Studio
//
// Flow:
//   1. create a SaaS project
//   2. open Blocks tab → Import code
//   3. paste static Tailwind HTML
//   4. analyse
//   5. verify friendly detected components
//   6. verify the native tree preview
//   7. choose placement
//   8. insert
//   9. verify the custom block appears in the Build Tree
//  10. edit the imported heading through the block inspector
//  11. Undo reverts the edit, then one more Undo removes the full import
//     (insertion is a single history entry)
//  12. Redo restores the import, then re-applies the edit
//  13. save / reload — the imported block persists
//  14. export the project — the custom block survives the round trip
//  15. no console / page / network errors
// ---------------------------------------------------------------------------

const IMPORTED_HTML = `<section class="pricing">
  <h2 class="title">Simple pricing</h2>
  <p class="subtitle">Pick a plan that works for you.</p>
  <div class="plans grid grid-cols-3 gap-4">
    <div class="plan card p-6 rounded-xl">
      <h3>Starter</h3>
      <p class="price">$9</p>
      <button class="cta">Choose Starter</button>
    </div>
    <div class="plan card p-6 rounded-xl">
      <h3>Pro</h3>
      <p class="price">$29</p>
      <button class="cta">Choose Pro</button>
    </div>
  </div>
</section>`;

test.describe("Code import — HTML happy path", () => {
  test("paste, analyse, review, place, insert, edit, undo/redo, persist, export", async ({
    page,
  }) => {
    const audit = attachRuntimeAudit(page);

    // 1. Create a SaaS project and open the editor.
    await createSaaSProjectAndOpenEditor(page);

    // 2. Open Blocks tab → Import code (Build Tree panel entry point).
    await page.locator('[data-testid="right-tab-blocks"]').click();
    await expect(page.locator('[data-testid="build-tree-panel"]')).toBeVisible();
    await page.locator('[data-testid="build-tree-import-code"]').click();
    await expect(page.locator('[data-testid="code-import-dialog"]')).toBeVisible({
      timeout: 5000,
    });

    // 3. Paste static HTML.
    await page.locator('[data-testid="code-import-source"]').fill(IMPORTED_HTML);

    // 4. Analyse.
    await page.locator('[data-testid="code-import-analyse"]').click();

    // 5. Friendly detected components.
    await expect(page.locator('[data-testid="analysis-result"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("We found")).toBeVisible();
    await expect(page.getByText(/editable blocks?/i).first()).toBeVisible();
    await expect(page.locator('[data-testid="import-confidence"]')).toBeVisible();

    // 6. Review — native tree preview + visual preview.
    await page.locator('[data-testid="analysis-continue"]').click();
    await expect(page.locator('[data-testid="review-step"]')).toBeVisible();
    await expect(page.locator('[data-testid="import-visual-preview"]')).toBeVisible();
    await expect(page.locator('[data-testid="import-tree-preview"]')).toBeVisible();

    // 7. Placement.
    await page.locator('[data-testid="review-continue"]').click();
    await expect(page.locator('[data-testid="placement-step"]')).toBeVisible();
    await expect(page.locator('[data-testid="placement-options"]')).toBeVisible();

    // 8. Insert.
    await page.locator('[data-testid="insert-button"]').click();

    // 9. Success + the custom block appears in the Build Tree.
    await expect(page.locator('[data-testid="import-success"]')).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("Your design was added.")).toBeVisible();
    // Blocks tab opens automatically after insertion.
    await expect(page.locator('[data-testid="blocks-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="build-tree-panel"]')).toBeVisible();

    // Close the success dialog before interacting with the canvas / tree
    // behind it (the dialog backdrop intercepts pointer events).
    await page.locator('[data-testid="success-edit-now"]').click();

    // The imported design renders as its own section on the canvas. Scope all
    // text assertions to it — the SaaS template already contains a pricing
    // title ("Simple pricing that scales with you") with the same substring.
    const importedSection = page.locator('[data-testid="custom-block-section"]');
    await expect(
      importedSection.getByText("Simple pricing", { exact: true }),
    ).toBeVisible({ timeout: 5000 });

    // 10. Edit the imported heading via the block inspector. Editable blocks
    // select through the build tree (a canvas click does not select), so
    // discover the remapped ids from the DOM, expand the section row, then
    // pick the heading row.
    const headingBlockId = await importedSection
      .getByText("Simple pricing", { exact: true })
      .getAttribute("data-block-id");
    expect(headingBlockId).toBeTruthy();
    const sectionBlockId = await importedSection
      .locator('[data-block-type="container"]')
      .first()
      .getAttribute("data-block-id");
    expect(sectionBlockId).toBeTruthy();
    await page
      .locator(`[data-testid="block-row-${sectionBlockId}"]`)
      .locator('[aria-label="Expand"]')
      .click();
    await page.locator(`[data-testid="block-row-${headingBlockId}"]`).click();
    await expect(page.locator('[data-testid="block-inspector"]')).toBeVisible({
      timeout: 5000,
    });
    await page
      .locator('[data-testid="block-inspector-text"]')
      .fill("Edited pricing");
    await page.locator('[data-testid="block-inspector-save"]').click();
    await expect(
      importedSection.getByText("Edited pricing", { exact: true }),
    ).toBeVisible({ timeout: 5000 });

    // 11. Undo #1 reverts the text edit (the edit is its own history entry).
    await page.locator('[data-testid="undo-button"]').click();
    await page.waitForTimeout(400);
    await expect(
      importedSection.getByText("Edited pricing", { exact: true }),
    ).toHaveCount(0);
    await expect(
      importedSection.getByText("Simple pricing", { exact: true }),
    ).toBeVisible({ timeout: 5000 });
    // Undo #2 removes the WHOLE import (insertion is exactly ONE history entry).
    await page.locator('[data-testid="undo-button"]').click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="custom-block-section"]')).toHaveCount(0);

    // 12. Redo #1 restores the full import; Redo #2 re-applies the edit.
    await page.locator('[data-testid="redo-button"]').click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="custom-block-section"]')).toHaveCount(1);
    await expect(
      page
        .locator('[data-testid="custom-block-section"]')
        .getByText("Simple pricing", { exact: true }),
    ).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="redo-button"]').click();
    await page.waitForTimeout(400);
    await expect(
      page
        .locator('[data-testid="custom-block-section"]')
        .getByText("Edited pricing", { exact: true }),
    ).toBeVisible({ timeout: 5000 });

    // 13. Save + reload — the import persists. Autosave runs on a 3s
    // debounce, so force a save first: the reload must provably read
    // persisted state, not the in-memory tree.
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Saved", exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page
        .locator('[data-testid="custom-block-section"]')
        .getByText("Edited pricing", { exact: true }),
    ).toBeVisible({ timeout: 10000 });

    // 14. Export the project — custom block survives the .buildora.json round trip.
    const downloadPromise = page.waitForEvent("download", { timeout: 10000 });
    await page.locator('[data-testid="export-button"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.buildora\.json$/);
    const stream = await download.createReadStream();
    let body = "";
    if (stream) {
      for await (const chunk of stream) {
        body += chunk.toString();
      }
    }
    expect(body).toContain("custom-block");
    expect(body).toContain("Edited pricing");
    // The pasted source is NOT stored — only its converted block content is.
    // "Choose Starter" is the converted button TEXT and is legitimately part
    // of the tree; the raw HTML markup must never appear.
    expect(body).not.toContain('<section class="pricing">');
    expect(body).not.toContain('<div class="plan');
    expect(body).not.toContain("onClick");

    // 15. No console / page / network errors.
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
