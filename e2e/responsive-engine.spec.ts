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
// Phase P22-F — Responsive Engine (E2E)
//
// A mocked generate response seeds a project whose only section is a
// custom-block tree: a container root with a 4-column grid (four container
// children). Coverage:
//   1. grid columns at mobile write a viewport override (base untouched) and
//      reflect on the canvas
//   2. responsive suggestions appear at mobile/tablet and Apply folds the
//      override + records the decision (never re-suggested, persisted)
//   3. Dismiss records the user rejection (never re-suggested, persisted)
//   4. export parity — the generated custom-block component folds the same
//      viewport overrides the canvas shows
// ---------------------------------------------------------------------------

const SECTION_ID = "cb-hero";
const ROOT_ID = SECTION_ID;
const GRID_ID = "g1";

function mockProject(projectId: string) {
  return {
    success: true,
    source: "rule-based",
    project: {
      id: projectId,
      name: "Test — Responsive",
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
                name: "Responsive block",
                tree: {
                  rootIds: [ROOT_ID],
                  nodes: {
                    [ROOT_ID]: {
                      id: ROOT_ID,
                      type: "container",
                      parentId: null,
                      children: [GRID_ID],
                      props: {},
                      style: { padding: "2rem" },
                      responsive: {},
                      visible: true,
                      locked: false,
                      hidden: false,
                    },
                    [GRID_ID]: {
                      id: GRID_ID,
                      type: "grid",
                      parentId: ROOT_ID,
                      children: ["c1", "c2", "c3", "c4"],
                      props: { columns: 4 },
                      style: { display: "grid", gap: "1rem" },
                      responsive: {},
                      visible: true,
                      locked: false,
                      hidden: false,
                    },
                    c1: { id: "c1", type: "container", parentId: GRID_ID, children: [], props: {}, style: {}, responsive: {}, visible: true, locked: false, hidden: false },
                    c2: { id: "c2", type: "container", parentId: GRID_ID, children: [], props: {}, style: {}, responsive: {}, visible: true, locked: false, hidden: false },
                    c3: { id: "c3", type: "container", parentId: GRID_ID, children: [], props: {}, style: {}, responsive: {}, visible: true, locked: false, hidden: false },
                    c4: { id: "c4", type: "container", parentId: GRID_ID, children: [], props: {}, style: {}, responsive: {}, visible: true, locked: false, hidden: false },
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

async function openResponsiveProject(page: Page) {
  const projectId = await createSaaSProjectAndOpenEditor(page);
  await page.route("**/api/generate", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockProject(projectId)) });
  });
  const textarea = page.locator('[data-testid="prompt-input"]');
  await textarea.fill("Responsive website");
  await page.keyboard.press("Enter");
  const preview = page.locator('[data-testid="preview-content"]');
  await expect(preview).toBeVisible({ timeout: 15000 });
  const section = page.locator('[data-testid="custom-block-section"]');
  await expect(section).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="design-panel"]')).toBeVisible();
  // Select the custom-block section so the universal element inspector
  // (breakpoint context + responsive suggestions) renders in the Design tab.
  await section.click();
  await expect(page.locator('[data-testid="element-inspector"]')).toBeVisible({
    timeout: 5000,
  });
  return preview;
}

/** Select the grid element through the build tree (deterministic). */
async function selectGrid(page: Page) {
  await page.locator('[data-testid="right-tab-blocks"]').click();
  await expect(page.locator('[data-testid="build-tree-panel"]')).toBeVisible();
  await page
    .locator(`[data-testid="block-row-${ROOT_ID}"]`)
    .locator('[aria-label="Expand"]')
    .click();
  await page.locator(`[data-testid="block-row-${GRID_ID}"]`).click();
  await page.locator('[data-testid="right-tab-design"]').click();
  await expect(page.locator('[data-testid="element-inspector"]')).toBeVisible({
    timeout: 5000,
  });
}

const GRID_EL = `[data-block-id="${GRID_ID}"]`;

/** The browser serializes minmax(0, 1fr) as minmax(0px, 1fr) — match both. */
function columnsStyle(n: number) {
  return new RegExp(`repeat\\(${n}, minmax\\(0(?:px)?, 1fr\\)\\)`);
}

/** Re-select the custom-block section after a reload (selection is transient). */
async function reselectSection(page: Page) {
  await page.locator('[data-testid="custom-block-section"]').click();
  await expect(page.locator('[data-testid="element-inspector"]')).toBeVisible({
    timeout: 5000,
  });
}

test.describe("Phase P22-F — responsive engine", () => {
  test("grid columns at mobile write a viewport override without touching the base", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const audit = attachRuntimeAudit(page);
    await openResponsiveProject(page);
    await selectGrid(page);

    // Progressive disclosure: expand the Layout section to reach Columns.
    await page.locator('[data-testid="inspector-section-layout-toggle"]').click();
    await expect(page.locator('[data-testid="inspector-columns-4"]')).toBeVisible();

    const gridEl = page.locator(GRID_EL);
    // Desktop base: 4 columns via props.columns (active in the segmented control).
    await expect(page.locator('[data-testid="inspector-columns-4"]')).toHaveAttribute("aria-checked", "true");
    await expect(gridEl).toHaveAttribute("style", columnsStyle(4));

    // Mobile: set 1 column → viewport override; canvas reflects it.
    await page.locator('[data-testid="inspector-breakpoint-mobile"]').click();
    await page.locator('[data-testid="inspector-columns-1"]').click();
    await expect(page.locator('[data-testid="inspector-columns-1"]')).toHaveAttribute("aria-checked", "true");
    await expect(gridEl).toHaveAttribute("style", columnsStyle(1), {
      timeout: 5000,
    });
    await expect(page.locator('[data-testid="inspector-reset-override"]')).toBeVisible();

    // Back to desktop: the base value is untouched.
    await page.locator('[data-testid="inspector-breakpoint-base"]').click();
    await expect(page.locator('[data-testid="inspector-columns-4"]')).toHaveAttribute("aria-checked", "true");
    await expect(gridEl).toHaveAttribute("style", columnsStyle(4));

    assertNoFailedRequests(audit.state);
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("suggestions appear at mobile/tablet; Apply folds the override and never re-suggests", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const audit = attachRuntimeAudit(page);
    await openResponsiveProject(page);

    // No suggestions on desktop.
    await expect(page.locator('[data-testid="responsive-suggestions"]')).toHaveCount(0);

    // Mobile: the 4-column grid suggests 1 column.
    await page.locator('[data-testid="inspector-breakpoint-mobile"]').click();
    await expect(page.locator('[data-testid="responsive-suggestions"]')).toBeVisible({
      timeout: 5000,
    });
    const row = page.locator(`[data-testid="responsive-suggestion-${GRID_ID}"]`);
    await expect(row.getByText("Show 1 column on mobile")).toBeVisible();

    // Apply → the canvas reflects the override and the suggestion disappears.
    await row.locator('[data-testid="responsive-apply"]').click();
    const gridEl = page.locator(GRID_EL);
    await expect(gridEl).toHaveAttribute("style", columnsStyle(1), {
      timeout: 5000,
    });
    await expect(page.locator('[data-testid="responsive-suggestions"]')).toHaveCount(0);

    // Tablet still suggests 2 columns (different viewport, not suppressed).
    await page.locator('[data-testid="inspector-breakpoint-tablet"]').click();
    await expect(
      page.locator(`[data-testid="responsive-suggestion-${GRID_ID}"]`),
    ).toContainText("Show 2 columns on tablet");

    assertNoFailedRequests(audit.state);
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("an applied suggestion persists across reload and is never re-suggested", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const audit = attachRuntimeAudit(page);
    await openResponsiveProject(page);

    await page.locator('[data-testid="inspector-breakpoint-mobile"]').click();
    const row = page.locator(`[data-testid="responsive-suggestion-${GRID_ID}"]`);
    await expect(row).toBeVisible({ timeout: 5000 });
    await row.locator('[data-testid="responsive-apply"]').click();
    await expect(page.locator('[data-testid="responsive-suggestions"]')).toHaveCount(0);

    // Save + reload — the decision and the override persist.
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({
      timeout: 10000,
    });
    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="custom-block-section"]')).toBeVisible({
      timeout: 10000,
    });
    await reselectSection(page);

    // The override is still applied on the canvas at mobile.
    await page.locator('[data-testid="inspector-breakpoint-mobile"]').click();
    await expect(page.locator(GRID_EL)).toHaveAttribute("style", columnsStyle(1), {
      timeout: 5000,
    });
    // The applied decision suppresses the suggestion.
    await expect(page.locator('[data-testid="responsive-suggestions"]')).toHaveCount(0);

    assertNoFailedRequests(audit.state);
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("Dismiss records the user rejection: nothing auto-applied, never re-suggested", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const audit = attachRuntimeAudit(page);
    await openResponsiveProject(page);

    await page.locator('[data-testid="inspector-breakpoint-mobile"]').click();
    const row = page.locator(`[data-testid="responsive-suggestion-${GRID_ID}"]`);
    await expect(row).toBeVisible({ timeout: 5000 });
    await row.locator('[data-testid="responsive-dismiss"]').click();

    // Nothing was auto-applied — the grid keeps 4 columns.
    await expect(page.locator(GRID_EL)).toHaveAttribute("style", columnsStyle(4));
    await expect(page.locator('[data-testid="responsive-suggestions"]')).toHaveCount(0);

    // Save + reload → still not re-suggested (user decision persisted).
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({
      timeout: 10000,
    });
    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="custom-block-section"]')).toBeVisible({
      timeout: 10000,
    });
    await reselectSection(page);
    await page.locator('[data-testid="inspector-breakpoint-mobile"]').click();
    await expect(page.locator('[data-testid="responsive-suggestions"]')).toHaveCount(0);
    await expect(page.locator(GRID_EL)).toHaveAttribute("style", columnsStyle(4));

    assertNoFailedRequests(audit.state);
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("export ZIP emits the same viewport override the canvas shows", async ({ page }) => {
    test.setTimeout(120_000);
    const audit = attachRuntimeAudit(page);
    await openResponsiveProject(page);

    // Apply the mobile suggestion first.
    await page.locator('[data-testid="inspector-breakpoint-mobile"]').click();
    const row = page.locator(`[data-testid="responsive-suggestion-${GRID_ID}"]`);
    await expect(row).toBeVisible({ timeout: 5000 });
    await row.locator('[data-testid="responsive-apply"]').click();
    await expect(page.locator(GRID_EL)).toHaveAttribute("style", columnsStyle(1), {
      timeout: 5000,
    });

    const downloadPromise = page.waitForEvent("download");
    await page.locator('[data-testid="export-site-button"]').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    const zip = await JSZip.loadAsync(readFileSync(downloadPath!));
    const paths = Object.keys(zip.files);
    // ZIP entries live under a sanitised project-name root folder.
    const componentPath = paths.find((p) => p.endsWith("/components/sections/custom-block.tsx"));
    const pagePath = paths.find((p) => p.endsWith("/app/page.tsx"));
    expect(componentPath).toBeTruthy();
    expect(pagePath).toBeTruthy();
    if (!componentPath || !pagePath) return;

    // The generated custom-block component folds viewport overrides.
    const component = await zip.file(componentPath)!.async("string");
    expect(component).toContain("TABLET_MAX_WIDTH = 1024");
    expect(component).toContain("viewportOverrides(viewport, width)");
    expect(component).toContain("blockStyle(node.style, node.responsive, node.viewport, width)");

    // The emitted page serializes the full tree, including the override.
    const pageFile = await zip.file(pagePath)!.async("string");
    expect(pageFile).toContain("<CustomBlock key=");
    expect(pageFile).toContain('"gridTemplateColumns":"repeat(1, minmax(0, 1fr))"');
    expect(pageFile).toContain('"viewport":');

    assertNoFailedRequests(audit.state);
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
