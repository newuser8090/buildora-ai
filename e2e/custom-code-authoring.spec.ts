import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
  assertNoFailedRequests,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Phase P23 — Custom-code authoring (E2E)
//
// A mocked generate response seeds a project whose only section is a
// custom-block tree: a container root with one heading child (heading is one
// of the curated leaf blocks that opt into custom-code authoring,
// elementSupportsCustomCode → heading).
//
// Coverage:
//   1. the real authoring flow — expand Custom Code in the universal
//      inspector, Add custom code, complete the explicit opt-in confirmation,
//      type HTML/CSS/JS, commit on blur
//   2. the editor canvas NEVER executes custom code — the enabled node renders
//      as the inert placeholder (block-custom-code-placeholder) and the
//      authored HTML/JS never touch the editor document
//   3. the sandboxed authoring preview is the ONLY surface where the code
//      runs: sandbox="allow-scripts" exactly, opaque origin, CSP-first
//      srcdoc (connect-src 'none', frame-ancestors 'none'), and the runtime
//      reaches its Ready state
//   4. removing custom code restores the normal element and removes the
//      preview surface
// ---------------------------------------------------------------------------

const SECTION_ID = "cb-hero";
const ROOT_ID = SECTION_ID; // custom-block trees are re-rooted to the section id
const HEADING_ID = "head";

const CUSTOM_HTML = '<p data-testid="cc-marker">executed</p>';
const CUSTOM_CSS = ".cc-box { color: rgb(1, 2, 3); }";
const CUSTOM_JS = 'document.body.dataset.executed = "1";';

function mockProject(projectId: string) {
  return {
    success: true,
    source: "rule-based",
    project: {
      id: projectId,
      name: "Test — Custom Code",
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
                name: "Custom code block",
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
                      props: { text: "Custom Code Heading", level: 2 },
                      style: { fontSize: 24 },
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

async function openAuthoringProject(page: Page) {
  // The mocked generate response REPLACES the created project, so it must
  // carry the SAME id — otherwise the editor URL points at a project whose
  // record never receives the save, and reload restores the template.
  const projectId = await createSaaSProjectAndOpenEditor(page);
  await page.route("**/api/generate", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockProject(projectId)) });
  });
  const textarea = page.locator('[data-testid="prompt-input"]');
  await textarea.fill("Custom code website");
  await page.keyboard.press("Enter");
  const preview = page.locator('[data-testid="preview-content"]');
  await expect(preview).toBeVisible({ timeout: 15000 });
  const section = page.locator('[data-testid="custom-block-section"]');
  await expect(section.getByText("Custom Code Heading", { exact: true })).toBeVisible({
    timeout: 10000,
  });
  return preview;
}

/** Select the heading block through the build tree (deterministic path). */
async function selectHeading(page: Page) {
  await page.locator('[data-testid="right-tab-blocks"]').click();
  await expect(page.locator('[data-testid="build-tree-panel"]')).toBeVisible();
  const rootRow = page.locator(`[data-testid="block-row-${ROOT_ID}"]`);
  const expandButton = rootRow.locator('[aria-label="Expand"]');
  if ((await expandButton.count()) > 0) {
    await expandButton.click();
  }
  await page.locator(`[data-testid="block-row-${HEADING_ID}"]`).click();
  await page.locator('[data-testid="right-tab-design"]').click();
  await expect(page.locator('[data-testid="element-inspector"]')).toBeVisible({
    timeout: 5000,
  });
}

/** Expand the Custom Code inspector section (progressive disclosure). */
async function expandCustomCodeSection(page: Page) {
  const toggle = page.locator('[data-testid="inspector-section-custom-code-toggle"]');
  await expect(toggle).toBeVisible({ timeout: 5000 });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

/**
 * Enable custom code with the explicit confirmation and commit HTML/CSS/JS.
 * Returns after the editor canvas shows the inert placeholder.
 */
async function authorCustomCode(page: Page) {
  await expandCustomCodeSection(page);

  await expect(page.locator('[data-testid="custom-code-add"]')).toBeVisible();
  await page.locator('[data-testid="custom-code-add"]').click();

  // Explicit opt-in confirmation with the persistent warning.
  await expect(page.locator('[data-testid="custom-code-confirm"]')).toBeVisible();
  await expect(page.locator('[data-testid="custom-code-warning"]')).toBeVisible();
  await page.locator('[data-testid="custom-code-confirm-enable"]').click();

  await expect(page.locator('[data-testid="custom-code-editor"]')).toBeVisible();
  await expect(page.locator('[data-testid="custom-code-warning"]')).toBeVisible();

  await page.locator('[data-testid="custom-code-html"]').fill(CUSTOM_HTML);
  await page.locator('[data-testid="custom-code-css"]').fill(CUSTOM_CSS);
  await page.locator('[data-testid="custom-code-js"]').fill(CUSTOM_JS);
  // Blur commits each field (one history entry per field).
  await page.locator('[data-testid="element-inspector-title"]').click();

  // The enabled node renders as the inert placeholder in the editor canvas.
  await expect(
    page.locator('[data-testid="block-custom-code-placeholder"]'),
  ).toBeVisible({ timeout: 5000 });
}

test.describe("Custom-code authoring (P23)", () => {
  test("opt-in flow, editor placeholder, and sandboxed preview reaching Ready", async ({ page }) => {
    test.setTimeout(120_000);
    const audit = attachRuntimeAudit(page);
    await openAuthoringProject(page);
    await selectHeading(page);
    await authorCustomCode(page);

    // ---- The editor document never executes the custom code ----
    // The authored HTML marker must not exist in the editor canvas...
    await expect(page.locator('[data-testid="cc-marker"]')).toHaveCount(0);
    // ...and the authored JS must not have run in the editor document.
    expect(
      await page.evaluate(() => (document.body as HTMLElement).dataset.executed),
    ).toBeUndefined();
    // The placeholder replaces the real content (the heading text is gone).
    await expect(
      page.locator('[data-testid="custom-block-section"]').getByText("Custom Code Heading", { exact: true }),
    ).toHaveCount(0);

    // ---- Open the sandboxed authoring preview ----
    await page.locator('[data-testid="custom-code-preview-toggle"]').click();
    const previewFrame = page.locator('[data-testid="custom-code-preview"] iframe');
    await expect(previewFrame).toBeVisible({ timeout: 5000 });

    // The ONLY granted sandbox capability is allow-scripts.
    await expect(previewFrame).toHaveAttribute("sandbox", "allow-scripts");

    // The srcdoc is the authoritative sandbox document: CSP-first with no
    // network, no framing, and the user code embedded (runtime shell + user
    // script) — the code itself appears only inside this document.
    const srcdoc = await previewFrame.evaluate((el) => (el as HTMLIFrameElement).srcdoc);
    expect(srcdoc).toContain("Content-Security-Policy");
    expect(srcdoc).toContain("default-src 'none'");
    expect(srcdoc).toContain("connect-src 'none'");
    expect(srcdoc).toContain("frame-ancestors 'none'");
    expect(srcdoc).toContain(CUSTOM_HTML);
    expect(srcdoc).toContain(CUSTOM_JS);
    // The child-side runtime shell is present (ready/height/error channel).
    expect(srcdoc).toContain("buildora:ready");
    expect(srcdoc).toContain("window.parent.postMessage");

    // The frame has an opaque origin — it cannot reach the parent document.
    const childFrame = page.frames().find((f) => f !== page.mainFrame());
    expect(childFrame).toBeTruthy();
    if (!childFrame) return;
    await expect.poll(() => childFrame.evaluate(() => window.origin)).toBe("null");

    // The code runs ONLY inside the sandboxed frame.
    await expect(childFrame.locator('[data-testid="cc-marker"]')).toHaveText("executed");
    expect(
      await childFrame.evaluate(() => (document.body as HTMLElement).dataset.executed),
    ).toBe("1");

    // The runtime reaches its Ready state (validated frame message anchored).
    await expect(page.locator('[data-testid="custom-code-preview-status"]')).toHaveText(
      "Ready",
      { timeout: 15000 },
    );
    await expect(previewFrame).toHaveAttribute("data-buildora-status", "ready", {
      timeout: 15000,
    });

    assertNoFailedRequests(audit.state);
    // The sandboxed preview document deliberately delivers its CSP as a meta
    // element, and that CSP includes `frame-ancestors 'none'` (defense in
    // depth). Chromium logs a console advisory that frame-ancestors is
    // ignored when delivered via a <meta> (it is only honored from HTTP
    // headers) — the anti-framing property here is srcdoc-only delivery plus
    // the parent sandbox attribute. Assert that the ONLY console error is
    // exactly this browser advisory, then assert the rest of the audit is
    // clean.
    const cspMetaAdvisory = /frame-ancestors.*ignored when delivered via a <meta>/;
    for (const error of audit.state.consoleErrors) {
      expect(error).toMatch(cspMetaAdvisory);
    }
    assertRuntimeClean({
      ...audit.state,
      consoleErrors: audit.state.consoleErrors.filter((e) => !cspMetaAdvisory.test(e)),
    });
    audit.detach();
  });

  test("removing custom code restores the normal element and preview surface", async ({ page }) => {
    test.setTimeout(120_000);
    const audit = attachRuntimeAudit(page);
    await openAuthoringProject(page);
    await selectHeading(page);
    await authorCustomCode(page);

    await expect(page.locator('[data-testid="block-custom-code-placeholder"]')).toBeVisible();

    // Remove custom code entirely — the element renders normally again.
    await page.locator('[data-testid="custom-code-remove"]').click();
    await expect(
      page.locator('[data-testid="block-custom-code-placeholder"]'),
    ).toHaveCount(0, { timeout: 5000 });
    await expect(
      page.locator('[data-testid="custom-block-section"]').getByText("Custom Code Heading", { exact: true }),
    ).toBeVisible({ timeout: 5000 });

    // The preview surface is gone and the "Add custom code" entry is back.
    await expect(page.locator('[data-testid="custom-code-preview-toggle"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="custom-code-add"]')).toBeVisible();

    assertNoFailedRequests(audit.state);
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
