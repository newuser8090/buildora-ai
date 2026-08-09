// ---------------------------------------------------------------------------
// Phase P13 — Template import security E2E
//
// Injects representative HOSTILE .buildora-template packages (built in Node
// with JSZip) through the import dialog and asserts:
//   - each package is rejected with beginner-safe copy (never raw errors)
//   - no persistence mutation happens (the library stays empty)
// ---------------------------------------------------------------------------

import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import type { Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Fixture builders (Node side)
// ---------------------------------------------------------------------------

const NOW = "2026-08-09T00:00:00.000Z";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function validManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: "buildora-template",
    formatVersion: 1,
    packageType: "template",
    exportedAt: NOW,
    assetCount: 0,
    totalAssetBytes: 0,
    assets: [],
    ...overrides,
  };
}

/** A minimal ProjectSchema-valid project (theme complete, one hero section). */
function validProject(assets: unknown[] = []): Record<string, unknown> {
  return {
    id: "proj-x",
    name: "Portable",
    theme: {
      palette: {
        background: "#fff", foreground: "#000", primary: "#7c5cfc",
        primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#000",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#fff", border: "#e5e5e5", card: "#fff", cardForeground: "#000",
      },
      typography: { fontFamily: "sans-serif", headingFont: "sans-serif", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "5rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets,
    pages: [
      {
        id: "p1", title: "Home", slug: "/",
        sections: [{ id: "s1", type: "hero", order: 1, visible: true, props: {}, styles: {} }],
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    template: { name: "Portable", description: "", category: "portfolio", tags: [], createdAt: NOW, updatedAt: NOW },
    project: validProject(),
    ...overrides,
  };
}

async function zipBuffer(entries: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) zip.file(path, content);
  return zip.generateAsync({ type: "nodebuffer" });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openImportDialog(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "My Templates" }).click();
  await expect(page.getByRole("dialog", { name: "Your templates" })).toBeVisible();
  await page.getByTestId("personal-templates-import").click();
  await expect(page.getByTestId("template-import-dialog")).toBeVisible();
}

async function importBuffer(
  page: Page,
  buffer: Buffer,
  filename: string,
): Promise<void> {
  await page.getByTestId("template-import-file-input").setInputFiles({
    name: filename,
    mimeType: "application/zip",
    buffer,
  });
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

test.describe("P13 template import security", () => {
  test("hostile packages are rejected safely without persistence mutation", async ({ page }) => {
    // ---- 1. Wrong file type ----------------------------------------------
    // Filenames are not trusted — a plain-text file is rejected by content
    // (never by its name), so the safe “not a Buildora template” copy shows.
    await openImportDialog(page);
    await importBuffer(page, Buffer.from("plain text"), "evil.txt");
    await expect(page.getByTestId("template-import-error")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/is not a Buildora template/i)).toBeVisible();
    await page.getByTestId("template-import-try-another").click();

    // ---- 2. Traversal path -----------------------------------------------
    await importBuffer(
      page,
      await zipBuffer({ "../evil.js": "alert(1)" }),
      "traversal.buildora-template",
    );
    await expect(page.getByTestId("template-import-error")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/unsafe file entry/i)).toBeVisible();
    await page.getByTestId("template-import-try-another").click();

    // ---- 3. Newer format version ------------------------------------------
    await importBuffer(
      page,
      await zipBuffer({ "manifest.json": JSON.stringify(validManifest({ formatVersion: 99 })) }),
      "newer.buildora-template",
    );
    await expect(page.getByTestId("template-import-error")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/created with a newer version of Buildora/i)).toBeVisible();
    await page.getByTestId("template-import-try-another").click();

    // ---- 4. Wrong package type --------------------------------------------
    await importBuffer(
      page,
      await zipBuffer({ "manifest.json": JSON.stringify(validManifest({ packageType: "project" })) }),
      "project.buildora-template",
    );
    await expect(page.getByTestId("template-import-error")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/not a template/i)).toBeVisible();
    await page.getByTestId("template-import-try-another").click();

    // ---- 5. Missing manifest ----------------------------------------------
    await importBuffer(page, await zipBuffer({ "template.json": "{}" }), "nomanifest.buildora-template");
    await expect(page.getByTestId("template-import-error")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/missing its template information/i)).toBeVisible();
    await page.getByTestId("template-import-try-another").click();

    // ---- 6. Prototype-pollution payload -----------------------------------
    const polluted = validPayload();
    // Bracket syntax so the own `constructor` key serializes into the JSON
    // (dot syntax is rejected by TS because Object declares `constructor`).
    polluted["constructor"] = { evil: true };
    await importBuffer(
      page,
      await zipBuffer({
        "manifest.json": JSON.stringify(validManifest()),
        "template.json": JSON.stringify(polluted),
      }),
      "polluted.buildora-template",
    );
    await expect(page.getByTestId("template-import-error")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/template inside this package is invalid/i)).toBeVisible();
    await page.getByTestId("template-import-try-another").click();

    // ---- 7. SVG asset containing a script ---------------------------------
    const svgBytes = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      "utf8",
    );
    const svgAsset = {
      path: "assets/asset-0001.svg",
      assetId: "asset-svg",
      name: "evil.svg",
      mimeType: "image/svg+xml",
      extension: ".svg",
      size: svgBytes.length,
    };
    const svgPayload = {
      template: validPayload().template,
      project: validProject([
        {
          id: "asset-svg",
          name: "evil.svg",
          type: "image",
          mimeType: "image/svg+xml",
          extension: ".svg",
          size: svgBytes.length,
          source: { type: "data-url", value: "assets/asset-0001.svg" },
          createdAt: NOW,
        },
      ]),
    };
    await importBuffer(
      page,
      await zipBuffer({
        "manifest.json": JSON.stringify(validManifest({ assetCount: 1, totalAssetBytes: svgBytes.length, assets: [svgAsset] })),
        "template.json": JSON.stringify(svgPayload),
        "assets/asset-0001.svg": svgBytes,
      }),
      "script-svg.buildora-template",
    );
    await expect(page.getByTestId("template-import-error")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/images is not valid/i)).toBeVisible();

    // ---- 8. No persistence mutation ----------------------------------------
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("No saved templates yet")).toBeVisible({ timeout: 5000 });
  });

  test("an HTML payload disguised as a PNG image is rejected", async ({ page }) => {
    await openImportDialog(page);
    const htmlBytes = Buffer.from("<html><script>alert(1)</script></html>", "utf8");
    const asset = {
      path: "assets/asset-0001.png",
      assetId: "asset-html",
      name: "fake.png",
      mimeType: "image/png",
      extension: ".png",
      size: htmlBytes.length,
    };
    const payload = {
      template: validPayload().template,
      project: validProject([
        {
          id: "asset-html",
          name: "fake.png",
          type: "image",
          mimeType: "image/png",
          extension: ".png",
          size: htmlBytes.length,
          source: { type: "data-url", value: "assets/asset-0001.png" },
          createdAt: NOW,
        },
      ]),
    };
    await importBuffer(
      page,
      await zipBuffer({
        "manifest.json": JSON.stringify(validManifest({ assetCount: 1, totalAssetBytes: htmlBytes.length, assets: [asset] })),
        "template.json": JSON.stringify(payload),
        "assets/asset-0001.png": htmlBytes,
      }),
      "html-png.buildora-template",
    );
    await expect(page.getByTestId("template-import-error")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/images is not valid/i)).toBeVisible();

    // Library still empty.
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("No saved templates yet")).toBeVisible({ timeout: 5000 });
  });

  test("PNG_BYTES constant is a real PNG (fixture sanity)", () => {
    expect(PNG_BYTES[0]).toBe(0x89);
    expect(PNG_BYTES[1]).toBe(0x50);
  });
});
