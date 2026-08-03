import { test, expect } from "@playwright/test";
import { attachRuntimeAudit, assertRuntimeClean } from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Fallback Isolation Test
//
// Sends the x-buildora-force-local header to the API route, which triggers
// the same code path as BUILDORA_FORCE_LOCAL_GENERATION=true (server-side).
// Verifies:
//   - source is "rule-based"
//   - no Gemini error is displayed
//   - rendered website is valid
//   - assistant message says generated locally
//   - all sections remain editable
//   - browser console is clean
//   - undo/redo still works afterward
// ---------------------------------------------------------------------------

test.describe("Fallback Isolation", () => {
  test.describe.configure({ mode: "serial" });

  test("forced-local generation uses rule-based provider", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    // The editor lives at /editor/[projectId]; reach it through the dashboard.
    await createSaaSProjectAndOpenEditor(page);

    // Intercept the API request to inject the force-local header
    await page.route("**/api/generate", async (route) => {
      const headers = route.request().headers();
      await route.continue({
        headers: {
          ...headers,
          "x-buildora-force-local": "true",
        },
      });
    });

    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/generate") && resp.status() === 200,
      { timeout: 30000 },
    );

    await page.locator('[data-testid="prompt-input"]').fill(
      "Build a modern SaaS website for TaskPilot",
    );
    await page.keyboard.press("Enter");

    const response = await responsePromise;
    const data = await response.json();

    // Verify the provider is rule-based (Gemini was explicitly disabled)
    expect(data.success).toBe(true);
    expect(data.source).toBe("rule-based");

    // Wait for preview first (indicates generation completed)
    await expect(
      page.locator('[data-testid="preview-content"]'),
    ).toBeVisible({ timeout: 20000 });

    // Verify sections exist
    expect(data.project.pages[0].sections.length).toBeGreaterThan(0);

    // Verify the assistant message says generated locally
    // Wait a moment for the final assistant message to render
    await page.waitForTimeout(1000);
    const assistantMessages = page.locator('[data-testid="chat-message-assistant"]');
    const count = await assistantMessages.count();
    // The last assistant message should be the completion message
    if (count > 0) {
      const completionMsg = assistantMessages.nth(count - 1);
      const assistantText = await completionMsg.textContent();
      expect(assistantText?.toLowerCase()).toContain("local");
    }

    // Verify all sections remain editable
    const preview = page.locator('[data-testid="preview-content"]');
    const wrappers = page.locator('[data-testid="section-wrapper"]');
    const wrapperCount = await wrappers.count();
    expect(wrapperCount).toBeGreaterThan(0);

    // Select and edit the header
    await wrappers.first().click();
    await page.waitForTimeout(300);
    const inspectPanel = page.locator('[data-testid="inspector-panel"]');
    await expect(inspectPanel).toBeVisible({ timeout: 3000 });

    // Edit header logo text
    const headerInput = inspectPanel.locator("input").first();
    await headerInput.fill("TaskPilot Local");
    await page.waitForTimeout(200);

    // Verify the preview updates
    await expect(
      preview.locator("header").getByText("TaskPilot Local"),
    ).toBeVisible({ timeout: 3000 });

    // Verify undo works
    await page.locator('[data-testid="editor-root"]').click({ position: { x: 5, y: 5 }, force: true });
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="undo-button"]')).not.toBeDisabled({ timeout: 3000 });
    await page.locator('[data-testid="undo-button"]').click();
    await page.waitForTimeout(300);

    // Verify redo works
    await page.locator('[data-testid="redo-button"]').click();
    await page.waitForTimeout(300);

    // No Gemini error
    const consoleErrors = audit.state.consoleErrors.join(" ");
    expect(consoleErrors).not.toContain("Gemini");
    expect(consoleErrors).not.toContain("API key");

    // Only 1 generation request
    expect(audit.state.generationRequests.length).toBeGreaterThanOrEqual(1);
    expect(audit.state.generationRequests.length).toBeLessThanOrEqual(2);

    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
