import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Canvas selection & manipulation (Phase P22-B) — editor overlay surface
//
// The SaaS template sections are REGULAR sections (geometry is not yet
// durable for them), so these tests cover the universal selection UX that
// applies to every element: selection box + dimensions chip, deselect
// (Escape / empty-canvas click), overlay quick actions, and the keyboard
// typing guard. Durable geometry manipulation (move/resize/rotate on
// custom-block element trees) is covered by unit tests until the element
// renderer + tree persistence land (P22-C/D).
// ---------------------------------------------------------------------------

function mockProject() {
  return {
    success: true,
    source: "rule-based",
    project: {
      id: "test-proj",
      name: "Test — Saas",
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
          id: "page-1", title: "Home", slug: "/",
          sections: [
            { id: "header-1", type: "header", order: 1, visible: true, props: { logoText: "MyBrand", navLinks: [{ text: "Nav1", href: "/nav1" }, { text: "Nav2", href: "/nav2" }], ctaText: "Get Started", ctaHref: "#cta" }, styles: {} },
            { id: "hero-1", type: "hero", order: 2, visible: true, props: { headline: "Hero Title", subheadline: "Hero sub", primaryCta: { text: "Start", href: "#start" }, secondaryCta: { text: "Learn", href: "#learn" } }, styles: {} },
            { id: "features-1", type: "features", order: 3, visible: true, props: { title: "Features", features: [{ title: "Fast", description: "Quick", icon: "Zap" }, { title: "Secure", description: "Safe", icon: "Shield" }] }, styles: {} },
            { id: "pricing-1", type: "pricing", order: 4, visible: true, props: { title: "Pricing", subtitle: "Choose a plan", plans: [{ name: "Basic", price: "$10", cta: "Buy Basic", features: ["A"], highlighted: false, description: "Starter" }, { name: "Pro", price: "$50", cta: "Buy Pro", features: ["A", "B"], highlighted: true, description: "Advanced" }] }, styles: {} },
            { id: "cta-1", type: "cta", order: 5, visible: true, props: { headline: "CTA Title", ctaText: "Get It", ctaHref: "/buy" }, styles: {} },
            { id: "footer-1", type: "footer", order: 6, visible: true, props: { text: "© 2026 MyBrand", links: [{ text: "Privacy", href: "/privacy" }] }, styles: {} },
          ],
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    },
    warnings: [],
  };
}

async function openEditorWithWebsite(page: Page) {
  await createSaaSProjectAndOpenEditor(page);
  await page.route("**/api/generate", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockProject()) });
  });
  const textarea = page.locator('[data-testid="prompt-input"]');
  await textarea.fill("Test website");
  await page.keyboard.press("Enter");
  const preview = page.locator('[data-testid="preview-content"]');
  await expect(preview).toBeVisible({ timeout: 10000 });
  return preview;
}

test.describe("Canvas selection overlay (P22-B)", () => {
  test.beforeEach(async ({ page }) => {
    await openEditorWithWebsite(page);
  });

  test("clicking a section shows the selection box with dimensions", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const preview = page.locator('[data-testid="preview-content"]');
    await preview.getByText("Hero Title").click();

    const box = page.locator('[data-testid="canvas-selection-box"]');
    await expect(box).toBeVisible({ timeout: 5000 });
    // The box is bound to the selected section's stable element id.
    await expect(box).toHaveAttribute("data-element-id", "hero-1");
    await expect(page.locator('[data-testid="canvas-selection-dims"]')).toBeVisible();
    await expect(page.locator('[data-testid="canvas-selection-dims"]')).toContainText("×");

    // The existing section-level selection is still consistent.
    await expect(page.locator('[data-testid="selected-section"]')).toHaveCount(1);
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("Escape deselects the selected section", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const preview = page.locator('[data-testid="preview-content"]');
    // Click the section PADDING (not its text) so no inline-edit field grabs
    // focus — Escape then reaches the canvas keyboard layer.
    const hero = preview.locator('[data-testid="section-wrapper"]').filter({ hasText: "Hero Title" });
    await hero.click({ position: { x: 12, y: 12 } });
    await expect(page.locator('[data-testid="canvas-selection-box"]')).toBeVisible({ timeout: 5000 });

    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="canvas-selection-box"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="selected-section"]')).toHaveCount(0);
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("clicking empty canvas deselects", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const preview = page.locator('[data-testid="preview-content"]');
    await preview.getByText("Hero Title").click();
    await expect(page.locator('[data-testid="canvas-selection-box"]')).toBeVisible({ timeout: 5000 });

    // Click the editor chrome (outside the preview) — canvas background click.
    await page.locator('[data-testid="editor-root"]').click({ position: { x: 5, y: 5 }, force: true });
    await expect(page.locator('[data-testid="canvas-selection-box"]')).toHaveCount(0);
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("overlay duplicate action duplicates the section", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const preview = page.locator('[data-testid="preview-content"]');
    await preview.getByText("Hero Title").click();
    await expect(page.locator('[data-testid="canvas-selection-box"]')).toBeVisible({ timeout: 5000 });

    await page.locator('[data-testid="canvas-duplicate"]').click();
    await expect(preview.getByText("Hero Title")).toHaveCount(2, { timeout: 5000 });
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("overlay delete action removes the section", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const preview = page.locator('[data-testid="preview-content"]');
    await preview.getByText("Hero Title").click();
    await expect(page.locator('[data-testid="canvas-selection-box"]')).toBeVisible({ timeout: 5000 });

    await page.locator('[data-testid="canvas-delete"]').click();
    await expect(preview.getByText("Hero Title")).toHaveCount(0, { timeout: 5000 });
    // Established delete policy: selection moves to the nearest next section,
    // so the selection box persists — bound to the deleted section's neighbor.
    await expect(page.locator('[data-testid="canvas-selection-box"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="canvas-selection-box"]'),
    ).not.toHaveAttribute("data-element-id", "hero-1");
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("canvas shortcuts never fire while typing in the inspector", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const preview = page.locator('[data-testid="preview-content"]');
    await preview.getByText("Hero Title").click();
    await expect(page.locator('[data-testid="canvas-selection-box"]')).toBeVisible({ timeout: 5000 });

    const textarea = page.locator('[data-testid="inspector-panel"] textarea').first();
    await textarea.fill("Still typing");
    await textarea.focus();
    // Escape inside a text editor must NOT deselect the section.
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="selected-section"]')).toHaveCount(1);
    await expect(textarea).toHaveValue("Still typing");
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("arrow-key nudge is handled without errors", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const preview = page.locator('[data-testid="preview-content"]');
    await preview.getByText("Hero Title").click();
    await expect(page.locator('[data-testid="canvas-selection-box"]')).toBeVisible({ timeout: 5000 });

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    await page.waitForTimeout(300);
    // Selection survives nudging.
    await expect(page.locator('[data-testid="canvas-selection-box"]')).toBeVisible();
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
