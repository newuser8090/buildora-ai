import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import JSZip from "jszip";
import type { Page } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createBlankProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Phase P7 — E2E: launch readiness engine
//
// Deterministic readiness flow on an incomplete site:
//   1. create an incomplete site (blank template)
//   2. verify the deterministic warning set
//   3. configure site metadata (name, description, search, social)
//   4. configure page metadata
//   5. create + fix a broken internal link/action
//   6. add a favicon (programmatic file input — stable, no native picker)
//   7. verify readiness score/status improves
//   8. export the site and verify generated metadata in the ZIP
//   9. no console/page/network errors
// ---------------------------------------------------------------------------

const SITE_NAME = "Golden Harvest Bakery";
const SEO_TITLE = "Golden Harvest Bakery — fresh sourdough";
const SEO_DESCRIPTION = "Order hand-made sourdough and pastries online.";
const PAGE_TITLE = "Golden Harvest Bakery | Home";
const PAGE_DESCRIPTION = "Fresh bread baked daily in our neighborhood bakery.";

// 1×1 transparent PNG (valid image/png — passes the favicon validator and
// the shared image processor).
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** Read the numeric readiness score shown in the Launch Center. */
async function readLaunchScore(page: Page): Promise<number> {
  const text = await page.locator('[data-testid="launch-score"]').textContent();
  const match = text?.match(/\d+/);
  expect(match, "launch score should be a number").toBeTruthy();
  return Number(match![0]);
}

async function openLaunchCenter(page: Page): Promise<void> {
  await page.locator('[data-testid="topnav-publish-button"]').click();
  await expect(page.locator('[data-testid="launch-score"]')).toBeVisible({
    timeout: 10000,
  });
}

async function closeLaunchCenter(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Close launch center" })
    .click();
  await expect(page.locator('[data-testid="launch-score"]')).toHaveCount(0, {
    timeout: 5000,
  });
}

/** Finding card by title text. */
function finding(page: Page, title: string) {
  return page
    .locator('[data-testid="launch-finding"]')
    .filter({ hasText: title });
}

/** Fill site basics + search & sharing metadata, then save. */
async function configureSiteMetadata(page: Page): Promise<void> {
  await page.locator('[data-testid="topnav-site-settings-button"]').click();
  await expect(
    page.getByRole("dialog", { name: "Site settings" }),
  ).toBeVisible({ timeout: 10000 });

  // Basics tab (default).
  await page.locator('[data-testid="site-settings-name"]').fill(SITE_NAME);
  await page
    .locator('[data-testid="site-settings-description"]')
    .fill("A neighborhood bakery delivering fresh bread daily.");

  // Search & sharing tab.
  await page.getByRole("tab", { name: "Search & sharing" }).click();
  await page.locator('[data-testid="site-settings-seo-title"]').fill(SEO_TITLE);
  await page
    .locator('[data-testid="site-settings-seo-description"]')
    .fill(SEO_DESCRIPTION);
  await page
    .locator('[data-testid="site-settings-social-title"]')
    .fill("Golden Harvest Bakery");
  await page
    .locator('[data-testid="site-settings-social-description"]')
    .fill("Fresh bread and pastries, baked every morning.");

  await page.locator('[data-testid="site-settings-save"]').click();
  await expect(
    page.getByRole("dialog", { name: "Site settings" }),
  ).not.toBeVisible({ timeout: 5000 });
}

/** Configure the Home page's Google title/description via Page settings. */
async function configurePageMetadata(page: Page): Promise<void> {
  // First page tab is Home — grab its id from the data-testid.
  const homeTab = page
    .locator('[data-testid^="page-tab-"]')
    .filter({ has: page.locator('[role="tab"]') })
    .first();
  const tabId = (await homeTab.getAttribute("data-testid"))?.replace(
    "page-tab-",
    "",
  );
  expect(tabId).toBeTruthy();

  await page.locator(`[data-testid="page-menu-${tabId}"]`).click();
  await page.locator('[data-testid="page-action-edit-meta"]').click();
  const metaDialog = page.getByRole("dialog", { name: "Page settings" });
  await expect(metaDialog).toBeVisible({ timeout: 10000 });
  await page.locator('[data-testid="page-meta-title"]').fill(PAGE_TITLE);
  await page.locator('[data-testid="page-meta-description"]').fill(PAGE_DESCRIPTION);
  await page.locator('[data-testid="page-meta-save"]').click();
  await expect(metaDialog).not.toBeVisible({ timeout: 5000 });
}

/** Set the hero primary-CTA href via the section inspector. */
async function setHeroCtaHref(page: Page, href: string): Promise<void> {
  // Blank template ships exactly one hero section. The wrapper is
  // "section-wrapper" when unselected and "selected-section" once selected.
  const section = page
    .locator('[data-testid="section-wrapper"], [data-testid="selected-section"]')
    .first();
  await section.click();
  const inspector = page.locator('[data-testid="inspector-panel"]');
  await expect(inspector).toBeVisible({ timeout: 5000 });
  // Hero inspector input order: [0]=primary label, [1]=primary href,
  // [2]=secondary label, [3]=secondary href.
  const hrefInput = inspector.locator("input").nth(1);
  await hrefInput.fill(href);
  await hrefInput.blur();
}

/** Upload a favicon through the Site icon tab (programmatic file input). */
async function addFavicon(page: Page): Promise<void> {
  await page.locator('[data-testid="topnav-site-settings-button"]').click();
  await expect(
    page.getByRole("dialog", { name: "Site settings" }),
  ).toBeVisible({ timeout: 10000 });
  await page.getByRole("tab", { name: "Site icon" }).click();
  await page.locator('[data-testid="site-icon-file"]').setInputFiles({
    name: "icon.png",
    mimeType: "image/png",
    buffer: TINY_PNG,
  });
  // The upload processes async; the picker shows the selected asset once the
  // favicon draft is set.
  await expect(page.getByText("Remove")).toBeVisible({ timeout: 10000 });
  await page.locator('[data-testid="site-settings-save"]').click();
  await expect(
    page.getByRole("dialog", { name: "Site settings" }),
  ).not.toBeVisible({ timeout: 5000 });
}

test.describe("Phase P7 — launch readiness", () => {
  test("deterministic warnings → fixes → score improves → exported metadata", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const audit = attachRuntimeAudit(page);

    // 1. Create an incomplete site (blank template, no metadata).
    await createBlankProjectAndOpenEditor(page);

    // 2. Verify the deterministic warning set.
    await openLaunchCenter(page);
    const initialScore = await readLaunchScore(page);
    for (const title of [
      "Add a short description",
      "Set a search title",
      "Set a search description",
      "Add a site icon",
      "One button doesn't do anything yet",
    ]) {
      await expect(finding(page, title)).toBeVisible({ timeout: 5000 });
    }
    await closeLaunchCenter(page);

    // 3. Configure site metadata.
    await configureSiteMetadata(page);

    // 4. Configure page metadata.
    await configurePageMetadata(page);

    // 5. Create a broken internal link, verify the finding, then fix it.
    await setHeroCtaHref(page, "/broken-page");
    await openLaunchCenter(page);
    await expect(finding(page, "Fix a link that goes nowhere")).toBeVisible({
      timeout: 5000,
    });
    await closeLaunchCenter(page);

    // Fix: point the CTA at a real page route. This also resolves the
    // "One button doesn't do anything yet" warning.
    await setHeroCtaHref(page, "/");
    await openLaunchCenter(page);
    await expect(
      finding(page, "Fix a link that goes nowhere"),
    ).toHaveCount(0);
    await expect(
      finding(page, "One button doesn't do anything yet"),
    ).toHaveCount(0);
    await closeLaunchCenter(page);

    // 6. Add a favicon.
    await addFavicon(page);

    // 7. Verify readiness improves and the configured warnings are gone.
    await openLaunchCenter(page);
    const finalScore = await readLaunchScore(page);
    expect(finalScore).toBeGreaterThan(initialScore);
    await expect(finding(page, "Add a short description")).toHaveCount(0);
    await expect(finding(page, "Set a search title")).toHaveCount(0);
    await expect(finding(page, "Set a search description")).toHaveCount(0);
    await expect(finding(page, "Add a site icon")).toHaveCount(0);
    await closeLaunchCenter(page);

    // 8. Export the site and verify the generated metadata where practical.
    const downloadPromise = page.waitForEvent("download");
    await page.locator('[data-testid="export-site-button"]').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    const zip = await JSZip.loadAsync(readFileSync(downloadPath!));
    const paths = Object.keys(zip.files);
    // Files are stored under the sanitised project-name folder, e.g.
    // "untitled-project/app/layout.tsx".
    const layoutPath = paths.find((p) => p.endsWith("/app/layout.tsx"));
    const homePath = paths.find((p) => p.endsWith("/app/page.tsx"));
    expect(layoutPath).toBeTruthy();
    expect(homePath).toBeTruthy();

    const layout = await zip.file(layoutPath!)!.async("string");
    // Site-level metadata lands in the root layout: search title, description
    // fallback, and the favicon public path.
    expect(layout).toContain(SEO_TITLE);
    expect(layout).toContain("A neighborhood bakery delivering fresh bread daily.");
    expect(layout).toContain('rel: "icon"');
    // Per-page metadata lands in the route file.
    const homeFile = await zip.file(homePath!)!.async("string");
    expect(homeFile).toContain(PAGE_TITLE);

    // 9. No console / page / network errors.
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
