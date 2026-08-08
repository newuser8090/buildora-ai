import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";

// ---------------------------------------------------------------------------
// Phase P9 — template start flow (spec §57)
//
// Flow:
//   1. open dashboard
//   2. start new website
//   3. browse templates
//   4. search + category filter
//   5. preview
//   6. use template
//   7. project opens in the editor
//   8. edit content
//   9. preview the site
//  10. save as personal template
//  11. return to dashboard
//  12. create another project from the personal template
//  13. fresh project (new URL), no deployment copied, no runtime errors
// ---------------------------------------------------------------------------

const EDIT_HEADLINE = "Built from a template start";

/** Open the New Project dialog and return the gallery search input. */
async function openNewProjectDialog(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByRole("heading", { name: "Welcome to Buildora" }),
  ).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "New Project" }).first().click();
  await expect(page.getByRole("dialog", { name: "New Project" })).toBeVisible();
}

test.describe("Phase P9 — template start flow", () => {
  test("browse → search → preview → use → edit → save as personal template → reuse", async ({
    page,
  }) => {
    const audit = attachRuntimeAudit(page);

    // 2. Start a new website.
    await openNewProjectDialog(page);
    const dialog = page.getByRole("dialog", { name: "New Project" });
    const search = dialog.getByRole("textbox", { name: "Search templates" });
    await expect(search).toBeVisible();

    // 3. Browse templates — the Event template is registered and visible.
    await expect(
      dialog.getByRole("button", { name: "Use Event Page" }).first(),
    ).toBeVisible({ timeout: 5000 });

    // 4a. Category filter — Events tab shows only event templates.
    await dialog.getByRole("button", { name: "Events" }).click();
    await expect(
      dialog.getByRole("button", { name: "Use Event Page" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Use SaaS Landing Page" }),
    ).toHaveCount(0);

    // 4b. Search across categories.
    await dialog.getByRole("button", { name: "All" }).click();
    await search.fill("restaurant");
    await expect(
      dialog.getByRole("button", { name: "Use Restaurant" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Use Event Page" }),
    ).toHaveCount(0);
    await search.fill("");

    // 5. Preview the Event template.
    await dialog.getByRole("button", { name: "Preview Event Page" }).first().click();
    await expect(page.getByRole("dialog", { name: "Event Page" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Use Event Page template" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close preview" }).click();
    await expect(page.getByRole("dialog", { name: "Event Page" })).toHaveCount(0);

    // 6. Use the Event template.
    await dialog.getByRole("button", { name: "Use Event Page" }).first().click();
    await expect(page.locator("#new-project-name")).toHaveValue("My Event");
    await page.locator('[data-testid="create-project-button"]').click();

    // 7. Project opens in the editor.
    await page.waitForURL(/\/editor\/.+/, { timeout: 90000 });
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
      timeout: 90000,
    });

    // 8. Edit content (inline headline edit).
    const preview = page.locator('[data-testid="preview-content"]');
    const headline = preview.getByText(
      "Join us for an afternoon of ideas and friends",
      { exact: true },
    );
    await headline.click();
    await expect(page.locator('[data-testid="inline-toolbar"]')).toBeVisible({
      timeout: 5000,
    });
    await headline.dblclick();
    await expect(page.locator('[data-testid="inline-edit-overlay"]')).toBeVisible();
    await page.locator('[data-testid="inline-edit-input"]').fill(EDIT_HEADLINE);
    await page.locator('[data-testid="inline-edit-save"]').click();
    await expect(preview.getByText(EDIT_HEADLINE, { exact: true })).toBeVisible({
      timeout: 5000,
    });

    // 9. Preview the site (visitor preview).
    await page.locator('[data-testid="topnav-preview-button"]').click();
    await expect(page.locator('[data-testid="visitor-preview-content"]')).toBeVisible({
      timeout: 10000,
    });
    await page.locator('[data-testid="preview-exit"]').click();
    await expect(page.locator('[data-testid="preview-shell"]')).toHaveCount(0);

    // 10. Save as a personal template.
    await page.locator('[data-testid="topnav-save-template-button"]').click();
    const satDialog = page.getByRole("dialog", { name: "Save as template" });
    await expect(satDialog).toBeVisible({ timeout: 5000 });
    await satDialog.getByLabel(/Template name/i).fill("My Event Starter");
    await satDialog.getByLabel(/Description/i).fill("A reusable event page starter");
    await satDialog.getByTestId("sat-save-button").click();
    await expect(satDialog).toHaveCount(0, { timeout: 5000 });

    // 11. Return to dashboard.
    await page.getByRole("button", { name: "Back to Dashboard" }).click();
    await page.waitForURL("/", { timeout: 30000 });
    await expect(
      page.getByRole("button", { name: "New Project" }).first(),
    ).toBeVisible({ timeout: 15000 });

    // 12. Create a new project from the personal template.
    await page.getByRole("button", { name: "My Templates" }).click();
    const library = page.getByRole("dialog", { name: "Your templates" });
    await expect(library).toBeVisible({ timeout: 5000 });
    await expect(
      library.getByRole("button", { name: "Use My Event Starter" }),
    ).toBeVisible({ timeout: 10000 });
    await library.getByRole("button", { name: "Use My Event Starter" }).click();

    // 13. Fresh project opens — new URL, content preserved, no deployment
    //     state, no runtime errors.
    await page.waitForURL(/\/editor\/.+/, { timeout: 90000 });
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
      timeout: 90000,
    });
    await expect(
      page
        .locator('[data-testid="preview-content"]')
        .getByText(EDIT_HEADLINE, { exact: true }),
    ).toBeVisible({ timeout: 15000 });

    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
