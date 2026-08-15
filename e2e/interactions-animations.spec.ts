import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import JSZip from "jszip";
import type { Page } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
  assertNoFailedRequests,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Phase P22-G — Interactions + Animations (E2E)
//
// A mocked generate response seeds a two-page project whose home page carries
// a custom-block section with a heading, a button and a tall spacer (so
// scroll-to actually scrolls) followed by a scroll target paragraph.
//
// Coverage:
//   1. animation creation — configure an entrance animation on the heading,
//      verify it renders on the canvas and persists across save/reload
//   2. hover + focus — configure a hover effect and a focus effect; verify
//      the visual state on hover and keyboard focus behavior
//   3. click → page navigation — configure a typed NavTarget and verify the
//      visitor preview navigates to the target page
//   4. click → scroll-to — verify the visitor preview scrolls to the target
//   5. export — the generated custom-block component carries the animation
//      CSS, keyframes, reduced-motion guard and the page route map
//   6. reduced motion — emulated prefers-reduced-motion disables the entrance
//      animation while navigation and focus interactions still work
//
// One Playwright-managed dev server (workers=1 via playwright.config).
// ---------------------------------------------------------------------------

const SECTION_ID = "cb-hero";
const ROOT_ID = SECTION_ID;
const HEADING_ID = "head";
const BUTTON_ID = "btn";
const SPACER_ID = "spacer";
const TARGET_ID = "target";

function mockProject(projectId: string) {
  return {
    success: true,
    source: "rule-based",
    project: {
      id: projectId,
      name: "Test — Interactions",
      theme: {
        palette: {
          background: "#ffffff", foreground: "#0a0a0a", primary: "#7c5cfc",
          primaryForeground: "#ffffff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
          muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
          accentForeground: "#ffffff", border: "#e5e5e5", card: "#ffffff", cardForeground: "#0a0a0a",
        },
        typography: { fontFamily: "Geist, system-ui, sans-serif", headingFont: "Geist, system-ui, sans-serif", baseSize: "16px", scale: 1.25 },
        spacing: { sectionPadding: "6rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
        radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
        shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
      },
      pages: [
        {
          id: "page-1",
          title: "Home",
          slug: "/",
          sections: [
            {
              id: SECTION_ID,
              type: "custom-block",
              order: 1,
              visible: true,
              props: {
                name: "Interaction block",
                tree: {
                  rootIds: [ROOT_ID],
                  nodes: {
                    [ROOT_ID]: {
                      id: ROOT_ID,
                      type: "container",
                      parentId: null,
                      children: [HEADING_ID, BUTTON_ID, SPACER_ID, TARGET_ID],
                      props: {},
                      style: { padding: "2rem" },
                      responsive: {},
                      visible: true,
                      locked: false,
                      hidden: false,
                    },
                    [HEADING_ID]: {
                      id: HEADING_ID,
                      type: "heading",
                      parentId: ROOT_ID,
                      children: [],
                      props: { text: "Animated heading", level: 2 },
                      style: {},
                      responsive: {},
                      visible: true,
                      locked: false,
                      hidden: false,
                    },
                    [BUTTON_ID]: {
                      id: BUTTON_ID,
                      type: "button",
                      parentId: ROOT_ID,
                      children: [],
                      props: { text: "Go to About" },
                      style: {},
                      responsive: {},
                      visible: true,
                      locked: false,
                      hidden: false,
                    },
                    [SPACER_ID]: {
                      id: SPACER_ID,
                      type: "spacer",
                      parentId: ROOT_ID,
                      children: [],
                      props: {},
                      style: { height: 700 },
                      responsive: {},
                      visible: true,
                      locked: false,
                      hidden: false,
                    },
                    [TARGET_ID]: {
                      id: TARGET_ID,
                      type: "paragraph",
                      parentId: ROOT_ID,
                      children: [],
                      props: { text: "Scroll target" },
                      style: {},
                      responsive: {},
                      visible: true,
                      locked: false,
                      hidden: false,
                    },
                  },
                },
              },
              styles: {},
            },
          ],
        },
        {
          id: "page-2",
          title: "About",
          slug: "/about",
          // The About page carries its own small section so the project
          // satisfies the project/export schema (every page needs at least
          // one section) — required for save→reload and site export.
          sections: [
            {
              id: "cb-about",
              type: "custom-block",
              order: 1,
              visible: true,
              props: {
                name: "About block",
                tree: {
                  rootIds: ["about-root"],
                  nodes: {
                    "about-root": {
                      id: "about-root",
                      type: "container",
                      parentId: null,
                      children: ["about-text"],
                      props: {},
                      style: { padding: "2rem" },
                      responsive: {},
                      visible: true,
                      locked: false,
                      hidden: false,
                    },
                    "about-text": {
                      id: "about-text",
                      type: "paragraph",
                      parentId: "about-root",
                      children: [],
                      props: { text: "About page content" },
                      style: {},
                      responsive: {},
                      visible: true,
                      locked: false,
                      hidden: false,
                    },
                  },
                },
              },
              styles: {},
            },
          ],
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    warnings: [],
  };
}

async function openProject(page: Page) {
  const projectId = await createSaaSProjectAndOpenEditor(page);
  await page.route("**/api/generate", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockProject(projectId)) });
  });
  const textarea = page.locator('[data-testid="prompt-input"]');
  await textarea.fill("Interactions website");
  await page.keyboard.press("Enter");
  const preview = page.locator('[data-testid="preview-content"]');
  await expect(preview).toBeVisible({ timeout: 15000 });
  const section = page.locator('[data-testid="custom-block-section"]');
  await expect(section.getByText("Animated heading", { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.locator('[data-testid="design-panel"]')).toBeVisible();
  return preview;
}

/** Select a block through the build tree (deterministic; canvas heading clicks
 *  bubble to the container). */
async function selectBlock(page: Page, blockId: string) {
  await page.locator('[data-testid="right-tab-blocks"]').click();
  await expect(page.locator('[data-testid="build-tree-panel"]')).toBeVisible();
  // The build tree stays expanded after the first selection — only expand
  // when the row is still collapsed.
  const rootRow = page.locator(`[data-testid="block-row-${ROOT_ID}"]`);
  const expandButton = rootRow.locator('[aria-label="Expand"]');
  if ((await expandButton.count()) > 0) {
    await expandButton.click();
  }
  await page.locator(`[data-testid="block-row-${blockId}"]`).click();
  await page.locator('[data-testid="right-tab-design"]').click();
  await expect(page.locator('[data-testid="element-inspector"]')).toBeVisible({
    timeout: 5000,
  });
}

async function openVisitorPreview(page: Page) {
  await page.locator('[data-testid="topnav-preview-button"]').click();
  await expect(page.locator('[data-testid="preview-shell"]')).toBeVisible({
    timeout: 10000,
  });
}

/** The injected tree-level presentation <style> inside the custom block.
 *  (The canvas also mounts a global [data-preview-root] style, so the
 *  locator is scoped to the custom-block section's own style element.) */
function canvasStyle(page: Page) {
  return page.locator('[data-testid="custom-block-section"] style');
}

test.describe("Phase P22-G — interactions and animations", () => {
  test("creating an entrance animation renders on canvas and persists", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const audit = attachRuntimeAudit(page);
    await openProject(page);
    await selectBlock(page, HEADING_ID);

    // Expand the Animation section and choose On load + Fade.
    await page.locator('[data-testid="inspector-section-animation-toggle"]').click();
    await expect(page.locator('[data-testid="inspector-animation-trigger"]')).toBeVisible();
    await page.locator('[data-testid="inspector-animation-trigger-load"]').click();
    await expect(
      page.locator('[data-testid="inspector-animation-trigger-load"]'),
    ).toHaveAttribute("aria-checked", "true");

    // Set an explicit duration so the rendered value is visible.
    const duration = page.locator('[data-testid="inspector-animation-duration"]');
    await duration.fill("800");
    await duration.blur();

    // The canvas element carries the animation attributes + inline animation.
    const headingEl = page.locator(`[data-block-id="${HEADING_ID}"]`);
    await expect(headingEl).toHaveAttribute("data-ba-anim", "load", { timeout: 5000 });
    await expect(headingEl).toHaveCSS("animation-name", "ba-fade");

    // Save + reload → the configuration persists.
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({
      timeout: 10000,
    });
    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="custom-block-section"]')).toBeVisible({
      timeout: 10000,
    });
    await selectBlock(page, HEADING_ID);
    await page.locator('[data-testid="inspector-section-animation-toggle"]').click();
    await expect(
      page.locator('[data-testid="inspector-animation-trigger-load"]'),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      page.locator(`[data-block-id="${HEADING_ID}"]`),
    ).toHaveAttribute("data-ba-anim", "load");

    assertRuntimeClean(audit.state);
    assertNoFailedRequests(audit.state);
    audit.detach();
  });

  test("hover effect renders visually; focus effect works with the keyboard", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const audit = attachRuntimeAudit(page);
    await openProject(page);
    await selectBlock(page, HEADING_ID);

    // Enable hover with a visible color change (deterministic assertion).
    await page.locator('[data-testid="inspector-section-interactions-toggle"]').click();
    await page.locator('[data-testid="inspector-interaction-hover"]').click();
    const hoverColor = page.locator('[data-testid="inspector-interaction-hover-color"]');
    await hoverColor.fill("#ff0000");
    await hoverColor.blur();

    // The injected tree CSS contains the hover rule. (Playwright text
    // assertions strip <style> content, so the raw textContent is polled.)
    await expect
      .poll(async () => (await canvasStyle(page).textContent()) ?? "")
      .toContain(`[data-block-id="${HEADING_ID}"]:hover`);

    // Hovering the canvas heading applies the color.
    const headingEl = page.locator(`[data-block-id="${HEADING_ID}"]`);
    await headingEl.hover();
    await expect(headingEl).toHaveCSS("color", "rgb(255, 0, 0)", { timeout: 5000 });

    // Enable a focus effect (scale) so the element becomes keyboard-focusable
    // in the visitor preview and reacts to focus-visible.
    await page.locator('[data-testid="inspector-interaction-focus"]').click();
    const focusScale = page.locator('[data-testid="inspector-interaction-focus-scale"]');
    await focusScale.fill("1.05");
    await focusScale.blur();
    await expect
      .poll(async () => (await canvasStyle(page).textContent()) ?? "")
      .toContain(`[data-block-id="${HEADING_ID}"]:focus-visible`);

    // Visitor preview: the heading is keyboard-focusable (tabIndex). Focus the
    // last preview-toolbar button, then press Tab — the heading is the first
    // tabbable element in the preview content, so keyboard focus lands on it
    // and the focus-visible rule applies. (The canvas heading behind the
    // preview shell shares the same block id, so focus is asserted against the
    // visitor-preview element specifically.)
    await openVisitorPreview(page);
    const previewHeading = page.locator(
      `[data-testid="visitor-preview-content"] [data-block-id="${HEADING_ID}"]`,
    );
    await expect(previewHeading).toHaveAttribute("tabindex", "0");
    const deviceButtons = page.locator(
      '[data-testid="preview-shell"] [role="group"][aria-label="Preview size"] button',
    );
    await deviceButtons.last().evaluate((el) => (el as HTMLElement).focus());
    await page.keyboard.press("Tab");
    const activeId = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.id ?? null,
    );
    expect(activeId).toBe(HEADING_ID);
    await expect(previewHeading).toHaveCSS("transform", "matrix(1.05, 0, 0, 1.05, 0, 0)", {
      timeout: 5000,
    });

    assertRuntimeClean(audit.state);
    assertNoFailedRequests(audit.state);
    audit.detach();
  });

  test("click → page NavTarget navigates in the visitor preview", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const audit = attachRuntimeAudit(page);
    await openProject(page);
    await selectBlock(page, BUTTON_ID);

    // Interactions → Click → Navigate → choose the About page target.
    await page.locator('[data-testid="inspector-section-interactions-toggle"]').click();
    await page.locator('[data-testid="inspector-interaction-click-navigate"]').click();
    await expect(page.locator('[data-testid="nav-target-picker"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-target-page"]')).toBeVisible();
    await page.locator('[data-testid="nav-target-page"]').selectOption("page-2");
    // The picker resolves the target safely.
    await expect(page.locator('[data-testid="nav-target-href"]')).toContainText("/about");

    await openVisitorPreview(page);

    // The button is now a real safe anchor in the preview; clicking navigates.
    // (The canvas keeps its own block-button behind the preview shell, so the
    // locator is scoped to the visitor preview.)
    const button = page.locator(
      '[data-testid="visitor-preview-content"] [data-testid="block-button"]',
    );
    await expect(button).toHaveAttribute("href", "/about");
    await button.click();
    await expect(page.locator('[data-testid="preview-route"]')).toHaveText("/about", {
      timeout: 5000,
    });
    await expect(page.locator('[data-testid="visitor-preview-content"]')).toBeVisible();

    assertRuntimeClean(audit.state);
    assertNoFailedRequests(audit.state);
    audit.detach();
  });

  test("click → scroll-to scrolls the visitor preview to the target", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const audit = attachRuntimeAudit(page);
    await openProject(page);
    await selectBlock(page, BUTTON_ID);

    await page.locator('[data-testid="inspector-section-interactions-toggle"]').click();
    await page.locator('[data-testid="inspector-interaction-click-scroll-to"]').click();
    const targetSelect = page.locator('[data-testid="inspector-interaction-scroll-target"]');
    await expect(targetSelect).toBeVisible();
    await targetSelect.selectOption(TARGET_ID);

    await openVisitorPreview(page);

    // The target is far below the fold (tall spacer) — assert it is NOT in
    // view before clicking, then IS in view after the click. (Locators are
    // scoped to the visitor preview — the canvas keeps its own elements
    // behind the preview shell.)
    const target = page.locator(
      `[data-testid="visitor-preview-content"] [data-block-id="${TARGET_ID}"]`,
    );
    await expect(target).not.toBeInViewport({ timeout: 5000 });

    const scrollButton = page.locator(
      '[data-testid="visitor-preview-content"] [data-testid="block-button"]',
    );
    await expect(scrollButton).toHaveAttribute("href", `#${TARGET_ID}`);
    await scrollButton.click();
    await expect(target).toBeInViewport({ timeout: 5000 });

    assertRuntimeClean(audit.state);
    assertNoFailedRequests(audit.state);
    audit.detach();
  });

  test("export emits animation CSS, reduced motion and the route map", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const audit = attachRuntimeAudit(page);
    await openProject(page);
    await selectBlock(page, HEADING_ID);

    await page.locator('[data-testid="inspector-section-animation-toggle"]').click();
    await page.locator('[data-testid="inspector-animation-trigger-load"]').click();

    const downloadPromise = page.waitForEvent("download");
    await page.locator('[data-testid="export-site-button"]').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    const zip = await JSZip.loadAsync(readFileSync(downloadPath!));
    const paths = Object.keys(zip.files);
    const componentPath = paths.find((p) => p.endsWith("/components/sections/custom-block.tsx"));
    const pagePath = paths.find((p) => p.endsWith("/app/page.tsx"));
    expect(componentPath).toBeTruthy();
    expect(pagePath).toBeTruthy();
    if (!componentPath || !pagePath) return;

    const component = await zip.file(componentPath)!.async("string");
    // Keyframes + reduced-motion guard are emitted in the generated runtime.
    expect(component).toContain("@keyframes ba-fade");
    expect(component).toContain("prefers-reduced-motion: reduce");
    expect(component).toContain("animation: none !important");
    // Safe navigation + bounded scroll runtime exist (no raw user JS).
    expect(component).toContain("baIsSafeNav");
    expect(component).toContain("function baScrollTo");
    expect(component).not.toContain("eval(");
    expect(component).not.toContain("new Function");

    // The emitted page serializes the animation and passes the route map so
    // typed NavTargets resolve to real exported routes.
    const pageFile = await zip.file(pagePath)!.async("string");
    expect(pageFile).toContain("routes={{\"page-1\":\"/\",\"page-2\":\"/about\"}}");
    expect(pageFile).toContain('"animation":');

    assertRuntimeClean(audit.state);
    assertNoFailedRequests(audit.state);
    audit.detach();
  });

  test("reduced motion disables the entrance animation; navigation and focus still work", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const audit = attachRuntimeAudit(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openProject(page);
    await selectBlock(page, HEADING_ID);

    await page.locator('[data-testid="inspector-section-animation-toggle"]').click();
    await page.locator('[data-testid="inspector-animation-trigger-load"]').click();

    // Under reduced motion the entrance animation is inert (none).
    const headingEl = page.locator(`[data-block-id="${HEADING_ID}"]`);
    await expect(headingEl).toHaveCSS("animation-name", "none", { timeout: 5000 });

    // Focus feedback is NOT removed by reduced motion: configure a focus
    // effect on the heading so it stays keyboard-focusable in the preview.
    await page.locator('[data-testid="inspector-section-interactions-toggle"]').click();
    await page.locator('[data-testid="inspector-interaction-focus"]').click();
    const focusScale = page.locator('[data-testid="inspector-interaction-focus-scale"]');
    await focusScale.fill("1.05");
    await focusScale.blur();

    // Navigation still works: configure click → page on the button.
    await selectBlock(page, BUTTON_ID);
    await page.locator('[data-testid="inspector-section-interactions-toggle"]').click();
    await page.locator('[data-testid="inspector-interaction-click-navigate"]').click();
    await page.locator('[data-testid="nav-target-page"]').selectOption("page-2");
    await openVisitorPreview(page);

    // The button is a real safe anchor under reduced motion too.
    const button = page.locator(
      '[data-testid="visitor-preview-content"] [data-testid="block-button"]',
    );
    await expect(button).toHaveAttribute("href", "/about");

    // Keyboard focus reaches the heading and the focus-visible transform
    // applies (interaction feedback survives reduced motion).
    const previewHeading = page.locator(
      `[data-testid="visitor-preview-content"] [data-block-id="${HEADING_ID}"]`,
    );
    await expect(previewHeading).toHaveAttribute("tabindex", "0");
    const deviceButtons = page.locator(
      '[data-testid="preview-shell"] [role="group"][aria-label="Preview size"] button',
    );
    await deviceButtons.last().evaluate((el) => (el as HTMLElement).focus());
    await page.keyboard.press("Tab");
    const activeId = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.id ?? null,
    );
    expect(activeId).toBe(HEADING_ID);
    await expect(previewHeading).toHaveCSS("transform", "matrix(1.05, 0, 0, 1.05, 0, 0)", {
      timeout: 5000,
    });

    // Clicking the anchor still navigates to the target page.
    await button.click();
    await expect(page.locator('[data-testid="preview-route"]')).toHaveText("/about", {
      timeout: 5000,
    });

    assertRuntimeClean(audit.state);
    assertNoFailedRequests(audit.state);
    audit.detach();
  });
});
