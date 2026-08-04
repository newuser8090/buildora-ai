import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Phase O — LEGO builder engine: Build Tree panel (e2e/block-tree.spec.ts)
//
// The Blocks tab projects every section into a Container root row. Expanding a
// root reveals bound child blocks (safe editable fields). Bound text edits
// fold back into the section model (one history entry); structural insert /
// delete / duplicate of unbound blocks is a clearly-labelled session preview
// until free-form persistence lands (Phase P).
// ---------------------------------------------------------------------------

async function openBlocksTab(page: Page): Promise<void> {
  await page.locator('[data-testid="right-tab-blocks"]').click();
  await expect(page.locator('[data-testid="blocks-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="build-tree-panel"]')).toBeVisible();
}

function rootRows(page: Page) {
  return page.locator(
    '[data-testid="block-tree"] [data-testid^="block-row-"][data-block-type="container"]',
  );
}

function rowByText(page: Page, text: string) {
  return page
    .locator('[data-testid="block-tree"] [data-testid^="block-row-"]')
    .filter({ hasText: text })
    .first();
}

async function expandSection(page: Page, guidedLabel: string): Promise<void> {
  await rowByText(page, guidedLabel).locator("button").first().click();
}

test.describe("Block tree (Phase O)", () => {
  test.beforeEach(async ({ page }) => {
    await createSaaSProjectAndOpenEditor(page);
    await openBlocksTab(page);
  });

  test("shows one root row per section", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    // SaaS template = header, hero, features, pricing, faq, cta, footer.
    await expect(rootRows(page)).toHaveCount(7, { timeout: 5000 });
    await expect(rowByText(page, "Main message")).toBeVisible();
    await expect(rowByText(page, "Plans and pricing")).toBeVisible();
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("expanding a section reveals its bound child blocks", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await expandSection(page, "Main message");
    await expect(rowByText(page, "Main headline")).toBeVisible();
    await expect(rowByText(page, "Subheadline")).toBeVisible();
    await expect(rowByText(page, "Primary button")).toBeVisible();
    // Bound children carry the data-bound marker.
    const headlineRow = rowByText(page, "Main headline");
    await expect(headlineRow).toHaveAttribute("data-bound", "true");
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("selecting a bound block opens the inspector with its saved value", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await expandSection(page, "Main message");
    await rowByText(page, "Main headline").click();
    const field = page.locator('[data-testid="block-inspector-text"]');
    await expect(field).toBeVisible();
    await expect(field).toHaveValue("Ship your next product in days, not months");
    await expect(page.locator('[data-testid="block-bound-badge"]')).toBeVisible();
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("editing a bound field saves through the section model and updates the preview", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await expandSection(page, "Main message");
    await rowByText(page, "Main headline").click();
    const field = page.locator('[data-testid="block-inspector-text"]');
    await field.fill("Edited headline from the block tree");
    await page.locator('[data-testid="block-inspector-save"]').click();
    await expect(page.locator('[data-testid="preview-content"]')).toContainText(
      "Edited headline from the block tree",
      { timeout: 5000 },
    );
    // Persisted via the section model — no session preview note for this op.
    await expect(page.locator('[data-testid="session-preview-note"]')).toHaveCount(0);
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("structural insert is a clearly-labelled session preview", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await page.locator('[data-testid="open-block-browser"]').click();
    await expect(page.locator('[data-testid="block-browser-dialog"]')).toBeVisible();
    // Badge is not bound by the hero section → session preview only.
    await page.locator('[data-testid="block-add-badge"]').click();
    await expect(page.locator('[data-testid="block-browser-dialog"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="session-preview-note"]')).toBeVisible();
    await expect(page.locator('[data-testid="session-preview-badge"]').first()).toBeVisible();
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("deleting a bound array item persists through the section props", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await expandSection(page, "What you offer");
    const firstFeatureRow = rowByText(page, "Feature 1 — title");
    await expect(firstFeatureRow).toBeVisible();
    await firstFeatureRow.locator('[data-testid^="block-del-"]').click();
    // The first feature ("Lightning deployment") is removed from the preview.
    await expect(page.locator('[data-testid="preview-content"]')).not.toContainText(
      "Lightning deployment",
      { timeout: 5000 },
    );
    // Group delete is a persisted props change — no session preview note.
    await expect(page.locator('[data-testid="session-preview-note"]')).toHaveCount(0);
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("duplicating a bound array item persists a second copy", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await expandSection(page, "What you offer");
    const firstFeatureRow = rowByText(page, "Feature 1 — title");
    await expect(firstFeatureRow).toBeVisible();
    await firstFeatureRow.locator('[data-testid^="block-dup-"]').click();
    await expect(
      page.locator('[data-testid="preview-content"]').getByText("Lightning deployment"),
    ).toHaveCount(2, { timeout: 5000 });
    await expect(page.locator('[data-testid="session-preview-note"]')).toHaveCount(0);
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
