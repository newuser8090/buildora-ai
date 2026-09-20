import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import JSZip from "jszip";
import type { Page } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
  assertNoFailedRequests,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Phase P23 — Custom-code export (E2E)
//
// A real project (mocked generate response seeding a custom-block section with
// a container root + heading child) is authored with enabled custom code, then
// exported through the existing export-site flow (export-site-button → ZIP
// download). The generated archive is inspected:
//   1. the generated custom-block component carries the sandboxed runtime
//      (allow-scripts ONLY, srcDoc, heartbeat + message protocol, status
//      wiring) and no exec mechanisms
//   2. the generated page module carries the srcdocs map with the validated
//      sandbox documents (CSP-first), while the serialized tree carries only
//      the opt-in flag — never the raw code text
//   3. no literal user script/style markup reaches the parent page
// The exported site itself is built by `npm run test:export-build` (the
// WYSIWYG/build gate); this spec verifies the generated artifact.
// ---------------------------------------------------------------------------

const SECTION_ID = "cb-hero";
const ROOT_ID = SECTION_ID;
const HEADING_ID = "head";

const CUSTOM_HTML = '<p data-testid="cc-marker">executed</p>';
const CUSTOM_JS = 'document.body.dataset.executed = "1";';

function mockProject(projectId: string) {
  return {
    success: true,
    source: "rule-based",
    project: {
      id: projectId,
      name: "Test — Custom Code Export",
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
                name: "Custom code export block",
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
                      props: { text: "Export Heading", level: 2 },
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

async function openExportProject(page: Page) {
  const projectId = await createSaaSProjectAndOpenEditor(page);
  await page.route("**/api/generate", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockProject(projectId)) });
  });
  const textarea = page.locator('[data-testid="prompt-input"]');
  await textarea.fill("Custom code export website");
  await page.keyboard.press("Enter");
  const preview = page.locator('[data-testid="preview-content"]');
  await expect(preview).toBeVisible({ timeout: 15000 });
  const section = page.locator('[data-testid="custom-block-section"]');
  await expect(section.getByText("Export Heading", { exact: true })).toBeVisible({
    timeout: 10000,
  });
}

async function enableCustomCodeOnHeading(page: Page) {
  // Select the heading through the build tree (deterministic path).
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

  // Enable custom code with the explicit opt-in confirmation.
  const toggle = page.locator('[data-testid="inspector-section-custom-code-toggle"]');
  await expect(toggle).toBeVisible({ timeout: 5000 });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  await page.locator('[data-testid="custom-code-add"]').click();
  await expect(page.locator('[data-testid="custom-code-confirm"]')).toBeVisible();
  await page.locator('[data-testid="custom-code-confirm-enable"]').click();
  await expect(page.locator('[data-testid="custom-code-editor"]')).toBeVisible();

  await page.locator('[data-testid="custom-code-html"]').fill(CUSTOM_HTML);
  await page.locator('[data-testid="custom-code-js"]').fill(CUSTOM_JS);
  await page.locator('[data-testid="element-inspector-title"]').click();

  // The enabled node renders as the inert placeholder in the editor.
  await expect(
    page.locator('[data-testid="block-custom-code-placeholder"]'),
  ).toBeVisible({ timeout: 5000 });
}

test.describe("Custom-code export (P23)", () => {
  test.use({ acceptDownloads: true });

  test("export emits the sandboxed runtime and srcdocs with a flag-only tree", async ({ page }) => {
    test.setTimeout(120_000);
    const audit = attachRuntimeAudit(page);
    await openExportProject(page);
    await enableCustomCodeOnHeading(page);

    // Exercise the existing export mechanism (site ZIP download).
    const downloadPromise = page.waitForEvent("download");
    await page.locator('[data-testid="export-site-button"]').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    const zip = await JSZip.loadAsync(readFileSync(downloadPath!));
    const paths = Object.keys(zip.files);
    const componentPath = paths.find((p) => p.endsWith("/components/sections/custom-block.tsx"));
    const pagePath = paths.find((p) => p.endsWith("/app/page.tsx"));
    expect(componentPath).toBeTruthy();
    expect(pagePath).toBeTruthy();
    if (!componentPath || !pagePath) return;

    // ---- Generated component: the sandboxed custom-code runtime ----
    const component = await zip.file(componentPath)!.async("string");
    // allow-scripts is the ONLY granted capability, emitted through the
    // authoritative policy constant.
    expect(component).toContain("const CUSTOM_CODE_SANDBOX = \"allow-scripts\";");
    expect(component).toContain("sandbox={CUSTOM_CODE_SANDBOX}");
    expect(component).not.toContain("allow-same-origin");
    expect(component).not.toContain("allow-popups");
    expect(component).not.toContain("allow-forms");
    expect(component).not.toContain("allow-top-navigation");
    // The frame renders the validated srcdoc with the mirror runtime
    // (heartbeat, bounded recovery, message types, status wiring).
    expect(component).toContain("srcDoc={srcDoc}");
    expect(component).toContain("function CustomCodeFrame");
    expect(component).toContain("data-buildora-status");
    expect(component).toContain("CUSTOM_CODE_HEARTBEAT");
    expect(component).toContain("buildora:ready");
    expect(component).toContain("buildora:height");
    expect(component).toContain("buildora:error");
    // No exec mechanisms in the generated component.
    expect(component).not.toContain("eval(");
    expect(component).not.toContain("new Function");
    expect(component).not.toContain("dangerouslySetInnerHTML");

    // ---- Generated page: srcdocs map + flag-only tree ----
    const pageFile = await zip.file(pagePath)!.async("string");
    // One validated srcdoc entry keyed by the enabled node id.
    expect(pageFile).toContain(`srcdocs={{"${HEADING_ID}":`);
    // The validated sandbox document is delivered \u003c-escaped JSON and
    // carries the CSP (no network, no framing) plus the user code.
    expect(pageFile).toContain("Content-Security-Policy");
    expect(pageFile).toContain("frame-ancestors 'none'");
    expect(pageFile).toContain("connect-src 'none'");
    // The user HTML/JS survive ONLY as the escaped srcdoc data (marker text
    // has no special characters, so it is preserved verbatim inside the
    // \u003c-escaped JSON document).
    expect(pageFile).toContain("cc-marker");
    expect(pageFile).toContain("document.body.dataset.executed");
    // The serialized tree carries ONLY the opt-in flag — never the code text.
    expect(pageFile).toContain(`"customCode":{"enabled":true}`);
    expect(pageFile).not.toContain(`"customCode":{"enabled":true,"html"`);
    // No literal script/style markup and no exec mechanisms in the parent
    // page — the user code exists only as escaped srcdoc data.
    expect(pageFile).not.toContain("<script");
    expect(pageFile).not.toContain("<style");
    expect(pageFile).not.toContain("dangerouslySetInnerHTML");
    expect(pageFile).not.toContain("eval(");
    expect(pageFile).not.toContain("new Function");

    assertNoFailedRequests(audit.state);
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
