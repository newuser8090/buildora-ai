import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Mock project — same shape as editor.spec.ts
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
            { id: "header-1", type: "header", order: 1, visible: true, props: { logoText: "MyBrand", navLinks: [{ text: "Nav1", href: "/nav1" }], ctaText: "Get Started", ctaHref: "#cta" }, styles: {} },
            { id: "hero-1", type: "hero", order: 2, visible: true, props: { headline: "Hero Title", subheadline: "Hero sub", primaryCta: { text: "Start", href: "#start" }, secondaryCta: { text: "Learn", href: "#learn" } }, styles: {} },
            { id: "features-1", type: "features", order: 3, visible: true, props: { title: "Features", features: [{ title: "Fast", description: "Quick", icon: "Zap" }] }, styles: {} },
            { id: "footer-1", type: "footer", order: 6, visible: true, props: { text: "© 2026 MyBrand", links: [] }, styles: {} },
          ],
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    },
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// Route the API: create mode returns the mock project; modify mode returns a
// deterministic edit of the hero section.
// ---------------------------------------------------------------------------

async function mockApi(page: Page) {
  let lastModifyBody: string | undefined;
  await page.route("**/api/generate", async (route) => {
    const body = route.request().postData() ?? "{}";
    const parsed = JSON.parse(body);
    if (parsed.mode === "modify") {
      lastModifyBody = body;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          source: "rule-based",
          edits: [
            {
              type: "hero",
              props: {
                headline: "Playful Hero Title",
                subheadline: "Bright, friendly copy",
                primaryCta: { text: "Start", href: "#start" },
                secondaryCta: { text: "Learn", href: "#learn" },
              },
            },
          ],
          warnings: [],
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockProject()),
      });
    }
  });
  return { getLastModifyBody: () => lastModifyBody };
}

async function generateWebsite(page: Page) {
  const textarea = page.locator('[data-testid="prompt-input"]');
  await textarea.fill("Test website");
  await page.keyboard.press("Enter");
  const preview = page.locator('[data-testid="preview-content"]');
  await expect(preview).toBeVisible({ timeout: 10000 });
  return preview;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("AI editing", () => {
  test.beforeEach(async ({ page }) => {
    await createSaaSProjectAndOpenEditor(page);
  });

  test("edit chip appears when a section is selected", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await mockApi(page);
    const preview = await generateWebsite(page);
    await preview.getByText("Hero Title").click();
    await expect(page.locator('[data-testid="edit-target-chip"]')).toBeVisible();
    await expect(page.locator('[data-testid="edit-target-chip"]')).toContainText("Hero section");
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("editing a section sends a modify request and updates the preview", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const { getLastModifyBody } = await mockApi(page);
    const preview = await generateWebsite(page);

    await preview.getByText("Hero Title").click();
    await expect(page.locator('[data-testid="edit-target-chip"]')).toBeVisible();

    // Phase M: clicking a text element also selects an inline field, so the
    // composer routes to inline suggestions in auto mode. Explicitly choosing
    // the Section scope keeps the Phase K modify flow active.
    await page.locator('[data-testid="ai-scope-section"]').click();

    await page.locator('[data-testid="prompt-input"]').fill("Make it more playful");
    await page.keyboard.press("Enter");

    await expect(preview.getByText("Playful Hero Title")).toBeVisible({ timeout: 5000 });

    // The request was a modify request targeting the hero section
    const body = JSON.parse(getLastModifyBody() ?? "{}");
    expect(body.mode).toBe("modify");
    expect(body.target.kind).toBe("section");
    expect(body.target.type).toBe("hero");
    expect(body.target.sectionId).toBe("hero-1");
    expect(String(body.prompt)).toContain("playful");

    // The chat records the exchange with an edit summary
    await expect(
      page.locator('[data-testid="chat-message-assistant"]').last(),
    ).toContainText("Hero section");

    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("regenerate applies a default edit to the selected section", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const { getLastModifyBody } = await mockApi(page);
    const preview = await generateWebsite(page);

    await preview.getByText("Hero Title").click();
    await expect(page.locator('[data-testid="edit-target-chip"]')).toBeVisible();

    await page.locator('[data-testid="regenerate-section"]').click();

    await expect(preview.getByText("Playful Hero Title")).toBeVisible({ timeout: 5000 });

    const body = JSON.parse(getLastModifyBody() ?? "{}");
    expect(body.mode).toBe("modify");
    expect(String(body.prompt)).toContain("Rewrite this section");

    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
