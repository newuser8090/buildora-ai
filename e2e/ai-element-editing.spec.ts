import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";
import { openCopilot, sendCopilotMessage, expectPlanReview } from "./helpers/copilot";

// ---------------------------------------------------------------------------
// Phase P22-H — Element AI editing (E2E)
//
// A mocked generate response seeds a project whose home page carries a
// CUSTOM-BLOCK section (the durable element-tree surface) with a heading and
// a button. The plan-edit API is mocked with a deterministic, schema-valid,
// element-scoped plan derived from the request's own project payload — no
// live Gemini, offline-safe (matches the existing ai-* spec conventions).
//
// Coverage:
//   1. full inspector flow — select a renderable element (build tree), open
//      the element AI entry, confirm the request is element-scoped with
//      pageId + sectionId + elementId, review the element op/diff, apply,
//      verify the canvas, persist across save+reload, undo/redo
//   2. animation — an element animation edit planned through the SAME model
//      survives through the existing P22-G renderer (no new runtime) and
//      persists
//   3. copilot — with an element selected, the copilot resolves element scope
//      and applies an element plan (element-context behavior)
//
// One Playwright-managed dev server (workers=1 via playwright.config).
// ---------------------------------------------------------------------------

const SECTION_ID = "cb-hero";
const ROOT_ID = SECTION_ID; // custom-block trees are re-rooted to the section id
const HEADING_ID = "head";
const BUTTON_ID = "btn";
const ORIGINAL_HEADING = "Animated heading";

function mockProject(projectId: string) {
  return {
    success: true,
    source: "rule-based",
    project: {
      id: projectId,
      name: "Test — Element AI",
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
                name: "Element AI block",
                tree: {
                  rootIds: [ROOT_ID],
                  nodes: {
                    [ROOT_ID]: {
                      id: ROOT_ID,
                      type: "container",
                      parentId: null,
                      children: [HEADING_ID, BUTTON_ID],
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
                      props: { text: ORIGINAL_HEADING, level: 2 },
                      style: {},
                      responsive: {},
                      visible: true,
                      locked: false,
                      hidden: false,
                    },
                    [BUTTON_ID]: {
                      id: BUTTON_ID,
                      type: "button",
                      parentId: ROOT_ID,
                      children: [],
                      props: { text: "Go", href: "#features" },
                      style: {},
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

// ---------------------------------------------------------------------------
// Deterministic plan-edit API mock
//
// CREATE mode returns the mocked custom-block project. PLAN-EDIT mode derives
// a schema-valid ELEMENT-scoped plan from the request's own project payload
// (the section/tree node ids are live) and its instruction:
//   - "bold"                 → update-element-style  (fontWeight 700)
//   - fade/animate           → update-element-animation (fade on load)
//   - hover                  → update-element-interaction (hover highlight)
//   - anything else          → update-element-props  (rewrite the heading text)
// Application runs through the REAL editor store (applyAiEditPlan → one
// history entry, one autosave schedule).
// ---------------------------------------------------------------------------

interface ElementPlanRequestBody {
  mode?: string;
  instruction?: string;
  baseRevision?: number;
  scope?: { type: string; pageId?: string; sectionId?: string; elementId?: string };
  project?: {
    id: string;
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

function elementOperationFor(
  body: ElementPlanRequestBody,
  callIndex: number,
): Record<string, unknown> {
  const scope = body.scope ?? { type: "element" };
  const pageId = scope.pageId ?? "page-1";
  const sectionId = scope.sectionId ?? SECTION_ID;
  const elementId = scope.elementId ?? HEADING_ID;
  const instruction = body.instruction ?? "";

  const base = {
    id: `op-${callIndex}`,
    pageId,
    sectionId,
    elementId,
  };

  if (/bold|bolder|heavier/i.test(instruction)) {
    return {
      ...base,
      type: "update-element-style",
      label: "Make element bold",
      explanation: "Sets a bold font weight on the selected element.",
      risk: "low",
      style: { fontWeight: 700 },
    };
  }
  if (/fade|animate|animation/i.test(instruction)) {
    return {
      ...base,
      type: "update-element-animation",
      label: "Animate element (fade on load)",
      explanation: "Adds a fade entrance animation that plays when the page loads.",
      risk: "low",
      animation: { trigger: "load", type: "fade", durationMs: 600, easing: "ease" },
    };
  }
  if (/hover/i.test(instruction)) {
    return {
      ...base,
      type: "update-element-interaction",
      label: "Add hover highlight",
      explanation: "Highlights the element when the pointer hovers over it.",
      risk: "low",
      interaction: { hover: { backgroundColor: "#dc2626", color: "#ffffff" } },
    };
  }
  return {
    ...base,
    type: "update-element-props",
    label: "Rewrite element text",
    explanation: "Rewrites the selected element's text content.",
    risk: "low",
    props: { text: "AI Element Headline" },
  };
}

async function mockApi(page: Page, projectId: string) {
  const planRequests: string[] = [];
  let callIndex = 0;
  await page.route("**/api/generate", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as ElementPlanRequestBody;

    // Plan-edit is mocked deterministically; every other mode is the project
    // seed (offline-safe — no live provider traffic in these tests).
    if (body.mode === "plan-edit" && body.project) {
      planRequests.push(JSON.stringify(body));
      callIndex += 1;
      const scope = body.scope ?? { type: "element" };
      const plan = {
        version: 1,
        id: `e2e-element-plan-${callIndex}`,
        projectId: body.project.id,
        baseRevision: body.baseRevision,
        scope: {
          type: "element",
          pageId: scope.pageId,
          sectionId: scope.sectionId,
          elementId: scope.elementId,
        },
        instruction: body.instruction,
        summary: "Planned 1 change for the selected element.",
        operations: [elementOperationFor(body, callIndex)],
        warnings: [],
        createdAt: new Date().toISOString(),
        provider: "rule-based",
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, source: "rule-based", plan, warnings: [] }),
      });
      return;
    }

    // The mocked generate response REPLACES the created project, so it must
    // carry the SAME id — otherwise the editor URL points at a project whose
    // record never receives the save, and reload restores the template.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockProject(projectId)),
    });
  });
  return { getPlanRequest: (index: number) => planRequests[index] };
}

async function openProject(page: Page) {
  const projectId = await createSaaSProjectAndOpenEditor(page);
  const api = await mockApi(page, projectId);
  const textarea = page.locator('[data-testid="prompt-input"]');
  await textarea.fill("Element AI website");
  await page.keyboard.press("Enter");
  const preview = page.locator('[data-testid="preview-content"]');
  await expect(preview).toBeVisible({ timeout: 15000 });
  const section = page.locator('[data-testid="custom-block-section"]');
  await expect(section.getByText(ORIGINAL_HEADING, { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.locator('[data-testid="design-panel"]')).toBeVisible();
  return api;
}

/** Select a block through the build tree (deterministic; canvas heading clicks
 *  bubble to the container). */
async function selectBlock(page: Page, blockId: string) {
  await page.locator('[data-testid="right-tab-blocks"]').click();
  await expect(page.locator('[data-testid="build-tree-panel"]')).toBeVisible();
  const rootRow = page.locator(`[data-testid="block-row-${ROOT_ID}"]`);
  const expandButton = rootRow.locator('[aria-label="Expand"]');
  if ((await expandButton.count()) > 0) {
    await expandButton.click();
  }
  await page.locator(`[data-testid="block-row-${blockId}"]`).click();
  await page.locator('[data-testid="right-tab-design"]').click();
  await expect(page.locator('[data-testid="element-inspector"]')).toBeVisible({
    timeout: 5000,
  });
}

/** Submit an element-scoped instruction through the inspector AI composer and
 *  wait for the plan summary in the AI Assistant. */
async function askElementAi(page: Page, instruction: string) {
  await expect(page.locator('[data-testid="element-ai-composer"]')).toBeVisible({
    timeout: 5000,
  });
  await page.locator('[data-testid="element-ai-instruction"]').fill(instruction);
  await page.locator('[data-testid="element-ai-submit"]').click();
  await expect(page.locator('[data-testid="plan-summary-card"]')).toBeVisible({
    timeout: 10000,
  });
}

async function reviewAndApply(page: Page) {
  await page.locator('[data-testid="review-plan-button"]').click();
  const review = page.locator('[data-testid="ai-plan-review"]');
  await expect(review).toBeVisible();
  await page.locator('[data-testid="plan-apply-all"]').click();
  await expect(review).toBeHidden({ timeout: 5000 });
}

test.describe("Phase P22-H — element AI editing", () => {
  test("select → element AI → element-scoped plan → review diff → apply → canvas → persist → undo/redo", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const audit = attachRuntimeAudit(page);
    const { getPlanRequest } = await openProject(page);

    // A. Select a renderable element (heading) in the custom-block section.
    await selectBlock(page, HEADING_ID);

    // B. The element AI entry is available with the resolved target.
    const composer = page.locator('[data-testid="element-ai-composer"]');
    await expect(composer).toBeVisible({ timeout: 5000 });
    await expect(composer).toContainText("heading");
    await expect(composer).toContainText(HEADING_ID);

    // No plan is pending yet.
    await expect(page.locator('[data-testid="plan-summary-card"]')).toHaveCount(0);

    // D + C. Submit an element instruction and confirm the plan request is
    // element-scoped and carries pageId + sectionId + elementId.
    await askElementAi(page, "Make it bold");
    const request = JSON.parse(getPlanRequest(0) ?? "{}");
    expect(request.mode).toBe("plan-edit");
    expect(request.scope.type).toBe("element");
    expect(request.scope.pageId).toBe("page-1");
    expect(request.scope.sectionId).toBe(SECTION_ID);
    expect(request.scope.elementId).toBe(HEADING_ID);
    expect(String(request.instruction)).toContain("bold");

    // E. Review the proposed element operation + diff.
    await page.locator('[data-testid="review-plan-button"]').click();
    const review = page.locator('[data-testid="ai-plan-review"]');
    await expect(review).toBeVisible();
    await expect(review).toContainText("selected element");
    const opCard = page.locator('[data-testid="plan-op-op-1"]');
    await expect(opCard).toContainText("Make element bold");
    await expect(page.locator('[data-testid="plan-op-risk-op-1"]')).toContainText("Low");
    await opCard.getByLabel("Show diff").click();
    await expect(review.getByText("700")).toBeVisible();

    // F. Apply the plan.
    await page.locator('[data-testid="plan-apply-all"]').click();
    await expect(review).toBeHidden({ timeout: 5000 });

    // G. The canvas reflects the element change (bold font weight).
    const headingEl = page.locator(`[data-block-id="${HEADING_ID}"]`);
    await expect(headingEl).toHaveCSS("font-weight", "700", { timeout: 5000 });

    // I. Undo reverts atomically; redo re-applies.
    await page.locator('[data-testid="undo-button"]').click();
    await expect(headingEl).toHaveCSS("font-weight", "400", { timeout: 5000 });
    await page.locator('[data-testid="redo-button"]').click();
    await expect(headingEl).toHaveCSS("font-weight", "700", { timeout: 5000 });

    // H. Persistence: save + reload keeps the element edit.
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({
      timeout: 10000,
    });
    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="custom-block-section"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator(`[data-block-id="${HEADING_ID}"]`)).toHaveCSS(
      "font-weight",
      "700",
      { timeout: 5000 },
    );

    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("an element animation edit flows through the existing P22-G model and persists", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const audit = attachRuntimeAudit(page);
    await openProject(page);

    await selectBlock(page, HEADING_ID);

    // The instruction maps to an update-element-animation plan (no new
    // renderer or runtime — the P22-G renderer consumes node.animation).
    await askElementAi(page, "Add a fade in animation on load");
    await page.locator('[data-testid="review-plan-button"]').click();
    const review = page.locator('[data-testid="ai-plan-review"]');
    await expect(review).toBeVisible();
    await expect(review.getByText("Animate element (fade on load)")).toBeVisible();
    await review.getByLabel("Show diff").click();
    await expect(review.getByText("Animation", { exact: true })).toBeVisible();

    await page.locator('[data-testid="plan-apply-all"]').click();
    await expect(review).toBeHidden({ timeout: 5000 });

    // The P22-G renderer surfaces the animation on the canvas element.
    const headingEl = page.locator(`[data-block-id="${HEADING_ID}"]`);
    await expect(headingEl).toHaveAttribute("data-ba-anim", "load", { timeout: 5000 });
    await expect(headingEl).toHaveCSS("animation-name", "ba-fade", { timeout: 5000 });

    // Persists across save + reload.
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({
      timeout: 10000,
    });
    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="custom-block-section"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator(`[data-block-id="${HEADING_ID}"]`)).toHaveAttribute(
      "data-ba-anim",
      "load",
      { timeout: 5000 },
    );

    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("copilot resolves element scope for a selected element and applies its plan", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const audit = attachRuntimeAudit(page);
    const { getPlanRequest } = await openProject(page);

    // Select the heading first — the copilot's auto scope resolves to it.
    await selectBlock(page, HEADING_ID);

    await openCopilot(page);
    await sendCopilotMessage(page, "Make the heading bold");
    await expectPlanReview(page);

    // The plan request is element-scoped (pageId + sectionId + elementId).
    const request = JSON.parse(getPlanRequest(0) ?? "{}");
    expect(request.mode).toBe("plan-edit");
    expect(request.scope.type).toBe("element");
    expect(request.scope.pageId).toBe("page-1");
    expect(request.scope.sectionId).toBe(SECTION_ID);
    expect(request.scope.elementId).toBe(HEADING_ID);

    // The review surface names the element target.
    await expect(page.locator('[data-testid="copilot-plan-review"]')).toContainText(
      "this element",
    );
    await expect(page.locator('[data-testid="copilot-op-op-1"]')).toContainText(
      "Make element bold",
    );

    // Apply through the copilot — the canvas reflects the element edit.
    await page.locator('[data-testid="copilot-apply"]').click();
    await expect(page.locator('[data-testid="copilot-change-summary"]')).toContainText(
      "Done — updated 1 thing",
      { timeout: 10000 },
    );
    const headingEl = page.locator(`[data-block-id="${HEADING_ID}"]`);
    await expect(headingEl).toHaveCSS("font-weight", "700", { timeout: 5000 });

    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
