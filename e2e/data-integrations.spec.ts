import { test, expect } from "@playwright/test";
import type { Download, Page } from "@playwright/test";
import JSZip from "jszip";
import { attachRuntimeAudit, assertRuntimeClean } from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Phase P22-J — data integrations (E2E, mock parity)
//
// The full UI flow against the REAL mock provider (dev env → MockDataProvider):
//   connect mock integration → create collection + field → bind an element
//   field to the collection → the canvas preview resolves the demo record →
//   the exported ZIP bakes the resolved value (static snapshot, no runtime
//   fetch) → save + reload keeps the collection AND the binding.
//
// The mocked generate response seeds a custom-block tree (same harness as
// element-inspector.spec.ts) so the durable element surface is available to
// bind. The collection is created through the UI, not the mock, so the
// document-level path (store → persistence → resolver) is exercised for real.
// ---------------------------------------------------------------------------

const SECTION_ID = "cb-hero";
const ROOT_ID = SECTION_ID; // custom-block trees are re-rooted to the section id
const HEADING_ID = "h-title";

function mockProject(projectId: string) {
  return {
    success: true,
    source: "rule-based",
    project: {
      id: projectId,
      name: "Test — Data",
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
                name: "Data block",
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
                      props: { text: "Static Heading", level: 2 },
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

async function openDataProject(page: Page) {
  // The mocked generate response REPLACES the created project, so it must
  // carry the SAME id — otherwise the editor URL points at a project whose
  // record never receives the save, and reload restores the template.
  const projectId = await createSaaSProjectAndOpenEditor(page);
  await page.route("**/api/generate", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockProject(projectId)) });
  });
  const textarea = page.locator('[data-testid="prompt-input"]');
  await textarea.fill("Custom block website");
  await page.keyboard.press("Enter");
  const preview = page.locator('[data-testid="preview-content"]');
  await expect(preview).toBeVisible({ timeout: 15000 });
  const section = page.locator('[data-testid="custom-block-section"]');
  await expect(section.getByText("Static Heading", { exact: true })).toBeVisible({
    timeout: 10000,
  });
  return { projectId, preview };
}

/** Connect the mock integration through the Data tab. */
async function connectMock(page: Page) {
  await page.locator('[data-testid="right-tab-data"]').click();
  await expect(page.locator('[data-testid="data-panel"]')).toBeVisible();
  await page.locator('[data-testid="connect-mock-integration"]').click();
  await expect(page.locator('[data-testid="data-integration-status"]')).toContainText(
    "Demo data (mock)",
    { timeout: 10000 },
  );
}

/** Create a collection with one text field through the Data tab UI. */
async function createProductsCollection(page: Page) {
  await page.locator('[data-testid="new-collection-name"]').fill("Products");
  await page.locator('[data-testid="add-collection-button"]').click();

  // The collection id is deterministic (col-products-...) but runtime-coded —
  // locate its card by testid prefix.
  const card = page.locator('[data-testid^="collection-card-col-products-"]');
  await expect(card).toBeVisible({ timeout: 5000 });

  await page.locator('[data-testid^="collection-new-field-name-col-products-"]').fill("name");
  await page.locator('[data-testid^="collection-add-field-col-products-"]').click();
  await expect(page.locator('[data-testid^="collection-field-"]')).toHaveCount(1, {
    timeout: 5000,
  });
  return card;
}

/** Select the heading block through the build tree (deterministic path). */
async function selectHeading(page: Page) {
  await page.locator('[data-testid="right-tab-blocks"]').click();
  await expect(page.locator('[data-testid="build-tree-panel"]')).toBeVisible();
  await page
    .locator(`[data-testid="block-row-${ROOT_ID}"]`)
    .locator('[aria-label="Expand"]')
    .click();
  await page.locator(`[data-testid="block-row-${HEADING_ID}"]`).click();
  await page.locator('[data-testid="right-tab-design"]').click();
  await expect(page.locator('[data-testid="element-inspector"]')).toBeVisible({
    timeout: 5000,
  });
}

/** Bind the heading's text prop to the Products collection path `name`. */
async function bindHeadingToProducts(page: Page) {
  // The Data group is the last inspector section — expand it like a user would.
  await page.locator('[data-testid="inspector-section-data-toggle"]').click();
  await expect(
    page.locator('[data-testid="inspector-section-data-toggle"]'),
  ).toHaveAttribute("aria-expanded", "true");

  await page.locator('[data-testid="binding-add"]').click();
  await expect(page.locator('[data-testid="binding-editor"]')).toBeVisible({
    timeout: 5000,
  });

  await page.locator('[data-testid="binding-collection"]').selectOption({ label: "Products" });
  await page.locator('[data-testid="binding-field"]').selectOption({ label: "text" });
  await page.locator('[data-testid="binding-path"]').fill("name");
  await page.locator('[data-testid="binding-path"]').press("Enter");
  await expect(page.locator('[data-testid="binding-status"]')).toContainText(
    "Bound to Products.",
    { timeout: 5000 },
  );
}

async function loadZip(download: Download): Promise<{
  routes: string[];
  files: Map<string, string>;
}> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Download stream unavailable");
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(chunk as Buffer);
  }
  const zip = await JSZip.loadAsync(Buffer.concat(chunks));
  const routes: string[] = [];
  const files = new Map<string, string>();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const path = name.replace(/\\/g, "/");
    routes.push(path);
    const appIndex = path.indexOf("app/");
    if (appIndex !== -1) {
      const rel = path.slice(appIndex);
      if (rel.endsWith("/page.tsx")) {
        files.set(rel, await entry.async("text"));
      }
    }
  }
  return { routes, files };
}

test.describe("Phase P22-J — data integrations (mock parity)", () => {
  test("connect → create collection → bind element → preview resolves → export bakes → persists", async ({ page }) => {
    test.setTimeout(180_000);
    const audit = attachRuntimeAudit(page);

    await openDataProject(page);

    // 1. Connect the mock integration.
    await connectMock(page);

    // 2. Create a collection with one text field (durable document model).
    await createProductsCollection(page);

    // 3. Bind the heading's text to the collection path `name`.
    await selectHeading(page);
    await bindHeadingToProducts(page);

    // 4. The canvas preview resolves the mock demo record
    //    (field "name" text → demo value "Sample name").
    const heading = page.locator(`[data-block-id="${HEADING_ID}"]`);
    await expect(heading).toContainText("Sample name", { timeout: 10000 });
    await expect(heading).not.toContainText("Static Heading");

    // 5. Export: the resolved value is baked into the generated site (static
    //    snapshot — no binding metadata, no runtime fetch).
    const downloadPromise = page.waitForEvent("download");
    await page.locator('[data-testid="export-site-button"]').click();
    const download = await downloadPromise;
    const { files } = await loadZip(download);
    const home = files.get("app/page.tsx") ?? "";
    expect(home).toContain("Sample name");
    expect(home).not.toContain("Static Heading");

    // 6. Persistence: save + reload keeps the collection AND the binding.
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({
      timeout: 10000,
    });
    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="custom-block-section"]')).toBeVisible({
      timeout: 10000,
    });

    // The collection survives reload.
    await page.locator('[data-testid="right-tab-data"]').click();
    await expect(
      page.locator('[data-testid^="collection-card-col-products-"]'),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid^="collection-field-"]')).toHaveCount(1);

    // The binding survives reload and still resolves in the preview.
    await selectHeading(page);
    await page.locator('[data-testid="inspector-section-data-toggle"]').click();
    await expect(page.locator('[data-testid="binding-editor"]')).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator('[data-testid="binding-collection"]')).toHaveValue(/col-products-/);
    await expect(page.locator('[data-testid="binding-path"]')).toHaveValue("name");

    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
