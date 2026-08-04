import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";

// ---------------------------------------------------------------------------
// Phase N — complete beginner journey E2E (spec §29)
//
// Flow:
//   1. open Buildora as a NEW user (fresh context, no prefs, no projects)
//   2. onboarding appears
//   3. choose Business
//   4. choose "Guide me step by step"
//   5. choose "I'm completely new"
//   6. create project
//   7. guided homepage screen appears
//   8. add main message (blank template already ships a hero — the guided
//      start screen marks it as added and lets us add more)
//   9. follow recommendation to add what-you-offer
//  10. add customer trust section (FAQ — closest supported equivalent)
//  11. add action section (CTA via the block browser)
//  12. add bottom information (footer)
//  13. edit visible text inline
//  14. add another page through a guided action
//  15. preview mobile
//  16. verify readiness score improves
//  17. save/reload — mode and project persist
//  18. no console/page/network errors
//
// All store/insertion/persistence behavior is REAL.
// ---------------------------------------------------------------------------

const EDIT_HEADLINE = "Build it, then launch it";

/** Read the readiness percentage shown in the guided panel. */
async function readScore(page: Page): Promise<number> {
  const text = await page
    .locator('[data-testid="readiness-score"]')
    .textContent();
  const match = text?.match(/(\d+)%/);
  return match ? Number(match[1]) : 0;
}

test.describe("Guided builder — complete beginner journey", () => {
  test("onboarding, guided building, inline edit, page add, mobile, score, persistence", async ({
    page,
  }) => {
    const audit = attachRuntimeAudit(page);

    // 1. New user — empty dashboard.
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { name: "Welcome to Buildora" }),
    ).toBeVisible({ timeout: 10000 });

    // 2. Onboarding appears.
    await page.locator('[data-testid="start-guided-setup"]').click();
    const onboarding = page.getByRole("dialog", { name: /get you building/ });
    await expect(onboarding).toBeVisible({ timeout: 10000 });

    // 3. What are you creating? → Business
    await page.locator('[data-testid="onboarding-next"]').click();
    await expect(
      page.getByRole("heading", { name: "What are you creating?" }),
    ).toBeVisible();
    await page.locator('[data-testid="onboarding-category-business"]').click();
    await page.locator('[data-testid="onboarding-next"]').click();

    // 4. How would you like to begin? → Guide me step by step
    await expect(
      page.getByRole("heading", { name: "How would you like to begin?" }),
    ).toBeVisible();
    await page.locator('[data-testid="onboarding-begin-guided"]').click();
    await page.locator('[data-testid="onboarding-next"]').click();

    // 5. Choose your comfort level → I'm completely new
    await expect(
      page.getByRole("heading", { name: "Choose your comfort level" }),
    ).toBeVisible();
    await page.locator('[data-testid="onboarding-comfort-new"]').click();

    // 6. Create project (final button).
    await page.locator('[data-testid="onboarding-next"]').click();
    await page.waitForURL(/\/editor\/.+/, { timeout: 20000 });
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
      timeout: 15000,
    });

    // Guided mode is active (comfort "new" → guided).
    await expect(page.locator('[data-testid="experience-mode-current"]')).toHaveText(
      "Guided",
    );

    // 7. Guided homepage screen appears (blank template = 1 starter section).
    await expect(page.locator('[data-testid="guided-start-screen"]')).toBeVisible({
      timeout: 10000,
    });

    const structureTab = page.locator('[data-testid="right-tab-structure"]');
    await structureTab.click();
    await expect(page.locator('[data-testid="guided-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="readiness-score"]')).toBeVisible();
    const initialScore = await readScore(page);

    // 8. Add top navigation (main message already ships in the starter hero).
    await page.locator('[data-testid="guided-start-header"]').click();
    await expect(
      page
        .locator('[data-testid="preview-content"]')
        .getByText("Your new project", { exact: true }),
    ).toBeVisible({ timeout: 5000 });

    // 9+10. Follow the coach recommendations: add trust (FAQ — the closest
    //       supported equivalent to customer reviews) BEFORE features, because
    //       once features ship with descriptions the trust recommendation
    //       disappears. Then add what-you-offer (features).
    await structureTab.click();
    await expect(page.locator('[data-testid="coach-panel"]')).toBeVisible();
    await page.locator('[data-testid="coach-run-rec-add-trust"]').click();

    await structureTab.click();
    await page.locator('[data-testid="coach-run-rec-add-features"]').click();

    // 11. Action section (CTA) through the guided block browser.
    await structureTab.click();
    await page.locator('[data-testid="add-section-button"]').click();
    const blocks = page.getByRole("dialog", {
      name: "Add something to your page",
    });
    await expect(blocks).toBeVisible();
    await page.locator('[data-testid="section-card-cta"]').click();
    await page.locator('[data-testid="confirm-add-section"]').click();
    await expect(blocks).toHaveCount(0);

    // 12. Bottom information (footer).
    await structureTab.click();
    await page.locator('[data-testid="coach-run-rec-add-footer"]').click();

    // 13. Edit visible text inline — hero headline.
    const preview = page.locator('[data-testid="preview-content"]');
    const headline = preview.getByText("Your new project", { exact: true });
    await headline.click();
    await expect(page.locator('[data-testid="inline-toolbar"]')).toBeVisible({
      timeout: 5000,
    });
    await headline.dblclick();
    await expect(page.locator('[data-testid="inline-edit-overlay"]')).toBeVisible();
    await page.locator('[data-testid="inline-edit-input"]').fill(EDIT_HEADLINE);
    await page.locator('[data-testid="inline-edit-save"]').click();
    await expect(preview.getByText(EDIT_HEADLINE, { exact: true })).toBeVisible({
      timeout: 5000,
    });

    // 15. Preview mobile through the coach suggestion.
    await structureTab.click();
    await page.locator('[data-testid="coach-run-rec-preview-mobile"]').click();
    // The journey step for mobile preview is now complete.
    await expect(
      page.locator('[data-testid="journey-step-preview-mobile"]'),
    ).toHaveAttribute("aria-label", /done/);

    // 14. Add another page through a guided action.
    await structureTab.click();
    await page.locator('[data-testid="coach-run-rec-add-page"]').click();
    await expect(
      page.locator('[data-testid="page-tab-add"]'),
    ).toBeVisible({ timeout: 5000 });

    // 16. Readiness score improved after building the homepage.
    await structureTab.click();
    const finalScore = await readScore(page);
    // The score reflects the currently selected page. The new (empty) page is
    // now selected, so verify on the homepage again by selecting its tab.
    const homeTab = page.locator('[data-testid^="page-tab-"]').first();
    await homeTab.click();
    await structureTab.click();
    const homeScore = await readScore(page);
    expect(homeScore).toBeGreaterThan(initialScore);
    expect(finalScore).toBeGreaterThanOrEqual(0);

    // 17. Save/reload — mode + project persist.
    await page.waitForTimeout(4500);
    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.locator('[data-testid="experience-mode-current"]'),
    ).toHaveText("Guided", { timeout: 10000 });
    await expect(
      page
        .locator('[data-testid="preview-content"]')
        .getByText(EDIT_HEADLINE, { exact: true }),
    ).toBeVisible({ timeout: 10000 });

    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("onboarding can be skipped and never creates a project", async ({
    page,
  }) => {
    const audit = attachRuntimeAudit(page);

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Welcome to Buildora" }),
    ).toBeVisible({ timeout: 10000 });

    await page.locator('[data-testid="start-guided-setup"]').click();
    await expect(
      page.getByRole("dialog", { name: /get you building/ }),
    ).toBeVisible();

    // Skip from the welcome step.
    await page.locator('[data-testid="onboarding-skip"]').click();
    await expect(
      page.getByRole("dialog", { name: /get you building/ }),
    ).toHaveCount(0);

    // Still on the dashboard — no project was created.
    await expect(
      page.getByRole("heading", { name: "Welcome to Buildora" }),
    ).toBeVisible();

    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
