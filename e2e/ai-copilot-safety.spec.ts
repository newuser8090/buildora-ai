import { test, expect } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";
import { mockCopilotPlanApi, openCopilot, sendCopilotMessage, expectPlanReview } from "./helpers/copilot";

// ---------------------------------------------------------------------------
// Phase P10 — FLOW C: safety. Malformed, malicious, and stale AI plans must
// fail safely: the user sees a beginner-safe error and the project is never
// corrupted or silently mutated.
// ---------------------------------------------------------------------------

const ORIGINAL_HEADLINE = "Ship your next product in days, not months";

test.describe("AI Copilot — FLOW C (safety)", () => {
  test("rejects a malformed plan whose target no longer exists", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    mockCopilotPlanApi(page, { badTarget: true });
    await createSaaSProjectAndOpenEditor(page);
    await openCopilot(page);

    await sendCopilotMessage(page, "Improve the hero");

    await expect(page.locator('[data-testid="copilot-error"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="copilot-error"]')).toContainText("no longer fits");

    // Nothing was applied — the original headline is intact and the mock
    // headline never appears.
    const preview = page.locator('[data-testid="preview-content"]');
    await expect(preview.getByText(ORIGINAL_HEADLINE)).toBeVisible();
    await expect(preview.getByText("Copilot Hero Headline")).toHaveCount(0);

    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("rejects a malicious plan carrying a javascript: href before it can execute", async ({
    page,
  }) => {
    const audit = attachRuntimeAudit(page);
    mockCopilotPlanApi(page, { maliciousHref: true });
    await createSaaSProjectAndOpenEditor(page);
    await openCopilot(page);

    await sendCopilotMessage(page, "Change the CTA");

    await expect(page.locator('[data-testid="copilot-error"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="copilot-error"]')).toContainText(
      "safety checks",
    );

    // The malicious href never reached the project or the page.
    const preview = page.locator('[data-testid="preview-content"]');
    await expect(preview.locator('a[href^="javascript:"]')).toHaveCount(0);
    await expect(preview.getByText(ORIGINAL_HEADLINE)).toBeVisible();

    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("a stale plan can be reviewed but never applied", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    mockCopilotPlanApi(page, { staleRevision: true });
    await createSaaSProjectAndOpenEditor(page);
    await openCopilot(page);

    // The plan is still shown for review…
    await sendCopilotMessage(page, "Improve the hero");
    await expectPlanReview(page);

    // …but applying it fails the revision guard with a beginner error.
    await page.locator('[data-testid="copilot-apply"]').click();
    await expect(page.locator('[data-testid="copilot-error"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="copilot-error"]')).toContainText(
      "changed before the suggestion could be applied",
    );

    const preview = page.locator('[data-testid="preview-content"]');
    await expect(preview.getByText(ORIGINAL_HEADLINE)).toBeVisible();
    await expect(preview.getByText("Copilot Hero Headline")).toHaveCount(0);

    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
