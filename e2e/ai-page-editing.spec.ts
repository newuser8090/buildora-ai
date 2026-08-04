import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Deterministic plan-edit API mock
//
// The server's real rule-based planner is deterministic, but the plan-edit
// request embeds the full live project (random UUID section ids), so the
// mock derives the operation targets from the submitted project. Application
// itself runs through the REAL editor store (applyAiEditPlan → one history
// entry, one autosave schedule).
// ---------------------------------------------------------------------------

interface SectionLike {
  id: string;
  type: string;
  props: Record<string, unknown>;
}

interface PageLike {
  id: string;
  title: string;
  slug: string;
  sections: SectionLike[];
}

interface PlanEditRequestBody {
  mode?: string;
  instruction?: string;
  baseRevision?: number;
  scope?: unknown;
  project?: {
    id: string;
    pages: PageLike[];
  };
}

async function mockPlanApi(page: Page) {
  await page.route("**/api/generate", async (route) => {
    const body = JSON.parse(
      route.request().postData() ?? "{}",
    ) as PlanEditRequestBody;
    if (body.mode !== "plan-edit" || !body.project) {
      await route.continue();
      return;
    }

    const project = body.project;
    const home = project.pages.find((p) => p.slug === "/") ?? project.pages[0];
    const hero = home.sections.find((s) => s.type === "hero")!;
    const cta = home.sections.find((s) => s.type === "cta")!;
    const faq = home.sections.find((s) => s.type === "faq")!;
    const faqIndex = home.sections.findIndex((s) => s.id === faq.id);

    const plan = {
      version: 1,
      id: "plan-page-e2e",
      projectId: project.id,
      baseRevision: body.baseRevision,
      scope: body.scope,
      instruction: body.instruction,
      summary: "Planned 2 changes for the page.",
      operations: [
        {
          id: "op-1",
          type: "update-section-props",
          pageId: home.id,
          sectionId: hero.id,
          sectionType: "hero",
          label: "Rewrite hero copy",
          explanation:
            "Rewrites the hero headline and subheadline to be more concise.",
          risk: "medium",
          nextProps: {
            headline: "Build faster with Nimbus",
            subheadline: "Plan, build, and launch with confidence.",
            primaryCta: hero.props.primaryCta,
            secondaryCta: hero.props.secondaryCta,
          },
        },
        {
          id: "op-2",
          type: "move-section",
          pageId: home.id,
          sectionId: cta.id,
          targetIndex: faqIndex,
          label: "Move CTA above FAQ",
          explanation: "Moves the CTA section above the FAQ section.",
          risk: "low",
        },
      ],
      warnings: [],
      createdAt: new Date().toISOString(),
      provider: "rule-based",
    };

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, source: "rule-based", plan, warnings: [] }),
    });
  });
}

// ---------------------------------------------------------------------------
// Section position helpers — CTA vs FAQ vertical order in the preview
// ---------------------------------------------------------------------------

async function yPos(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Element not visible for position assertion");
  return box.y;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("AI page-scope editing", () => {
  test.beforeEach(async ({ page }) => {
    await createSaaSProjectAndOpenEditor(page);
  });

  test("page plan: review, diff, selective apply, undo/redo, persist", async ({
    page,
  }) => {
    const audit = attachRuntimeAudit(page);
    await mockPlanApi(page);

    // 1. Choose Page scope and submit the instruction.
    await page.locator('[data-testid="ai-scope-page"]').click();
    await page
      .locator('[data-testid="prompt-input"]')
      .fill("Make this page more concise and move the CTA above FAQ");
    await page.keyboard.press("Enter");

    // 2. Plan summary appears — never applied automatically.
    await expect(page.locator('[data-testid="plan-summary-card"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('[data-testid="plan-summary-card"]')).toContainText(
      "2 proposed changes",
    );

    // 3. Open the review panel and inspect the diff for the hero rewrite.
    await page.locator('[data-testid="review-plan-button"]').click();
    const review = page.locator('[data-testid="ai-plan-review"]');
    await expect(review).toBeVisible();
    await page
      .locator('[data-testid="plan-op-op-1"]')
      .getByLabel("Show diff")
      .click();
    await expect(review.getByText("Build faster with Nimbus")).toBeVisible();

    // 4. Deselect the hero rewrite; apply only the move.
    await page.locator('[data-testid="plan-op-checkbox-op-1"]').uncheck();
    await expect(page.locator('[data-testid="plan-selected-count"]')).toHaveText(
      "1",
    );
    await page.locator('[data-testid="plan-apply-selected"]').click();

    // 5. CTA now renders above the FAQ; the deselected hero rewrite was skipped.
    const preview = page.locator('[data-testid="preview-content"]');
    const ctaText = preview.getByText("Ready to build something great?");
    const faqText = preview.getByText("Can I try Nimbus before paying?");
    await expect(ctaText).toBeVisible();
    expect(await yPos(ctaText)).toBeLessThan(await yPos(faqText));
    await expect(
      preview.getByText("Ship your next product in days, not months"),
    ).toBeVisible();

    // Chat timeline reports the applied + skipped counts.
    await expect(
      page.locator('[data-testid="chat-message-assistant"]').last(),
    ).toContainText("Applied 1 change");

    // 6. One Undo restores the complete pre-plan page; one Redo reapplies.
    await page.locator('[data-testid="undo-button"]').click();
    expect(await yPos(ctaText)).toBeGreaterThan(await yPos(faqText));

    await page.locator('[data-testid="redo-button"]').click();
    await expect(page.locator('[data-testid="plan-summary-card"]')).toHaveCount(0);
    expect(await yPos(ctaText)).toBeLessThan(await yPos(faqText));

    // 7. Autosave (debounced) persists; reload keeps the applied result.
    await page.waitForTimeout(4500);
    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible();
    const ctaAfter = page
      .locator('[data-testid="preview-content"]')
      .getByText("Ready to build something great?");
    const faqAfter = page
      .locator('[data-testid="preview-content"]')
      .getByText("Can I try Nimbus before paying?");
    await expect(ctaAfter).toBeVisible();
    expect(await yPos(ctaAfter)).toBeLessThan(await yPos(faqAfter));

    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("stale plan is not applied after the project changes", async ({
    page,
  }) => {
    const audit = attachRuntimeAudit(page);
    await mockPlanApi(page);

    await page.locator('[data-testid="ai-scope-page"]').click();
    await page
      .locator('[data-testid="prompt-input"]')
      .fill("Make this page more concise and move the CTA above FAQ");
    await page.keyboard.press("Enter");

    await expect(page.locator('[data-testid="plan-summary-card"]')).toBeVisible({
      timeout: 10000,
    });
    await page.locator('[data-testid="review-plan-button"]').click();
    await expect(page.locator('[data-testid="ai-plan-review"]')).toBeVisible();

    // Mutate the project through a non-plan path (add a page) → revision
    // bumps, so the pending plan becomes stale.
    await page.locator('[data-testid="page-tab-add"]').click();
    await page.keyboard.press("Enter"); // accept the default page name
    await expect(page.getByRole("tab", { name: "Page: Untitled Page" })).toBeVisible();

    // Applying the old plan must be blocked with a stale banner.
    await page.locator('[data-testid="plan-apply-all"]').click();
    await expect(page.locator('[data-testid="plan-stale-banner"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page
        .locator('[data-testid="ai-plan-review"]')
        .getByText(/changed since the plan/i),
    ).toBeVisible();

    // Discard clears the stale plan.
    await page.locator('[data-testid="plan-discard"]').click();
    await expect(page.locator('[data-testid="ai-plan-review"]')).toHaveCount(0);

    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
