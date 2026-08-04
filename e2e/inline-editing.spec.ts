import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Phase M — manual inline editing E2E (spec §31)
//
// Flow:
//   1. create SaaS project
//   2. open editor
//   3. click Hero headline (field becomes selectable)
//   4. double-click → enter inline edit mode
//   5. change headline
//   6. save
//   7. Undo restores old headline
//   8. Redo restores new headline
//   9. reload → value persists
//   no console/page/network errors
//
// All store/update/undo/persistence behavior is REAL — no mocks beyond the
// route interception pattern used by the other AI specs (none here).
// ---------------------------------------------------------------------------

const ORIGINAL_HEADLINE = "Ship your next product in days, not months";
const NEW_HEADLINE = "Launch faster with Inline Studio";

async function openEditor(page: Page) {
  await createSaaSProjectAndOpenEditor(page);
}

test.describe("Manual inline editing", () => {
  test("inline edit, save, undo/redo, persist across reload", async ({
    page,
  }) => {
    const audit = attachRuntimeAudit(page);
    await openEditor(page);

    const preview = page.locator('[data-testid="preview-content"]');

    // 3. Click the hero headline — it must be an editable field.
    const headline = preview.getByText(ORIGINAL_HEADLINE, { exact: true });
    await headline.click();
    await expect(page.locator('[data-testid="inline-toolbar"]')).toBeVisible({
      timeout: 10000,
    });

    // The field carries the editable-field binding.
    await expect(headline).toHaveAttribute("data-editable-field", /hero/);

    // 4. Double-click enters inline edit mode.
    await headline.dblclick();
    const overlay = page.locator('[data-testid="inline-edit-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });
    const input = page.locator('[data-testid="inline-edit-input"]');
    await expect(input).toHaveValue(ORIGINAL_HEADLINE);

    // 5. Change the headline.
    await input.fill(NEW_HEADLINE);

    // 6. Save — one atomic update.
    await page.locator('[data-testid="inline-edit-save"]').click();
    await expect(preview.getByText(NEW_HEADLINE, { exact: true })).toBeVisible({
      timeout: 5000,
    });
    await expect(overlay).toHaveCount(0);

    // 7. One Undo restores the old headline.
    await page.locator('[data-testid="undo-button"]').click();
    await expect(
      preview.getByText(ORIGINAL_HEADLINE, { exact: true }),
    ).toBeVisible({ timeout: 5000 });

    // 8. One Redo reapplies the new headline.
    await page.locator('[data-testid="redo-button"]').click();
    await expect(preview.getByText(NEW_HEADLINE, { exact: true })).toBeVisible({
      timeout: 5000,
    });

    // 9. Autosave (debounced) persists; reload keeps the new headline.
    await page.waitForTimeout(4500);
    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page
        .locator('[data-testid="preview-content"]')
        .getByText(NEW_HEADLINE, { exact: true }),
    ).toBeVisible({ timeout: 10000 });

    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("Escape cancels the edit without a history entry", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await openEditor(page);

    const preview = page.locator('[data-testid="preview-content"]');
    const headline = preview.getByText(ORIGINAL_HEADLINE, { exact: true });
    await headline.click();
    await headline.dblclick();
    await expect(page.locator('[data-testid="inline-edit-overlay"]')).toBeVisible();

    await page
      .locator('[data-testid="inline-edit-input"]')
      .fill("Should be discarded");
    await page.keyboard.press("Escape");

    await expect(page.locator('[data-testid="inline-edit-overlay"]')).toHaveCount(0);
    // No history entry was created by the cancelled edit.
    await expect(page.locator('[data-testid="undo-button"]')).toBeDisabled({
      timeout: 3000,
    });
    await expect(
      preview.getByText(ORIGINAL_HEADLINE, { exact: true }),
    ).toBeVisible();

    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
