import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
  assertGenerationRequests,
  assertNoGenerationRequests,
  assertNoFailedRequests,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Shared mock project builder
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

async function mockApi(page: Page) {
  await page.route("**/api/generate", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockProject()) });
  });
}

async function generateWebsite(page: Page) {
  await mockApi(page);
  const textarea = page.locator('[data-testid="prompt-input"]');
  await textarea.fill("Test website");
  await page.keyboard.press("Enter");
  const preview = page.locator('[data-testid="preview-content"]');
  await expect(preview).toBeVisible({ timeout: 10000 });
  return preview;
}

// ---------------------------------------------------------------------------
// Open the editor through the real dashboard flow (shared helper)
//
// The editor lives at /editor/[projectId]; the dashboard (/) creates projects
// from templates and navigates there on success. Every test gets a fresh
// browser context (empty IndexedDB), so we create a project from the SaaS
// template each time.
// ---------------------------------------------------------------------------

async function openEditor(page: Page): Promise<void> {
  await createSaaSProjectAndOpenEditor(page);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Editor basic", () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
  });

  test("empty editor renders without page overflow", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible();
    const ox = await page.evaluate(() => getComputedStyle(document.body).overflowX);
    const oy = await page.evaluate(() => getComputedStyle(document.body).overflowY);
    expect(ox).toBe("hidden");
    expect(oy).toBe("hidden");
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("greeting is visible", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await expect(page.locator('[data-testid="ai-sidebar"]').getByText("Hi! I'm Buildora.")).toBeVisible();
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("example prompt populates", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await page.locator('[data-testid="ai-sidebar"]').getByText(/Create a landing page/i).click();
    await expect(page.locator('[data-testid="prompt-input"]')).toHaveValue(/Create a landing page/i);
    await expect(page.locator('[data-testid="prompt-input"]')).toBeFocused();
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("Enter submits", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await page.locator('[data-testid="prompt-input"]').fill("Test");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-testid="prompt-input"]')).toHaveValue("");
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("Shift+Enter inserts newline", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const ta = page.locator('[data-testid="prompt-input"]');
    await ta.focus();
    await page.keyboard.type("Line 1");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("Line 2");
    expect(await ta.inputValue()).toContain("\n");
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("one submission creates one generation request", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await page.route("**/api/generate", async (route) => { await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockProject()) }); });
    await page.locator('[data-testid="prompt-input"]').fill("Test");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    assertGenerationRequests(audit.state, 1);
    assertNoFailedRequests(audit.state);
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("generation progress appears", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await page.route("**/api/generate", () => new Promise(() => {}));
    await page.locator('[data-testid="prompt-input"]').fill("Test");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-testid="generation-progress"]')).toBeVisible({ timeout: 5000 });
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("no object-as-React-child error", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await generateWebsite(page);
    await page.waitForTimeout(1500);
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("no console errors at startup", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await page.waitForTimeout(500);
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("long prompt does not crash", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await page.locator('[data-testid="prompt-input"]').fill("Build a website. ".repeat(500));
    await expect(page.locator('[data-testid="prompt-input"]')).toHaveValue(/Build a website/);
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});

test.describe("Editor sections", () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
  });

  test("Hero section can be selected", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const preview = await generateWebsite(page);
    await preview.getByText("Hero Title").click();
    await expect(page.locator('[data-testid="selected-section"]')).toBeVisible();
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("Hero headline can be edited", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const preview = await generateWebsite(page);
    await preview.getByText("Hero Title").click();
    await page.locator('[data-testid="inspector-panel"] textarea').first().fill("New Hero");
    await expect(preview.getByText("New Hero")).toBeVisible({ timeout: 3000 });
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("visibility toggle hides section", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const preview = await generateWebsite(page);
    await preview.getByText("Hero Title").click();
    await page.locator('[data-testid="inspector-panel"] [role="switch"]').first().click();
    await page.waitForTimeout(300);
    await expect(preview.getByText("Hero Title")).not.toBeVisible({ timeout: 3000 });
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("Header navigation text can be edited", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const preview = await generateWebsite(page);
    await page.locator('[data-testid="section-wrapper"]').first().click();
    await expect(page.locator('[data-testid="inspector-panel"]')).toBeVisible();
    const inputs = page.locator('[data-testid="inspector-panel"] input');
    await inputs.nth(1).fill("EditedNav");
    await expect(preview.locator("header").getByText("EditedNav")).toBeVisible({ timeout: 3000 });
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("Header nav href can be edited", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await generateWebsite(page);
    await page.locator('[data-testid="section-wrapper"]').first().click();
    await expect(page.locator('[data-testid="inspector-panel"]')).toBeVisible();
    const hrefInput = page.locator('[data-testid="inspector-panel"] input').nth(2);
    await hrefInput.fill("/edited-path");
    await expect(hrefInput).toHaveValue("/edited-path");
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("Footer link text can be edited", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const preview = await generateWebsite(page);
    const footerSection = preview
      .locator('[data-testid="section-wrapper"]')
      .filter({ hasText: "© 2026 MyBrand" });

    await footerSection.scrollIntoViewIfNeeded();
    await footerSection.click({ force: true });
    await expect(page.locator('[data-testid="inspector-panel"]')).toBeVisible();
    const linkInput = page.locator('[data-testid="inspector-panel"] input').nth(1);
    await linkInput.fill("EditedLink");
    await expect(preview.getByText("EditedLink")).toBeVisible({ timeout: 3000 });
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("Footer link href can be edited", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const preview = await generateWebsite(page);

    const footerSection = preview
      .locator('[data-testid="section-wrapper"]')
      .filter({ hasText: "© 2026 MyBrand" });

    await footerSection.scrollIntoViewIfNeeded();
    await footerSection.click({ force: true });
    const hrefInput = page.locator('[data-testid="inspector-panel"] input').nth(2);
    await hrefInput.fill("/edited-href");
    await expect(hrefInput).toHaveValue("/edited-href");
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("delete section works", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const preview = await generateWebsite(page);
    const wrappers = page.locator('[data-testid="section-wrapper"]');
    await wrappers.nth(2).click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid="inspector-panel"]').getByText("Delete").click();
    await page.waitForTimeout(500);
    await expect(preview.getByText("Features").first()).not.toBeVisible({ timeout: 3000 });
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("selection clears after delete", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await generateWebsite(page);
    const wrappers = page.locator('[data-testid="section-wrapper"]');
    await wrappers.nth(2).click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid="inspector-panel"]').getByText("Delete").click();
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="selected-section"]')).toHaveCount(0, { timeout: 3000 });
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("duplicate creates unique section ID", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const preview = await generateWebsite(page);
    await preview.getByText("Hero Title").click();
    await page.locator('[data-testid="duplicate-section"]').click();
    await expect(preview.getByText("Hero Title")).toHaveCount(2, { timeout: 3000 });
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("Pricing CTA can be edited", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const preview = await generateWebsite(page);
    const wrappers = page.locator('[data-testid="section-wrapper"]');
    await wrappers.nth(3).click();
    await page.waitForTimeout(200);
    const ctaInput = page.locator('[data-testid="inspector-panel"] input[value="Buy Basic"]');
    await ctaInput.fill("New CTA");
    await expect(preview.getByText("New CTA")).toBeVisible({ timeout: 3000 });
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("undo restores previous state", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const preview = await generateWebsite(page);
    await preview.getByText("Hero Title").click();
    await page.locator('[data-testid="inspector-panel"] textarea').first().fill("Changed Title");
    await expect(preview.getByText("Changed Title")).toBeVisible({ timeout: 3000 });
    await page.locator('[data-testid="editor-root"]').click({ position: { x: 5, y: 5 }, force: true });
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="undo-button"]')).not.toBeDisabled({ timeout: 3000 });
    await page.locator('[data-testid="undo-button"]').click();
    await page.waitForTimeout(300);
    await expect(preview.getByText("Hero Title")).toBeVisible({ timeout: 3000 });
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("redo reapplies state after undo", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const preview = await generateWebsite(page);
    await preview.getByText("Hero Title").click();
    await page.locator('[data-testid="inspector-panel"] textarea').first().fill("Redo Title");
    await expect(preview.getByText("Redo Title")).toBeVisible({ timeout: 3000 });
    await page.locator('[data-testid="editor-root"]').click({ position: { x: 5, y: 5 }, force: true });
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="undo-button"]')).not.toBeDisabled({ timeout: 3000 });
    await page.locator('[data-testid="undo-button"]').click();
    await page.waitForTimeout(300);
    await expect(preview.getByText("Hero Title")).toBeVisible({ timeout: 3000 });
    await page.locator('[data-testid="redo-button"]').click();
    await page.waitForTimeout(300);
    await expect(preview.getByText("Redo Title")).toBeVisible({ timeout: 3000 });
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});

test.describe("Viewport and zoom", () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
  });

  test("desktop viewport sets CSS width to 1440px", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await generateWebsite(page);
    await page.locator('[data-testid="viewport-desktop"]').click();
    await page.waitForTimeout(200);
    const style = await page.locator('[data-testid="preview-frame"]').getAttribute("style");
    expect(style).toContain("1440px");
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("tablet viewport sets width to 768px", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await generateWebsite(page);
    await page.locator('[data-testid="viewport-tablet"]').click();
    await page.waitForTimeout(200);
    const style = await page.locator('[data-testid="preview-frame"]').getAttribute("style");
    expect(style).toContain("768px");
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("mobile viewport sets width to 390px", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await generateWebsite(page);
    await page.locator('[data-testid="viewport-mobile"]').click();
    await page.waitForTimeout(200);
    const style = await page.locator('[data-testid="preview-frame"]').getAttribute("style");
    expect(style).toContain("390px");
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("zoom 75% scales preview", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await generateWebsite(page);
    const preview = page.locator('[data-testid="preview-frame"]');
    const initial = await preview.evaluate((el: HTMLElement) => el.getBoundingClientRect().width);
    await page.locator('[data-testid="zoom-control"]').selectOption("75");
    await page.waitForTimeout(200);
    const after = await preview.evaluate((el: HTMLElement) => el.getBoundingClientRect().width);
    expect(after).toBeLessThan(initial);
    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("viewport buttons present and clickable", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await expect(page.locator('[data-testid="viewport-desktop"]')).toBeVisible();
    await expect(page.locator('[data-testid="viewport-tablet"]')).toBeVisible();
    await expect(page.locator('[data-testid="viewport-mobile"]')).toBeVisible();
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});

test.describe("Chat and history", () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
  });

  test("chat history persists after regenerating", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    let callCount = 0;
    await page.route("**/api/generate", async (route) => {
      callCount++;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockProject()) });
    });

    await page.locator('[data-testid="prompt-input"]').fill("First");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);

    const firstAssistantContent = await page.locator('[data-testid="chat-message-assistant"]').first().textContent();

    await page.locator('[data-testid="prompt-input"]').fill("Second");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);

    await expect(page.locator('[data-testid="chat-message-user"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="chat-message-assistant"]')).toHaveCount(2);
    const firstAfterSecond = await page.locator('[data-testid="chat-message-assistant"]').first().textContent();
    expect(firstAfterSecond).toBe(firstAssistantContent);
    expect(callCount).toBe(2);
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});

// ---------------------------------------------------------------------------
// API key exposure check
// ---------------------------------------------------------------------------

test.describe("Security", () => {
  test("API key is not exposed client-side", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await openEditor(page);

    // Check page HTML source
    const html = await page.content();
    const keyIndicators = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "AIzaSy"];
    for (const indicator of keyIndicators) {
      expect(html).not.toContain(indicator);
    }

    // Check JavaScript bundles by evaluating
    const allScripts = await page.evaluate(() => {
      const scripts = document.querySelectorAll("script");
      return Array.from(scripts).map((s) => s.textContent || "").join(" ");
    });
    // The key value itself is a base64-looking string
    expect(allScripts).not.toContain("GEMINI_API_KEY");

    // Check localStorage and sessionStorage
    const storageKeys: string[] = await page.evaluate(() => {
      return [...Object.keys(localStorage), ...Object.keys(sessionStorage)];
    });
    for (const key of storageKeys) {
      expect(key.toLowerCase()).not.toContain("api_key");
      expect(key.toLowerCase()).not.toContain("gemini");
    }

    // Trigger a generation and capture request details
    let capturedBody: string | undefined;
    let capturedUrl: string | undefined;
    await page.route("**/api/generate", async (route) => {
      capturedBody = route.request().postData() ?? undefined;
      capturedUrl = route.request().url();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockProject()) });
    });

    await page.locator('[data-testid="prompt-input"]').fill("Security test");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);

    // Request body should only contain the prompt, not the API key
    if (capturedBody) {
      expect(capturedBody).not.toContain("GEMINI_API_KEY");
      expect(capturedBody).not.toContain("AIza");
      // Request body should contain the prompt
      expect(capturedBody).toContain("Security test");
    }
    // Request URL should not contain the API key
    if (capturedUrl) {
      expect(capturedUrl).not.toContain("GEMINI_API_KEY");
      expect(capturedUrl).not.toContain("AIzaSy");
      expect(capturedUrl).not.toContain("key=");
    }

    assertRuntimeClean(audit.state);
    audit.detach();
  });
});

// ---------------------------------------------------------------------------
// Inspector typing does not trigger generation requests
// ---------------------------------------------------------------------------

test.describe("Editor network isolation", () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
  });

  test("no generation request during inspector editing", async ({ page }) => {
    const audit = attachRuntimeAudit(page);

    // Mock API and generate website
    await page.route("**/api/generate", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockProject()) });
    });

    await page.locator('[data-testid="prompt-input"]').fill("Test");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);

    // Now remove the route so real requests would be observable
    await page.unroute("**/api/generate");

    // Reset generation request count — we only care about requests during editing
    audit.state.generationRequests.length = 0;

    const preview = page.locator('[data-testid="preview-content"]');
    await expect(preview).toBeVisible();

    // Edit Hero headline - should NOT trigger API request
    await preview.getByText("Hero Title").click();
    await page.locator('[data-testid="inspector-panel"] textarea').first().fill("Edited Hero");
    await page.waitForTimeout(500);

    // Edit Header nav text
    await page.locator('[data-testid="section-wrapper"]').first().click();
    const inputs = page.locator('[data-testid="inspector-panel"] input');
    await inputs.nth(1).fill("New Nav");
    await page.waitForTimeout(500);

    // Edit Footer link href
    const wrappers = page.locator('[data-testid="section-wrapper"]');
    await wrappers.nth(await wrappers.count() - 1).click();
    const hrefInput = page.locator('[data-testid="inspector-panel"] input').nth(2);
    await hrefInput.fill("/new-href");
    await page.waitForTimeout(500);

    // Toggle visibility
    await wrappers.nth(1).click();
    await page.locator('[data-testid="inspector-panel"] [role="switch"]').first().click();
    await page.waitForTimeout(300);

    // Undo/Redo
    await page.locator('[data-testid="editor-root"]').click({ position: { x: 5, y: 5 }, force: true });
    await page.waitForTimeout(300);
    const undoBtn = page.locator('[data-testid="undo-button"]');
    if (await undoBtn.isEnabled()) {
      await undoBtn.click();
      await page.waitForTimeout(300);
    }
    const redoBtn = page.locator('[data-testid="redo-button"]');
    if (await redoBtn.isEnabled()) {
      await redoBtn.click();
      await page.waitForTimeout(300);
    }

    // No generation requests should have occurred during editing
    assertNoGenerationRequests(audit.state);
    assertNoFailedRequests(audit.state);
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});

// ---------------------------------------------------------------------------
// Real pipeline test (generation succeeds)
// ---------------------------------------------------------------------------

test.describe("Real pipeline", () => {
  test("generation succeeds with available provider", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await openEditor(page);

    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/generate") && resp.status() === 200,
      { timeout: 30000 }
    );

    await page.locator('[data-testid="prompt-input"]').fill("Build a modern SaaS website for TaskPilot");
    await page.keyboard.press("Enter");

    const response = await responsePromise;
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(["gemini", "rule-based"]).toContain(data.source);
    expect(data.project.pages[0].sections.length).toBeGreaterThan(0);

    await expect(page.locator('[data-testid="preview-content"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="chat-message-assistant"]').first()).toBeVisible({ timeout: 5000 });

    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
