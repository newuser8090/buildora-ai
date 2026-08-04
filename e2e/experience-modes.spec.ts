import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Phase N — experience modes E2E (spec §30)
//
// Flow:
//   1. open an existing project as a RETURNING user (stored standard prefs)
//   2. Standard mode is not interrupted; the "Try Guided Mode" banner shows
//   3. switch to Guided → friendly labels + guided panel appear
//   4. switch to Advanced → detailed controls restored
//   5. project content unchanged, history unchanged, save status unchanged
//   6. preference persists after reload
//
// The returning-user pref is injected through addInitScript (localStorage is
// the ONLY persistence for the mode — never part of the project).
// ---------------------------------------------------------------------------

const RETURNING_USER_PREFS = {
  experienceMode: "standard",
  onboardingCompleted: true,
  onboardingSelections: {
    category: "business",
    begin: "template",
    comfort: "experienced",
  },
  coachEnabled: true,
  dismissedTipIds: [],
  journeyCollapsed: false,
  tryGuidedBannerDismissed: false,
};

const ORIGINAL_HEADLINE = "Ship your next product in days, not months";

async function openEditorAsReturningUser(page: Page) {
  // Seed the returning-user prefs ONLY when none exist yet — the reload check
  // later must observe the mode the user actually switched to (localStorage is
  // the ONLY persistence for the mode), not have it re-seeded every load.
  await page.addInitScript((prefs) => {
    const key = "buildora:guided:prefs";
    if (window.localStorage.getItem(key) === null) {
      window.localStorage.setItem(key, JSON.stringify(prefs));
    }
  }, RETURNING_USER_PREFS);
  await createSaaSProjectAndOpenEditor(page);
}

test.describe("Experience modes", () => {
  test("standard default, banner, guided labels, advanced controls, persistence", async ({
    page,
  }) => {
    const audit = attachRuntimeAudit(page);
    await openEditorAsReturningUser(page);

    // 1. Standard mode is the active experience.
    await expect(page.locator('[data-testid="experience-mode-current"]')).toHaveText(
      "Standard",
    );
    await expect(page.locator('[data-testid="guided-panel"]')).toHaveCount(0);

    // 2. Returning users see the dismissible "Try Guided Mode" banner.
    await expect(page.locator('[data-testid="try-guided-banner"]')).toBeVisible({
      timeout: 10000,
    });

    // 3. Switch to Guided — friendly labels + guided panel appear. The guided
    //    panel (readiness/journey/coach) lives at the top of the Structure tab.
    await page.locator('[data-testid="experience-mode-switcher"]').click();
    await page.locator('[data-testid="experience-mode-guided"]').click();
    await expect(page.locator('[data-testid="experience-mode-current"]')).toHaveText(
      "Guided",
    );
    await page.locator('[data-testid="right-tab-structure"]').click();
    await expect(page.locator('[data-testid="guided-panel"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('[data-testid="readiness-score"]')).toBeVisible();
    await expect(page.locator('[data-testid="journey-checklist"]')).toBeVisible();
    // The banner disappears once guided mode is active.
    await expect(page.locator('[data-testid="try-guided-banner"]')).toHaveCount(0);

    // Guided block browser uses plain language.
    await page.locator('[data-testid="right-tab-structure"]').click();
    await page.locator('[data-testid="add-section-button"]').click();
    await expect(
      page.getByRole("dialog", { name: "Add something to your page" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Build trust", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Add something to your page" }),
    ).toHaveCount(0);

    // 4. Switch to Advanced — detailed controls restored.
    await page.locator('[data-testid="experience-mode-switcher"]').click();
    await page.locator('[data-testid="experience-mode-advanced"]').click();
    await expect(page.locator('[data-testid="experience-mode-current"]')).toHaveText(
      "Advanced",
    );
    // We are still on the Structure tab; the guided panel disappears.
    await expect(page.locator('[data-testid="guided-panel"]')).toHaveCount(0);
    await page.locator('[data-testid="add-section-button"]').click();
    await expect(page.getByRole("dialog", { name: "Add Section" })).toBeVisible();
    await page.keyboard.press("Escape");

    // 5. Project content, history, and save status are untouched by mode
    //    changes (modes are a pure UI preference).
    await expect(
      page
        .locator('[data-testid="preview-content"]')
        .getByText(ORIGINAL_HEADLINE, { exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-testid="undo-button"]')).toBeDisabled({
      timeout: 3000,
    });

    // 6. Preference persists across reload.
    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('[data-testid="experience-mode-current"]')).toHaveText(
      "Advanced",
      { timeout: 10000 },
    );
    await expect(
      page
        .locator('[data-testid="preview-content"]')
        .getByText(ORIGINAL_HEADLINE, { exact: true }),
    ).toBeVisible();

    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
