import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Phase M — inline AI suggestion E2E (spec §32)
//
// Flow:
//   1. create SaaS project
//   2. select Hero headline
//   3. click "Shorter"
//   4. deterministic inline provider interception
//   5. verify original + suggestion preview
//   6. reject → no change
//   7. request again
//   8. accept → one field changed
//   9. undo once restores old value
//  10. redo reapplies
//  11. save/reload → persists
//  12. stale suggestion scenario
//   no console/page/network errors
//
// The route interception only replaces the SERVER suggestion. Suggestion
// storage, stale policy, one-field application, undo/redo, and persistence
// all run through the REAL store.
// ---------------------------------------------------------------------------

const ORIGINAL_HEADLINE = "Ship your next product in days, not months";
const SUGGESTED_HEADLINE = "Ship your product faster";

interface InlineEditRequestBody {
  mode?: string;
  instruction?: string;
  projectId?: string;
  baseRevision?: number;
  pageId?: string;
  sectionId?: string;
  fieldPath?: (string | number)[];
  fieldKind?: string;
  currentValue?: string;
  sectionType?: string;
}

async function mockInlineApi(page: Page) {
  await page.route("**/api/generate", async (route) => {
    const body = JSON.parse(
      route.request().postData() ?? "{}",
    ) as InlineEditRequestBody;
    if (body.mode !== "inline-edit") {
      await route.continue();
      return;
    }
    // Echo the live project/revision so the REAL stale policy on accept
    // passes for the fresh suggestion (and only trips after a real change).
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        source: "rule-based",
        suggestion: {
          id: "sug-e2e",
          projectId: body.projectId ?? "test-proj",
          baseRevision: body.baseRevision ?? 0,
          pageId: body.pageId ?? "page-1",
          sectionId: body.sectionId ?? "hero-1",
          sectionType: body.sectionType ?? "hero",
          fieldPath: body.fieldPath ?? ["headline"],
          originalValue: body.currentValue,
          suggestedValue: SUGGESTED_HEADLINE,
          instruction: body.instruction,
          provider: "rule-based",
          createdAt: new Date().toISOString(),
        },
        warnings: [],
      }),
    });
  });
}

async function selectHeroHeadline(page: Page) {
  const preview = page.locator('[data-testid="preview-content"]');
  const headline = preview.getByText(ORIGINAL_HEADLINE, { exact: true });
  await headline.click();
  await expect(page.locator('[data-testid="inline-toolbar"]')).toBeVisible({
    timeout: 10000,
  });
  return headline;
}

async function openEditor(page: Page) {
  await createSaaSProjectAndOpenEditor(page);
}

test.describe("Inline AI suggestions", () => {
  test("suggest → reject → accept → undo/redo → persist", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await openEditor(page);
    await mockInlineApi(page);

    const preview = page.locator('[data-testid="preview-content"]');
    await selectHeroHeadline(page);

    // 3. Click "Shorter" in the toolbar.
    await page.locator('[data-testid="inline-toolbar-shorter"]').click();

    // 5. The popover shows original + suggested text.
    const popover = page.locator('[data-testid="inline-ai-popover"]');
    await expect(popover).toBeVisible({ timeout: 10000 });
    await expect(popover.locator('[data-testid="inline-ai-original"]')).toContainText(
      ORIGINAL_HEADLINE,
    );
    await expect(
      popover.locator('[data-testid="inline-ai-suggested"]'),
    ).toContainText(SUGGESTED_HEADLINE);
    await expect(popover.locator('[data-testid="inline-ai-provider-badge"]')).toContainText(
      "Local fallback",
    );

    // 6. Reject → no change.
    await popover.locator('[data-testid="inline-ai-reject"]').click();
    await expect(popover).toHaveCount(0);
    await expect(
      preview.getByText(ORIGINAL_HEADLINE, { exact: true }),
    ).toBeVisible();
    // No history entry from rejection.
    await expect(page.locator('[data-testid="undo-button"]')).toBeDisabled({
      timeout: 3000,
    });

    // 7. Request again, then 8. accept.
    await page.locator('[data-testid="inline-toolbar-shorter"]').click();
    await expect(popover).toBeVisible({ timeout: 10000 });
    await popover.locator('[data-testid="inline-ai-accept"]').click();

    // 9. Exactly the selected field changed.
    await expect(
      preview.getByText(SUGGESTED_HEADLINE, { exact: true }),
    ).toBeVisible({ timeout: 5000 });

    // 10. Undo once restores the old value.
    await page.locator('[data-testid="undo-button"]').click();
    await expect(
      preview.getByText(ORIGINAL_HEADLINE, { exact: true }),
    ).toBeVisible({ timeout: 5000 });

    // 11. Redo reapplies.
    await page.locator('[data-testid="redo-button"]').click();
    await expect(
      preview.getByText(SUGGESTED_HEADLINE, { exact: true }),
    ).toBeVisible({ timeout: 5000 });

    // 12. Autosave persists; reload keeps the value.
    await page.waitForTimeout(4500);
    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page
        .locator('[data-testid="preview-content"]')
        .getByText(SUGGESTED_HEADLINE, { exact: true }),
    ).toBeVisible({ timeout: 10000 });

    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("stale suggestion cannot be applied after the field changes", async ({
    page,
  }) => {
    const audit = attachRuntimeAudit(page);
    await openEditor(page);
    await mockInlineApi(page);

    const preview = page.locator('[data-testid="preview-content"]');
    await selectHeroHeadline(page);

    // Create a suggestion.
    await page.locator('[data-testid="inline-toolbar-shorter"]').click();
    const popover = page.locator('[data-testid="inline-ai-popover"]');
    await expect(popover).toBeVisible({ timeout: 10000 });

    // Change the SAME field through the inspector → the project changes
    // (revision + value) while the suggestion popover stays open.
    await page.locator('[data-testid="right-tab-design"]').click();
    const inspector = page.locator('[data-testid="inspector-panel"]');
    await expect(inspector).toBeVisible({ timeout: 5000 });
    await inspector.locator("textarea").first().fill("Inspector edited headline");
    await inspector.locator("textarea").first().blur();
    await expect(
      preview.getByText("Inspector edited headline", { exact: true }),
    ).toBeVisible({ timeout: 5000 });

    // Accepting the now-stale suggestion must be blocked.
    await popover.locator('[data-testid="inline-ai-accept"]').click();
    await expect(popover.locator('[data-testid="inline-ai-stale"]')).toBeVisible({
      timeout: 5000,
    });

    // Discard clears the popover.
    await popover.locator('[data-testid="inline-ai-stale-discard"]').click();
    await expect(popover).toHaveCount(0);
    await expect(
      preview.getByText("Inspector edited headline", { exact: true }),
    ).toBeVisible();

    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
