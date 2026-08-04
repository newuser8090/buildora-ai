import { test, expect } from "@playwright/test";
import type { Download, Page } from "@playwright/test";
import JSZip from "jszip";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Deterministic website-scope plan mock
//
// The plan embeds the live project (random UUID ids), so the mock resolves
// pages/sections from the submitted project. The requested change set is:
//   - add a Contact page
//   - rename Pricing → Plans
//   - hide FAQ on Home
// plus a high-risk delete of the About page, which exercises the destructive
// confirmation flow. Application runs through the REAL editor store.
// ---------------------------------------------------------------------------

interface SectionLike {
  id: string;
  type: string;
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
    const pricing = project.pages.find((p) => p.title === "Pricing")!;
    const about = project.pages.find((p) => p.title === "About")!;
    const faq = home.sections.find((s) => s.type === "faq")!;

    const plan = {
      version: 1,
      id: "plan-website-e2e",
      projectId: project.id,
      baseRevision: body.baseRevision,
      scope: body.scope,
      instruction: body.instruction,
      summary: "Planned 4 changes across the website.",
      operations: [
        {
          id: "op-1",
          type: "add-page",
          label: 'Add "Contact" page',
          explanation: "Creates a new Contact page at /contact.",
          risk: "low",
          page: {
            id: "page-contact-e2e",
            title: "Contact",
            slug: "/contact",
            sections: [
              {
                id: "sec-contact-hero",
                type: "hero",
                order: 1,
                visible: true,
                props: {
                  headline: "Get in touch with us",
                  subheadline: "We would love to hear from you.",
                  primaryCta: { text: "Contact us", href: "#" },
                },
                styles: {},
              },
            ],
          },
        },
        {
          id: "op-2",
          type: "rename-page",
          pageId: pricing.id,
          title: "Plans",
          label: "Rename Pricing to Plans",
          explanation: "Renames the Pricing page and re-derives its route.",
          risk: "low",
        },
        {
          id: "op-3",
          type: "set-section-visibility",
          pageId: home.id,
          sectionId: faq.id,
          visible: false,
          label: "Hide FAQ on Home",
          explanation: "Hides the FAQ section on the Home page.",
          risk: "low",
        },
        {
          id: "op-4",
          type: "delete-page",
          pageId: about.id,
          label: 'Delete "About" page',
          explanation: "Permanently removes the About page.",
          risk: "high",
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
// ZIP route inspection
// ---------------------------------------------------------------------------

async function readZipRoutes(download: Download): Promise<string[]> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Download stream unavailable");
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(chunk as Buffer);
  }
  const zip = await JSZip.loadAsync(Buffer.concat(chunks));
  return Object.keys(zip.files).map((name) => name.replace(/\\/g, "/"));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("AI website-scope editing", () => {
  test.beforeEach(async ({ page }) => {
    await createSaaSProjectAndOpenEditor(page);
  });

  test("website plan: add page, rename page, hide section, export, undo", async ({
    page,
  }) => {
    const audit = attachRuntimeAudit(page);
    await mockPlanApi(page);

    // 1. Build a multi-page project: add Pricing + About pages.
    await page.locator('[data-testid="page-tab-add"]').click();
    await page.locator('[data-testid="page-rename-input"]').fill("Pricing");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: "Page: Pricing" })).toBeVisible();

    await page.locator('[data-testid="page-tab-add"]').click();
    await page.locator('[data-testid="page-rename-input"]').fill("About");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: "Page: About" })).toBeVisible();

    // 2. Choose Website scope and submit the instruction.
    await page.locator('[data-testid="ai-scope-project"]').click();
    await page
      .locator('[data-testid="prompt-input"]')
      .fill("Add a Contact page, rename Pricing to Plans, and hide FAQ on Home");
    await page.keyboard.press("Enter");

    // 3. Plan summary card shows the destructive marker.
    await expect(page.locator('[data-testid="plan-summary-card"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('[data-testid="plan-summary-card"]')).toContainText(
      "4 proposed changes",
    );
    await expect(page.locator('[data-testid="plan-summary-card"]')).toContainText(
      "Destructive",
    );

    // 4. Review: high-risk delete is unchecked by default.
    await page.locator('[data-testid="review-plan-button"]').click();
    await expect(page.locator('[data-testid="ai-plan-review"]')).toBeVisible();
    const destructiveCheckbox = page.locator(
      '[data-testid="plan-op-checkbox-op-4"]',
    );
    await expect(destructiveCheckbox).not.toBeChecked();
    await expect(page.locator('[data-testid="plan-op-risk-op-4"]')).toContainText(
      "Destructive",
    );

    // 5. Apply All requires destructive confirmation.
    await page.locator('[data-testid="plan-apply-all"]').click();
    await expect(page.locator('[data-testid="plan-destructive-confirm"]')).toBeVisible();
    await page.locator('[data-testid="plan-confirm-destructive"]').click();

    // 6. Verify the new page, renamed page/route, and removed page.
    await expect(page.getByRole("tab", { name: "Page: Contact" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Page: Plans" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Page: Pricing" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Page: About" })).toHaveCount(0);

    // 7. FAQ is hidden on Home.
    await page.getByRole("tab", { name: "Page: Home" }).click();
    const preview = page.locator('[data-testid="preview-content"]');
    await expect(
      preview.getByText("Can I try Nimbus before paying?"),
    ).toHaveCount(0);
    await expect(preview.getByText("Ready to build something great?")).toBeVisible();

    // 8. Export the site and inspect the ZIP routes.
    const downloadPromise = page.waitForEvent("download");
    await page.locator('[data-testid="export-site-button"]').click();
    const download = await downloadPromise;
    const routes = await readZipRoutes(download);
    expect(routes.some((r) => r.endsWith("app/contact/page.tsx"))).toBe(true);
    expect(routes.some((r) => r.endsWith("app/plans/page.tsx"))).toBe(true);
    expect(routes.some((r) => r.endsWith("app/pricing/page.tsx"))).toBe(false);
    expect(routes.some((r) => r.endsWith("app/about/page.tsx"))).toBe(false);

    // 9. One Undo restores the full prior website.
    await page.locator('[data-testid="undo-button"]').click();
    await expect(page.getByRole("tab", { name: "Page: Pricing" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Page: About" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Page: Contact" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Page: Plans" })).toHaveCount(0);
    await page.getByRole("tab", { name: "Page: Home" }).click();
    await expect(
      page
        .locator('[data-testid="preview-content"]')
        .getByText("Can I try Nimbus before paying?"),
    ).toBeVisible();

    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
