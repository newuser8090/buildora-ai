import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Universal Style & Property Inspector (Phase P22-C) — E2E
//
// The universal inspector renders for CUSTOM-BLOCK sections (their element
// trees are durably editable). A mocked generate response seeds a project
// whose only section is a custom-block tree: a container root with one
// heading child. Tests cover:
//   1. container selection → layout/appearance controls; width/opacity/radius
//      edits reflect on the canvas immediately
//   2. heading selection (via build tree) → typography controls; font size +
//      color reflect on the canvas
//   3. undo/redo of an inspector change (one atomic entry)
//   4. responsive override at mobile + reset, base value untouched
//   5. canvas resize → inspector reflects the new geometry
//   6. save + reload → value persists
//   7. no runtime console errors
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
      name: "Test — Inspector",
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

async function openInspectorProject(page: Page) {
  // The mocked generate response REPLACES the created project, so it must
  // carry the SAME id — otherwise the editor URL points at a project whose
  // record never receives the save, and reload restores the template.
  const projectId = await createSaaSProjectAndOpenEditor(page);
  await page.route("**/api/generate", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockProject(projectId)) });
  });
  const textarea = page.locator('[data-testid="prompt-input"]');
  await textarea.fill("Custom block website");
  await page.keyboard.press("Enter");
  const preview = page.locator('[data-testid="preview-content"]');
  await expect(preview).toBeVisible({ timeout: 15000 });
  // The custom-block section renders its heading.
  const section = page.locator('[data-testid="custom-block-section"]');
  await expect(section.getByText("Inspector Heading", { exact: true })).toBeVisible({
    timeout: 10000,
  });
  // The Design tab is the default right-sidebar tab.
  await expect(page.locator('[data-testid="design-panel"]')).toBeVisible();
  return preview;
}

/** Select the section root by clicking its container on the canvas. */
async function selectSectionRoot(page: Page) {
  await page.locator('[data-testid="custom-block-section"]').click();
  await expect(page.locator('[data-testid="element-inspector"]')).toBeVisible({
    timeout: 5000,
  });
}

/** Select the heading block through the build tree (canvas heading clicks
 *  bubble to the container, so the tree is the deterministic path). */
async function selectHeading(page: Page) {
  await page.locator('[data-testid="right-tab-blocks"]').click();
  await expect(page.locator('[data-testid="build-tree-panel"]')).toBeVisible();
  await page
    .locator(`[data-testid="block-row-${ROOT_ID}"]`)
    .locator('[aria-label="Expand"]')
    .click();
  await page.locator(`[data-testid="block-row-${HEADING_ID}"]`).click();
  await page.locator('[data-testid="right-tab-design"]').click();
  await expect(page.locator('[data-testid="element-inspector"]')).toBeVisible({
    timeout: 5000,
  });
  // Progressive disclosure: only the FIRST section opens by default. The
  // heading's first section is Content, so expand Typography for the
  // typography/color interactions below (exactly what a user would do).
  await page.locator('[data-testid="inspector-section-typography-toggle"]').click();
  await expect(
    page.locator('[data-testid="inspector-section-typography-toggle"]'),
  ).toHaveAttribute("aria-expanded", "true");
}

test.describe("Universal style inspector (P22-C)", () => {
  test("container selection shows layout controls; width/opacity/radius edits reflect on the canvas", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await openInspectorProject(page);
    await selectSectionRoot(page);

    // Root container: no typography, layout section present.
    await expect(page.locator('[data-testid="element-inspector-title"]')).toHaveText("Container");
    await expect(page.locator('[data-testid="inspector-section-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="inspector-section-typography"]')).toHaveCount(0);

    const rootEl = page.locator(`[data-block-id="${ROOT_ID}"]`);

    // Width 480 → the canvas container immediately gets width 480px.
    const width = page.locator('[data-testid="inspector-width"]');
    await width.fill("480");
    await width.blur();
    await expect(rootEl).toHaveCSS("width", "480px", { timeout: 5000 });

    // Opacity slider → 50 → canvas opacity 0.5.
    const opacity = page.locator('[data-testid="inspector-opacity"]');
    await opacity.fill("50");
    await opacity.blur();
    await expect(rootEl).toHaveCSS("opacity", "0.5", { timeout: 5000 });

    // Radius XL preset → canvas border-radius 16px (1rem).
    await page.locator('[data-testid="inspector-borderRadius-preset-xl"]').click();
    await expect(rootEl).toHaveCSS("border-radius", "16px", { timeout: 5000 });

    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("heading selection shows typography; font size + color reflect on the canvas", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await openInspectorProject(page);
    await selectHeading(page);

    await expect(page.locator('[data-testid="element-inspector-title"]')).toHaveText("Heading");
    await expect(page.locator('[data-testid="inspector-section-typography"]')).toBeVisible();
    // The "back to section" breadcrumb appears for nested blocks.
    await expect(page.locator('[data-testid="element-inspector-to-root"]')).toBeVisible();

    const headingEl = page.locator(`[data-block-id="${HEADING_ID}"]`);

    // Font size 24 → 40.
    const fontSize = page.locator('[data-testid="inspector-fontSize"]');
    await expect(fontSize).toHaveValue("24");
    await fontSize.fill("40");
    await fontSize.blur();
    await expect(headingEl).toHaveCSS("font-size", "40px", { timeout: 5000 });

    // Text color via the accent swatch → rgb(124, 92, 252).
    await page.locator('[data-testid="inspector-color-swatch-7c5cfc"]').click();
    await expect(headingEl).toHaveCSS("color", "rgb(124, 92, 252)", { timeout: 5000 });

    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("undo and redo revert/re-apply one inspector change atomically", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await openInspectorProject(page);
    await selectHeading(page);

    const headingEl = page.locator(`[data-block-id="${HEADING_ID}"]`);
    const fontSize = page.locator('[data-testid="inspector-fontSize"]');
    await fontSize.fill("48");
    await fontSize.blur();
    await expect(headingEl).toHaveCSS("font-size", "48px", { timeout: 5000 });

    // Undo → back to 24. Redo → 48 again.
    await page.locator('[data-testid="undo-button"]').click();
    await expect(headingEl).toHaveCSS("font-size", "24px", { timeout: 5000 });
    await expect(fontSize).toHaveValue("24");

    await page.locator('[data-testid="redo-button"]').click();
    await expect(headingEl).toHaveCSS("font-size", "48px", { timeout: 5000 });
    await expect(fontSize).toHaveValue("48");

    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("responsive override writes mobile viewport styles without touching the base", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await openInspectorProject(page);
    await selectHeading(page);

    const fontSize = page.locator('[data-testid="inspector-fontSize"]');
    await expect(fontSize).toHaveValue("24");

    // Switch to mobile breakpoint and edit the size → override badge appears.
    await page.locator('[data-testid="inspector-breakpoint-mobile"]').click();
    await fontSize.fill("18");
    await fontSize.blur();
    await expect(page.locator('[data-testid="inspector-reset-override"]')).toBeVisible({
      timeout: 5000,
    });

    // Back to desktop → the base value (24) is shown and untouched.
    await page.locator('[data-testid="inspector-breakpoint-base"]').click();
    await expect(fontSize).toHaveValue("24");

    // Re-enter mobile and reset the override → badge disappears.
    await page.locator('[data-testid="inspector-breakpoint-mobile"]').click();
    await expect(page.locator('[data-testid="inspector-reset-override"]')).toBeVisible();
    await page.locator('[data-testid="inspector-reset-override"]').click();
    await expect(page.locator('[data-testid="inspector-reset-override"]')).toHaveCount(0);

    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("canvas resize updates the inspector geometry fields", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await openInspectorProject(page);
    await selectSectionRoot(page);

    // The selection box renders transform handles for custom-block sections.
    const handle = page.locator('[data-testid="canvas-resize-handle-se"]');
    await expect(handle).toBeVisible({ timeout: 5000 });

    // Drag the south-east handle outward. The handle is 8×8 px and the
    // full-width section's box reaches the preview-frame edge, so the handle's
    // outer half is clipped (unreachable) — grab its inner corner instead,
    // exactly where a user would actually click.
    const box = await handle.boundingBox();
    expect(box).toBeTruthy();
    if (!box) return;
    await page.mouse.move(box.x + 2, box.y + 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 2 + 80, box.y + 2 + 60, { steps: 8 });
    await page.mouse.up();

    // The inspector width/height fields now carry the committed geometry.
    const width = page.locator('[data-testid="inspector-width"]');
    await expect.poll(() => width.inputValue()).not.toBe("");
    const height = page.locator('[data-testid="inspector-height"]');
    await expect.poll(() => height.inputValue()).not.toBe("");

    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("inspector changes persist across save + reload", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await openInspectorProject(page);
    await selectSectionRoot(page);

    const width = page.locator('[data-testid="inspector-width"]');
    await width.fill("420");
    await width.blur();
    await expect(page.locator(`[data-block-id="${ROOT_ID}"]`)).toHaveCSS("width", "420px", {
      timeout: 5000,
    });

    // Save, then reload — the value must be read from persistence.
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({
      timeout: 10000,
    });
    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="custom-block-section"]')).toBeVisible({
      timeout: 10000,
    });

    // Select the section and confirm the inspector reflects the persisted width.
    await selectSectionRoot(page);
    await expect(page.locator('[data-testid="inspector-width"]')).toHaveValue("420");
    await expect(page.locator(`[data-block-id="${ROOT_ID}"]`)).toHaveCSS("width", "420px", {
      timeout: 5000,
    });

    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
