import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Deterministic plan-edit API mock (Phase P10)
//
// The Copilot plans through the existing /api/generate plan-edit mode. E2E
// intercepts it and returns a deterministic, schema-valid plan derived from
// the request's own project payload (section ids are template-generated, so
// the mock derives them from the live project). Every plan is validated by
// the real client (re-simulation + security scan) before it is shown.
// ---------------------------------------------------------------------------

export interface CopilotPlanMockOptions {
  /** Choose the new hero headline per request (1-based request index). */
  headlineFor?: (instruction: string, index: number) => string;
  /** Return a plan targeting a section that does not exist. */
  badTarget?: boolean;
  /** Return a plan with a javascript: href (must be rejected client-side). */
  maliciousHref?: boolean;
  /** Return a plan whose baseRevision is older than the editor revision. */
  staleRevision?: boolean;
}

/** Minimal shape of a plan-edit request body (only fields the mock reads). */
interface PlanEditMockBody {
  mode?: string;
  instruction?: string;
  baseRevision?: number;
  selectedPageId?: string;
  scope?: { type: string; pageId?: string };
  project?: {
    id?: string;
    pages?: Array<{
      id: string;
      sections?: Array<{
        id: string;
        type: string;
        props: Record<string, unknown>;
      }>;
    }>;
  };
}

export function mockCopilotPlanApi(page: Page, options: CopilotPlanMockOptions = {}) {
  const requests: string[] = [];
  let callIndex = 0;

  void page.route("**/api/generate", async (route) => {
    const body = route.request().postData() ?? "{}";
    const parsed = JSON.parse(body) as PlanEditMockBody;

    // Only plan-edit is mocked — everything else passes through.
    if (parsed.mode !== "plan-edit") {
      await route.continue();
      return;
    }

    requests.push(body);
    callIndex += 1;

    const project = parsed.project ?? {};
    const pages = project.pages ?? [];
    const scope = parsed.scope ?? { type: "project" };
    const pageId =
      scope.type === "page"
        ? (scope.pageId ?? pages[0]?.id)
        : (parsed.selectedPageId ?? pages[0]?.id);
    const targetPage = pages.find((p) => p.id === pageId) ?? pages[0];
    const hero =
      targetPage?.sections?.find((s) => s.type === "hero") ??
      targetPage?.sections?.[0];

    const nextProps = hero ? JSON.parse(JSON.stringify(hero.props)) : {};
    if (options.maliciousHref) {
      nextProps.primaryCta = { text: "Go", href: "javascript:alert(1)" };
    } else {
      nextProps.headline =
        options.headlineFor?.(parsed.instruction ?? "", callIndex) ?? "Copilot Hero Headline";
    }

    const baseRevision = options.staleRevision
      ? Math.max(0, (parsed.baseRevision ?? 1) - 1)
      : parsed.baseRevision;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        source: "rule-based",
        warnings: [],
        plan: {
          version: 1,
          id: `e2e-plan-${callIndex}`,
          projectId: project.id,
          baseRevision,
          scope: { type: "page", pageId: targetPage?.id },
          instruction: parsed.instruction,
          summary: "One proposed change",
          operations: [
            {
              id: "op-1",
              type: "update-section-props",
              pageId: targetPage?.id,
              sectionId: options.badTarget ? "ghost-section" : hero?.id,
              sectionType: hero?.type ?? "hero",
              label: "Rewrite hero headline",
              explanation: "Updates the hero headline.",
              risk: "low",
              nextProps,
            },
          ],
          warnings: [],
          createdAt: new Date().toISOString(),
          provider: "rule-based",
        },
      }),
    });
  });

  return {
    getRequests: () => requests,
    getRequest: (index: number) => (index < requests.length ? requests[index] : undefined),
  };
}

// ---------------------------------------------------------------------------
// Panel helpers
// ---------------------------------------------------------------------------

/** Open the Copilot panel from the TopNav entry point. */
export async function openCopilot(page: Page): Promise<void> {
  await page.locator('[data-testid="topnav-copilot-button"]').click();
  await expect(page.locator('[data-testid="copilot-panel"]')).toBeVisible();
}

/** Send a message through the Copilot composer. */
export async function sendCopilotMessage(page: Page, text: string): Promise<void> {
  const input = page.locator('[data-testid="copilot-input"]');
  await input.fill(text);
  await input.press("Enter");
}

/** Wait for the plan review to appear. */
export async function expectPlanReview(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="copilot-plan-review"]')).toBeVisible({
    timeout: 10000,
  });
}
