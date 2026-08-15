import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import JSZip from "jszip";
import type { Page } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
  assertNoFailedRequests,
} from "./helpers/runtime-audit";
import { createBlankProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Phase P22-E — multi-page navigation polish
//
// Coverage:
//   1. Set homepage from the page tab menu → order + slug ownership
//   2. Export route files reflect the homepage change (root owns "/")
//   3. "Navigate to…" picker writes the resolved page href in the inspector
//   4. Visitor preview page switcher reflects the new homepage
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

/** Rename the currently-inline-renaming page tab. */
async function finishRename(page: Page, title: string) {
  const input = page.locator('[data-testid="page-rename-input"]');
  await expect(input).toBeVisible();
  await input.fill(title);
  await input.press("Enter");
  await expect(input).not.toBeVisible({ timeout: 5000 });
}

/** Run an action from a page tab's action menu. */
async function runPageAction(page: Page, pageId: string, action: string) {
  await page.locator(`[data-testid="page-menu-${pageId}"]`).click();
  await page.locator(`[data-testid="page-action-${action}"]`).click();
}

/** Add a page (name → immediate rename). */
async function addPage(page: Page, title: string) {
  await page.locator('[data-testid="page-tab-add"]').click();
  await finishRename(page, title);
}

async function openStructureTab(page: Page) {
  await page.locator('[data-testid="right-tab-structure"]').click();
  await expect(page.locator('[data-testid="structure-panel"]')).toBeVisible();
}

/** Add a section of the given type through the Add Section dialog. */
async function addSection(page: Page, type: string) {
  await openStructureTab(page);
  await page.locator('[data-testid="add-section-button"]').click();
  const dialog = page.getByRole("dialog", { name: "Add Section" });
  await expect(dialog).toBeVisible();
  await page.locator(`[data-testid="section-card-${type}"]`).click();
  await page.locator('[data-testid="confirm-add-section"]').click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });
}

test.describe("Phase P22-E — page navigation", () => {
  test("set homepage reorders pages and reassigns root-slug ownership", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const audit = attachRuntimeAudit(page);

    await createBlankProjectAndOpenEditor(page);
    let tabs = await getPageTabs(page);
    expect(tabs.map((t) => t.title)).toEqual(["Home"]);

    // Add two more pages.
    await addPage(page, "About");
    await addPage(page, "Contact");
    tabs = await getPageTabs(page);
    expect(tabs.map((t) => t.title)).toEqual(["Home", "About", "Contact"]);

    // Select About, then make it the homepage.
    await page.locator(`[data-testid="page-tab-${tabs[1].id}"]`).click();
    await runPageAction(page, tabs[1].id, "set-home");
    tabs = await getPageTabs(page);
    expect(tabs.map((t) => t.title)).toEqual(["About", "Home", "Contact"]);
    // The new homepage stays selected.
    expect(tabs[0].selected).toBe(true);

    // The old homepage tab now carries the home indicator.
    await expect(
      page.locator(`[data-testid="page-tab-${tabs[0].id}"] svg.lucide-house`),
    ).toBeVisible();

    // The "Set as homepage" action is disabled for the current homepage.
    await page.locator(`[data-testid="page-menu-${tabs[0].id}"]`).click();
    await expect(page.locator('[data-testid="page-action-set-home"]')).toBeDisabled();
    await page.keyboard.press("Escape");

    assertNoFailedRequests(audit.state);
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("export route files reflect the new homepage (root route + displaced slug)", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const audit = attachRuntimeAudit(page);

    await createBlankProjectAndOpenEditor(page);
    await addPage(page, "About");
    await addPage(page, "Contact");
    const tabs = await getPageTabs(page);

    // Make Contact the homepage → Contact owns "/", old Home → "/home".
    await runPageAction(page, tabs[2].id, "set-home");

    const downloadPromise = page.waitForEvent("download");
    await page.locator('[data-testid="export-site-button"]').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    const zip = await JSZip.loadAsync(readFileSync(downloadPath!));
    const paths = Object.keys(zip.files);
    const pageFiles = paths.filter((p) => /\/app\/.*page\.tsx$/.test(p));
    expect(pageFiles).toHaveLength(3);

    // Contact is home → owns the root route. Old Home → "/home".
    // About keeps its slug "/about". There is no "/contact" route anymore.
    const homeFile = paths.find((p) => p.endsWith("/app/page.tsx"));
    const displacedFile = paths.find((p) => p.endsWith("/app/home/page.tsx"));
    const aboutFile = paths.find((p) => p.endsWith("/app/about/page.tsx"));
    expect(homeFile).toBeTruthy();
    expect(displacedFile).toBeTruthy();
    expect(aboutFile).toBeTruthy();
    expect(paths.find((p) => p.endsWith("/app/contact/page.tsx"))).toBeUndefined();

    // The new homepage (Contact) is the root route file.
    const homeContent = await zip.file(homeFile!)!.async("string");
    expect(homeContent).toContain("export default function HomePage()");
    expect(homeContent).toContain('title: "Contact"');

    // The displaced old homepage now owns /home.
    const displacedContent = await zip.file(displacedFile!)!.async("string");
    expect(displacedContent).toContain('title: "Home"');

    assertNoFailedRequests(audit.state);
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("navigate-to picker writes the resolved page href in the inspector", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const audit = attachRuntimeAudit(page);

    await createBlankProjectAndOpenEditor(page);
    await addPage(page, "About");

    // Add a CTA section (has a button href field with the picker).
    await addSection(page, "cta");

    // Select the CTA section on the canvas.
    const preview = page.locator('[data-testid="preview-content"]');
    await preview.getByText("Ready to get started?", { exact: true }).click();
    await expect(page.locator('[data-testid="inspector-panel"]')).toBeVisible();

    // Open the picker and choose the Home page → href resolves to "/".
    await page.locator('[data-testid="navigate-to-picker"]').click();
    const menu = page.locator('[data-testid="navigate-to-menu"]');
    await expect(menu).toBeVisible();
    await menu.locator('[role="menuitem"]', { hasText: "Home" }).first().click();

    // The CTA button href now resolves to the Home root route.
    const homeHref = page
      .locator('[data-testid="inspector-panel"] input[value="/"]')
      .first();
    await expect(homeHref).toBeVisible({ timeout: 5000 });

    // Raw href editing still works (manual fallback is preserved) — the same
    // input accepts a typed path.
    await homeHref.fill("/custom-path");
    await expect(
      page.locator('[data-testid="inspector-panel"] input[value="/custom-path"]'),
    ).toBeVisible({ timeout: 5000 });

    assertNoFailedRequests(audit.state);
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("visitor preview page switcher reflects the new homepage", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const audit = attachRuntimeAudit(page);

    await createBlankProjectAndOpenEditor(page);
    await addPage(page, "About");
    await addPage(page, "Contact");
    const tabs = await getPageTabs(page);
    await runPageAction(page, tabs[1].id, "set-home");

    // Open the visitor preview.
    await page.locator('[data-testid="topnav-preview-button"]').click();
    await expect(page.locator('[data-testid="preview-shell"]')).toBeVisible({
      timeout: 10000,
    });

    // The switcher lists the new route table: About "/", Home "/home", Contact "/contact".
    const switcher = page.locator('[data-testid="preview-page-switcher"]');
    await expect(switcher).toContainText("About", { timeout: 5000 });
    const options = await switcher.locator("option").evaluateAll((els) =>
      els.map((el) => ({
        value: el.getAttribute("value") ?? "",
        text: el.textContent ?? "",
      })),
    );
    expect(options).toEqual([
      { value: "/", text: "About" },
      { value: "/home", text: "Home" },
      { value: "/contact", text: "Contact" },
    ]);

    // Default route is the new homepage root.
    await expect(page.locator('[data-testid="preview-route"]')).toHaveText("/");

    // Navigate to the displaced old homepage.
    await switcher.selectOption("/home");
    await expect(page.locator('[data-testid="preview-route"]')).toHaveText("/home");

    // And back to the new homepage root.
    await switcher.selectOption("/");
    await expect(page.locator('[data-testid="preview-route"]')).toHaveText("/");

    assertNoFailedRequests(audit.state);
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
