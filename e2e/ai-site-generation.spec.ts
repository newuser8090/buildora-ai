import { test, expect } from "@playwright/test";
import type { Download, Page } from "@playwright/test";
import JSZip from "jszip";
import { attachRuntimeAudit, assertRuntimeClean } from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Phase P22-I — AI page/site generation (E2E)
//
// The prompt runs through the REAL generation pipeline (route → analyzer →
// site templates → rule-based provider → project generator → editor store).
// The x-buildora-force-local header pins the deterministic rule-based path
// (offline-safe, no live Gemini), exactly like the fallback-isolation spec.
//
// The generated project is re-keyed to the editor URL's project id in the
// mocked response — the SAME harness convention P22-H uses — so save+reload
// persists to the project the URL points at. The product pipeline itself is
// untouched and runs for real.
//
// Coverage:
//   prompt → multi-page site → page tabs → homepage "/" → cross-page nav →
//   navigate between pages → save + reload persistence → export ZIP with one
//   route per page → cross-page hrefs resolved in the exported pages
// ---------------------------------------------------------------------------

const PROMPT =
  "Build a multi-page SaaS website called Nimbus with features, pricing, about, and contact pages";

const EXPECTED_PAGES: Array<{ id: string; title: string; slug: string }> = [
  { id: "page-1", title: "Home", slug: "/" },
  { id: "page-2", title: "Features", slug: "/features" },
  { id: "page-3", title: "Pricing", slug: "/pricing" },
  { id: "page-4", title: "About", slug: "/about" },
  { id: "page-5", title: "Contact", slug: "/contact" },
];

interface SiteResponse {
  success: boolean;
  source: string;
  project?: {
    id: string;
    pages: Array<{ id: string; title: string; slug: string }>;
  };
}

/** Deterministic pipeline: force the rule-based provider and pin the project
 *  id so persistence survives a reload (P22-H harness convention). */
async function forceLocalAndPinProjectId(page: Page, projectId: string) {
  await page.route("**/api/generate", async (route) => {
    const request = route.request();
    const headers = request.headers();
    const response = await route.fetch({
      headers: { ...headers, "x-buildora-force-local": "true" },
    });
    const json = (await response.json()) as Record<string, unknown>;
    if (
      json &&
      typeof json === "object" &&
      json.project &&
      typeof json.project === "object"
    ) {
      (json.project as { id: string }).id = projectId;
    }
    await route.fulfill({ response, json });
  });
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
    // Key page files by their app/-relative path — the ZIP root carries a
    // project-folder prefix (e.g. "nimbus—saas/app/page.tsx").
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

test.describe("Phase P22-I — AI site generation", () => {
  test("prompt → multi-page site → tabs → nav → navigate → persist → export", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const audit = attachRuntimeAudit(page);

    const projectId = await createSaaSProjectAndOpenEditor(page);
    await forceLocalAndPinProjectId(page, projectId);

    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/generate") && resp.status() === 200,
      { timeout: 45000 },
    );

    await page.locator('[data-testid="prompt-input"]').fill(PROMPT);
    await page.keyboard.press("Enter");

    // 1. The real pipeline returns a multi-page site project.
    const response = await responsePromise;
    const data = (await response.json()) as SiteResponse;
    expect(data.success).toBe(true);
    expect(data.source).toBe("rule-based");
    expect(data.project!.pages).toHaveLength(5);
    expect(data.project!.pages[0].slug).toBe("/");
    expect(data.project!.pages[0].title).toBe("Home");

    // 2. Page tabs appear for every generated page; homepage is first.
    await expect(
      page.locator('[data-testid="page-tabs"] [role="tab"]'),
    ).toHaveCount(5, { timeout: 20000 });
    for (const p of EXPECTED_PAGES) {
      await expect(
        page.getByRole("tab", { name: `Page: ${p.title}` }),
      ).toBeVisible();
    }
    // The first (home) tab carries the home indicator.
    await expect(
      page.locator('[data-testid="page-tab-page-1"] svg.lucide-house'),
    ).toBeVisible();

    // 3. Home page renders with cross-page navigation labels.
    const preview = page.locator('[data-testid="preview-content"]');
    await expect(preview).toBeVisible({ timeout: 15000 });
    await expect(preview.locator("header")).toContainText("Nimbus");
    await expect(preview.locator("header")).toContainText("Features");
    await expect(preview.locator("header")).toContainText("Pricing");
    await expect(preview.locator("header")).toContainText("About");
    await expect(preview.locator("header")).toContainText("Contact");

    // 4. Navigate between pages — each tab renders that page's content.
    await page.getByRole("tab", { name: "Page: Features" }).click();
    await expect(
      preview.getByText("Everything you need to move fast", { exact: true }),
    ).toBeVisible({ timeout: 10000 });

    await page.getByRole("tab", { name: "Page: Pricing" }).click();
    await expect(
      preview.getByText("Simple, transparent pricing", { exact: true }),
    ).toBeVisible({ timeout: 10000 });

    await page.getByRole("tab", { name: "Page: About" }).click();
    await expect(
      preview.getByText("About Nimbus", { exact: true }),
    ).toBeVisible({ timeout: 10000 });

    await page.getByRole("tab", { name: "Page: Home" }).click();
    await expect(
      preview.getByText("Build better with Nimbus", { exact: true }),
    ).toBeVisible({ timeout: 10000 });

    // 5. Persistence: explicit save + reload keeps the whole multi-page site.
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Saved", exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.locator('[data-testid="page-tabs"] [role="tab"]'),
    ).toHaveCount(5, { timeout: 15000 });
    for (const p of EXPECTED_PAGES) {
      await expect(
        page.getByRole("tab", { name: `Page: ${p.title}` }),
      ).toBeVisible();
    }

    // 6. Export: one route per generated page + homepage at the root.
    const downloadPromise = page.waitForEvent("download");
    await page.locator('[data-testid="export-site-button"]').click();
    const download = await downloadPromise;
    const { routes, files } = await loadZip(download);

    expect(routes.some((r) => r.endsWith("app/page.tsx"))).toBe(true);
    for (const p of EXPECTED_PAGES.slice(1)) {
      expect(
        routes.some((r) => r.endsWith(`app${p.slug}/page.tsx`)),
      ).toBe(true);
    }

    // 7. Cross-page navigation resolves to real exported routes.
    const home = files.get("app/page.tsx") ?? "";
    expect(home).toContain('"/features"');
    expect(home).toContain('"/pricing"');
    expect(home).toContain('"/about"');
    expect(home).toContain('"/contact"');
    const features = files.get("app/features/page.tsx") ?? "";
    expect(features).toContain('"/"');
    expect(features).toContain('"/pricing"');
    expect(features).toContain('"/about"');
    const pricing = files.get("app/pricing/page.tsx") ?? "";
    expect(pricing).toContain('"/about"');
    expect(pricing).toContain('"/contact"');

    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
