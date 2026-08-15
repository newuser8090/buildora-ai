import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Element Library (Phase P22-D) — E2E
//
// A mocked generate response seeds a project whose only section is a
// custom-block tree (container root + heading child), so both insertion paths
// are exercised against real rendering:
//   1. library renders categories + element cards
//   2. search filters the library
//   3. clicking an element adds a NEW custom-block section (selected + visible)
//   4. clicking an element with a custom-block section selected inserts it
//      inside that design
//   5. undo removes the inserted element (one atomic history entry)
// ---------------------------------------------------------------------------

const SECTION_ID = "cb-hero";
const ROOT_ID = SECTION_ID; // custom-block trees are re-rooted to the section id
const HEADING_ID = "h-title";

function mockProject(projectId: string) {
  return {
    success: true,
    source: "rule-based",
    project: {
      id: projectId,
      name: "Test — Element Library",
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
                name: "Inspector block",
                tree: {
                  rootIds: [ROOT_ID],
                  nodes: {
                    [ROOT_ID]: {
                      id: ROOT_ID,
                      type: "container",
                      parentId: null,
                      children: [HEADING_ID],
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
                      props: { text: "Inspector Heading", level: 2 },
                      style: { fontSize: 24, color: "#111111" },
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

async function openLibraryProject(page: Page) {
  const projectId = await createSaaSProjectAndOpenEditor(page);
  await page.route("**/api/generate", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockProject(projectId)) });
  });
  const textarea = page.locator('[data-testid="prompt-input"]');
  await textarea.fill("Element library website");
  await page.keyboard.press("Enter");
  const preview = page.locator('[data-testid="preview-content"]');
  await expect(preview).toBeVisible({ timeout: 15000 });
  const section = page.locator('[data-testid="custom-block-section"]');
  await expect(section.getByText("Inspector Heading", { exact: true })).toBeVisible({
    timeout: 10000,
  });
  return projectId;
}

async function openElementsTab(page: Page) {
  await page.locator('[data-testid="right-tab-elements"]').click();
  const library = page.locator('[data-testid="element-library"]');
  await expect(library).toBeVisible();
  return library;
}

test.describe("Element Library (P22-D)", () => {
  test("library renders categories and element cards", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await openLibraryProject(page);
    await openElementsTab(page);

    // Category chips.
    await expect(page.locator('[data-testid="element-cat-all"]')).toBeVisible();
    await expect(page.locator('[data-testid="element-cat-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="element-cat-content"]')).toBeVisible();
    await expect(page.locator('[data-testid="element-cat-navigation"]')).toBeVisible();
    // Representative element cards.
    await expect(page.locator('[data-testid="element-card-heading"]')).toBeVisible();
    await expect(page.locator('[data-testid="element-card-container"]')).toBeVisible();
    await expect(page.locator('[data-testid="element-card-button"]')).toBeVisible();

    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("search filters the library and shows an empty state", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await openLibraryProject(page);
    await openElementsTab(page);

    await page.locator('[data-testid="element-library-search"]').fill("pricing");
    await expect(page.locator('[data-testid="element-card-pricing-card"]')).toBeVisible();
    await expect(page.locator('[data-testid="element-card-heading"]')).toHaveCount(0);

    await page.locator('[data-testid="element-library-search"]').fill("zzzzz");
    await expect(page.locator('[data-testid="element-library-empty"]')).toBeVisible();

    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("clicking an element adds a new custom-block section and selects it", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await openLibraryProject(page);
    await openElementsTab(page);

    await page.locator('[data-testid="element-card-heading"]').click();
    await expect(page.locator('[data-testid="my-blocks-toast"]')).toContainText("added to your page", {
      timeout: 5000,
    });

    // A second custom-block section renders the default heading content.
    const sections = page.locator('[data-testid="custom-block-section"]');
    await expect(sections).toHaveCount(2);
    await expect(sections.nth(1).getByText("Your heading", { exact: true })).toBeVisible({
      timeout: 5000,
    });
    // The new section is selected (canvas selection box bound to its id).
    await expect(page.locator('[data-testid="canvas-selection-box"]')).toBeVisible({
      timeout: 5000,
    });

    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("clicking an element inserts it inside the selected custom-block design", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await openLibraryProject(page);

    // Select the custom-block section on the canvas.
    await page.locator('[data-testid="custom-block-section"]').click();
    await expect(page.locator('[data-testid="element-inspector"]')).toBeVisible({
      timeout: 5000,
    });

    await openElementsTab(page);
    // The context banner announces the inside-placement.
    await expect(page.locator('[data-testid="element-library-context"]')).toContainText(
      "Adding inside the selected design",
    );

    await page.locator('[data-testid="element-card-paragraph"]').click();
    // The design's content grows with the paragraph text.
    const section = page.locator('[data-testid="custom-block-section"]');
    await expect(section.getByText("Add a short paragraph here.", { exact: true })).toBeVisible({
      timeout: 5000,
    });

    // One undo removes only the inserted block.
    await page.locator('[data-testid="undo-button"]').click();
    await expect(section.getByText("Add a short paragraph here.", { exact: true })).toHaveCount(0);
    await expect(section.getByText("Inspector Heading", { exact: true })).toBeVisible();

    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
