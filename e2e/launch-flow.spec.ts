import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";

// ---------------------------------------------------------------------------
// Phase P7 — E2E: complete beginner launch flow
//
// Beginner path from guided creation → site settings → content → Launch
// Center → fixes → visitor preview → publish (mock) → demo result →
// re-edit → "changes unpublished" → publish updates. Everything is REAL
// (real store, real IndexedDB, real export); only the publish provider is
// the in-process mock, which is labeled "Demo site" and never claims a
// public URL.
//
// Flow:
//   1. create project in guided/beginner context
//   2. edit site name/settings
//   3. edit meaningful content (+ add a page for navigation)
//   4. open Launch Center
//   5. verify readiness findings
//   6. fix at least one meaningful issue via a fix action
//   7. open Visitor Preview
//   8. verify editor chrome is absent
//   9. test navigation
//  10. switch Phone/Desktop
//  11. exit preview
//  12. publish through Mock provider
//  13. verify success
//  14. open demo result
//  15. edit project again
//  16. verify "Changes unpublished"
//  17. publish updates
//  18. no console/page/network errors
// ---------------------------------------------------------------------------

const SITE_NAME = "Harbor Coffee Co.";
const EDIT_HEADLINE = "Fresh coffee, delivered";
const EDIT_HEADLINE_V2 = "Fresh coffee, delivered daily";

/** Run the guided onboarding (Business → step-by-step → completely new). */
async function createGuidedProject(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByRole("heading", { name: "Welcome to Buildora" }),
  ).toBeVisible({ timeout: 10000 });

  await page.locator('[data-testid="start-guided-setup"]').click();
  const onboarding = page.getByRole("dialog", { name: /get you building/ });
  await expect(onboarding).toBeVisible({ timeout: 10000 });

  await page.locator('[data-testid="onboarding-next"]').click();
  await expect(
    page.getByRole("heading", { name: "What are you creating?" }),
  ).toBeVisible();
  await page.locator('[data-testid="onboarding-category-business"]').click();
  await page.locator('[data-testid="onboarding-next"]').click();

  await expect(
    page.getByRole("heading", { name: "How would you like to begin?" }),
  ).toBeVisible();
  await page.locator('[data-testid="onboarding-begin-guided"]').click();
  await page.locator('[data-testid="onboarding-next"]').click();

  await expect(
    page.getByRole("heading", { name: "Choose your comfort level" }),
  ).toBeVisible();
  await page.locator('[data-testid="onboarding-comfort-new"]').click();
  await page.locator('[data-testid="onboarding-next"]').click();

  await page.waitForURL(/\/editor\/.+/, { timeout: 90000 });
  await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
    timeout: 90000,
  });
}

/** Edit site name + description through Site settings. */
async function setSiteBasics(page: Page): Promise<void> {
  await page.locator('[data-testid="topnav-site-settings-button"]').click();
  await expect(
    page.getByRole("dialog", { name: "Site settings" }),
  ).toBeVisible({ timeout: 10000 });
  await page.locator('[data-testid="site-settings-name"]').fill(SITE_NAME);
  await page
    .locator('[data-testid="site-settings-description"]')
    .fill("Small-batch coffee roasted locally and delivered fast.");
  await page.locator('[data-testid="site-settings-save"]').click();
  await expect(
    page.getByRole("dialog", { name: "Site settings" }),
  ).not.toBeVisible({ timeout: 5000 });
}

/** Add a second page named About (for preview navigation). */
async function addAboutPage(page: Page): Promise<void> {
  await page.locator('[data-testid="page-tab-add"]').click();
  const rename = page.locator('[data-testid="page-rename-input"]');
  await expect(rename).toBeVisible();
  await rename.fill("About");
  await rename.press("Enter");
  await expect(rename).not.toBeVisible({ timeout: 5000 });
  // Back to the Home tab so the inline edit below targets the homepage hero.
  await page.locator('[data-testid^="page-tab-"]').first().click();
}

/** Inline-edit the hero headline from its current text to the new text. */
async function editHeadline(
  page: Page,
  fromText: string,
  toText: string,
): Promise<void> {
  const preview = page.locator('[data-testid="preview-content"]');
  const headline = preview.getByText(fromText, { exact: true });
  await headline.click();
  await expect(page.locator('[data-testid="inline-toolbar"]')).toBeVisible({
    timeout: 5000,
  });
  await headline.dblclick();
  await expect(page.locator('[data-testid="inline-edit-overlay"]')).toBeVisible();
  await page.locator('[data-testid="inline-edit-input"]').fill(toText);
  await page.locator('[data-testid="inline-edit-save"]').click();
  await expect(preview.getByText(toText, { exact: true })).toBeVisible({
    timeout: 5000,
  });
}

/** Open the Launch Center from the TopNav Publish button. */
async function openLaunchCenter(page: Page): Promise<void> {
  await page.locator('[data-testid="topnav-publish-button"]').click();
  await expect(page.locator('[data-testid="launch-score"]')).toBeVisible({
    timeout: 10000,
  });
}

/** Publish via the mock provider and await the success screen. */
async function publishViaMock(page: Page): Promise<void> {
  await openLaunchCenter(page);
  await page.locator('[data-testid="launch-publish"]').click();
  await expect(
    page.getByRole("dialog", { name: "Publish your site" }),
  ).toBeVisible({ timeout: 10000 });
  // Mock is the default provider in dev; make sure it is selected.
  await expect(page.locator('[data-testid="provider-mock"]')).toBeChecked();
  await page.locator('[data-testid="publish-confirm"]').click();
  await expect(page.locator('[data-testid="publish-success"]')).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator('[data-testid="publish-success"]')).toContainText(
    "Demo site is ready.",
  );
}

/** Close the publish dialog via its header close button. */
async function closePublishDialog(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Close publish dialog" })
    .click();
  await expect(page.getByRole("dialog", { name: /Publish/ })).toHaveCount(0, {
    timeout: 5000,
  });
}

test.describe("Phase P7 — beginner launch flow", () => {
  test("guided create → settings → content → readiness → preview → publish → updates", async ({
    page,
  }) => {
    test.setTimeout(420_000);
    const audit = attachRuntimeAudit(page);

    // 1. Create the project in a guided/beginner context.
    await createGuidedProject(page);
    await expect(
      page.locator('[data-testid="experience-mode-current"]'),
    ).toHaveText("Guided");

    // 2. Edit site name/settings.
    await setSiteBasics(page);

    // 3. Edit meaningful content + add a page so preview navigation is real.
    await addAboutPage(page);
    await editHeadline(page, "Your new project", EDIT_HEADLINE);

    // 4. Open Launch Center.
    await openLaunchCenter(page);

    // 5. Verify readiness findings (deterministic warnings on a fresh site).
    const findings = page.locator('[data-testid="launch-finding"]');
    expect(await findings.count()).toBeGreaterThan(0);
    const scoreText = await page
      .locator('[data-testid="launch-score"]')
      .textContent();
    expect(Number(scoreText?.match(/\d+/)?.[0])).toBeGreaterThanOrEqual(0);

    // 6. Fix at least one meaningful issue via its one-click fix action.
    const seoFinding = findings.filter({ hasText: "Set a search title" });
    await expect(seoFinding).toBeVisible();
    await seoFinding.locator('[data-testid="launch-fix-action"]').click();
    await expect(
      page.getByRole("dialog", { name: "Site settings" }),
    ).toBeVisible({ timeout: 10000 });
    await page
      .locator('[data-testid="site-settings-seo-title"]')
      .fill("Harbor Coffee — fresh beans delivered");
    await page
      .locator('[data-testid="site-settings-seo-description"]')
      .fill("Order small-batch coffee online and get it roasted fresh.");
    await page.locator('[data-testid="site-settings-save"]').click();
    await expect(
      page.getByRole("dialog", { name: "Site settings" }),
    ).not.toBeVisible({ timeout: 5000 });

    // 7. Open the Visitor Preview from the Launch Center.
    await openLaunchCenter(page);
    await page.locator('[data-testid="launch-preview"]').click();
    await expect(page.locator('[data-testid="preview-shell"]')).toBeVisible({
      timeout: 10000,
    });

    // 8. Verify editor chrome is absent in the preview.
    const shell = page.locator('[data-testid="preview-shell"]');
    await expect(shell.locator('[data-testid="visitor-preview-content"]')).toBeVisible();
    await expect(shell.locator('[data-testid="inline-toolbar"]')).toHaveCount(0);
    await expect(shell.locator('[data-testid="selected-section"]')).toHaveCount(0);
    await expect(shell.locator('[data-testid="inspector-panel"]')).toHaveCount(0);
    await expect(shell.locator('[data-testid="section-wrapper"]')).toHaveCount(0);
    // The edited hero content renders in the visitor preview.
    await expect(
      shell
        .locator('[data-testid="visitor-preview-content"]')
        .getByText(EDIT_HEADLINE, { exact: true }),
    ).toBeVisible({ timeout: 5000 });

    // 9. Test internal navigation through the preview page switcher.
    await page.locator('[data-testid="preview-page-switcher"]').selectOption("/about");
    await expect(page.locator('[data-testid="preview-route"]')).toHaveText("/about");
    await page.locator('[data-testid="preview-page-switcher"]').selectOption("/");
    await expect(page.locator('[data-testid="preview-route"]')).toHaveText("/");

    // 10. Switch Phone / Desktop. Scope to the preview toolbar — the editor
    // viewport toggles carry similar title attributes.
    const deviceButton = (label: string) =>
      page.locator('[data-testid="preview-shell"]').getByTitle(label);
    await deviceButton("Phone").click();
    await expect(deviceButton("Phone")).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator('[data-testid="preview-shell"] div[style*="390px"]'),
    ).toHaveCount(1);
    await deviceButton("Desktop").click();
    await expect(deviceButton("Desktop")).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator('[data-testid="preview-shell"] div[style*="1280px"]'),
    ).toHaveCount(1);

    // 11. Exit the preview — back in the editor.
    await page.locator('[data-testid="preview-exit"]').click();
    await expect(page.locator('[data-testid="preview-shell"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="preview-content"]')).toBeVisible();

    // Flush the project to IndexedDB BEFORE publishing — the standalone
    // preview route reads the project from disk, not the editor store.
    const saveBtn = page.locator('header button[title*="Save"]');
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();
    await expect(saveBtn).toHaveAttribute("title", "Saved", { timeout: 5000 });

    // 12. Publish through the Mock provider.
    await publishViaMock(page);

    // 13. Verify success (already asserted inside publishViaMock).
    await expect(page.locator('[data-testid="publish-success"]')).toBeVisible();

    // 14. Open the demo result in a new tab from the success view.
    const projectId = page.url().match(/\/editor\/([^/?]+)/)?.[1] ?? "";
    expect(projectId).not.toBe("");
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.locator('[data-testid="publish-open-site"]').click(),
    ]);
    const popupAudit = attachRuntimeAudit(popup);
    await popup.waitForLoadState("domcontentloaded");
    await expect(popup).toHaveURL(new RegExp(`/preview/${projectId}$`), {
      timeout: 30000,
    });
    // The standalone route renders the site with no editor chrome.
    await expect(
      popup.locator('[data-testid="visitor-preview-content"]'),
    ).toBeVisible({ timeout: 60000 });
    await expect(
      popup.locator('[data-testid="visitor-preview-content"]').getByText(EDIT_HEADLINE),
    ).toBeVisible({ timeout: 10000 });
    await expect(popup.locator('[data-testid="inline-toolbar"]')).toHaveCount(0);
    await popup.close();
    assertRuntimeClean(popupAudit.state);
    popupAudit.detach();

    // 15. Edit the project again. The dev server may have reloaded the page
    // during the popup phase; if the publish dialog is still open, close it.
    if (await page.locator('[data-testid="publish-success"]').isVisible().catch(() => false)) {
      await closePublishDialog(page);
    }
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
      timeout: 15000,
    });
    // If the dev server reloaded the page, the editor now holds the saved
    // headline (the published version) — the edit is relative to that.
    await editHeadline(page, EDIT_HEADLINE, EDIT_HEADLINE_V2);

    // 16. Verify "Changes unpublished".
    await openLaunchCenter(page);
    await expect(
      page.getByText("You've made changes since the last publish."),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator('[data-testid="launch-publish"]'),
    ).toContainText("Publish updates");

    // 17. Publish updates.
    await page.locator('[data-testid="launch-publish"]').click();
    await page.locator('[data-testid="publish-confirm"]').click();
    await expect(page.locator('[data-testid="publish-success"]')).toBeVisible({
      timeout: 30000,
    });

    // 18. No console / page / network errors.
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
