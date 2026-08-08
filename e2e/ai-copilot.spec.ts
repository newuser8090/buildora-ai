import { test, expect } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
  assertNoGenerationRequests,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";
import { mockCopilotPlanApi, openCopilot, sendCopilotMessage, expectPlanReview } from "./helpers/copilot";

// ---------------------------------------------------------------------------
// Phase P10 — FLOW A: Copilot edit, review, apply, undo.
// The plan-edit API is mocked with a deterministic plan; all client-side
// validation, application and history are real.
// ---------------------------------------------------------------------------

const ORIGINAL_HEADLINE = "Ship your next product in days, not months";

test.describe("AI Copilot — entry points and scope", () => {
  test("opens from the TopNav with the current-page scope indicator", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await createSaaSProjectAndOpenEditor(page);

    await openCopilot(page);
    await expect(page.locator('[data-testid="copilot-scope-badge"]')).toContainText("Homepage");

    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("opens with the Ctrl+Shift+A shortcut", async ({ page }) => {
    await createSaaSProjectAndOpenEditor(page);
    await page.keyboard.press("Control+Shift+A");
    await expect(page.locator('[data-testid="copilot-panel"]')).toBeVisible();
  });

  test("Escape closes the panel", async ({ page }) => {
    await createSaaSProjectAndOpenEditor(page);
    await openCopilot(page);
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="copilot-panel"]')).toBeHidden();
  });
});

test.describe("AI Copilot — ask mode", () => {
  test("answers a readiness question without calling the provider", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await createSaaSProjectAndOpenEditor(page);
    await openCopilot(page);

    // Deterministic readiness-review starter — no provider needed.
    await page
      .locator('[data-testid="copilot-starter-check-this-page-for-obvious-problems"]')
      .click();

    await expect(page.locator('[data-testid="copilot-msg-assistant"]').last()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('[data-testid="copilot-msg-assistant"]').last()).toContainText(
      "score",
    );

    // ASK mode must not reach the provider.
    assertNoGenerationRequests(audit.state);
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});

test.describe("AI Copilot — FLOW A (plan → approve → apply → undo)", () => {
  test("plans an edit, reviews it, applies it atomically, and undoes it", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const { getRequest } = mockCopilotPlanApi(page);
    await createSaaSProjectAndOpenEditor(page);
    await openCopilot(page);

    // 1. Request an edit.
    await sendCopilotMessage(page, "Rewrite the hero headline");

    // 2. Review the plan before anything is applied.
    await expectPlanReview(page);
    await expect(page.locator('[data-testid="copilot-plan-review"]')).toContainText(
      "AI suggests 1 change",
    );

    // 3. The request went to the planner with the resolved scope.
    const first = JSON.parse(getRequest(0) ?? "{}");
    expect(first.mode).toBe("plan-edit");
    expect(String(first.instruction)).toContain("Rewrite the hero headline");

    // 4. Apply the approved plan.
    await page.locator('[data-testid="copilot-apply"]').click();

    // 5. Change summary + the website really changed.
    await expect(page.locator('[data-testid="copilot-change-summary"]')).toContainText(
      "Done — updated 1 thing",
    );
    const preview = page.locator('[data-testid="preview-content"]');
    await expect(preview.getByText("Copilot Hero Headline")).toBeVisible({ timeout: 5000 });
    await expect(preview.getByText(ORIGINAL_HEADLINE)).toHaveCount(0);

    // 6. Undo restores the previous state through the normal history.
    await page.locator('[data-testid="copilot-undo"]').click();
    await expect(preview.getByText(ORIGINAL_HEADLINE)).toBeVisible({ timeout: 5000 });
    await expect(preview.getByText("Copilot Hero Headline")).toHaveCount(0);

    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
