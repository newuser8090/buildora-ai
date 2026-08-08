import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createBlankProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Phase P9 — project lifecycle (spec §58)
//
// Flow:
//   1. create a project
//   2. rename it
//   3. duplicate it (duplicate-safe name)
//   4. verify the duplicate is an independent project (fresh id, own name)
//   5. archive the original (hidden from the main grid)
//   6. restore it
//   7. save the duplicate as a personal template
//   8. delete one project (with confirmation)
//   9. verify other projects are untouched
//  10. no runtime errors
// ---------------------------------------------------------------------------

async function openCardMenu(page: Page, projectName: string) {
  const card = page.locator('[aria-label="Open project ' + projectName + '"]');
  await card.hover();
  await page
    .getByRole("button", { name: `Menu for ${projectName}`, exact: true })
    .click();
}

test.describe("Phase P9 — project lifecycle", () => {
  test("create → rename → duplicate → archive → restore → save template → delete", async ({
    page,
  }) => {
    const audit = attachRuntimeAudit(page);

    // 1. Create a project (blank template) and return to the dashboard.
    const originalId = await createBlankProjectAndOpenEditor(page);
    await page.getByRole("button", { name: "Back to Dashboard" }).click();
    await page.waitForURL("/", { timeout: 30000 });
    await expect(page.getByText("Untitled Project").first()).toBeVisible({
      timeout: 15000,
    });

    // 2. Rename it.
    await openCardMenu(page, "Untitled Project");
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const renameDialog = page.getByRole("dialog", { name: "Rename Project" });
    await expect(renameDialog).toBeVisible({ timeout: 5000 });
    await page.getByLabel("Project name").fill("Lifecycle Original");
    await renameDialog.getByRole("button", { name: "Rename" }).click();
    await expect(renameDialog).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByText("Lifecycle Original").first()).toBeVisible({
      timeout: 10000,
    });

    // 3. Duplicate — duplicate-safe name "Lifecycle Original Copy".
    await openCardMenu(page, "Lifecycle Original");
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(page.getByText("Lifecycle Original Copy").first()).toBeVisible({
      timeout: 10000,
    });

    // 4. The duplicate is independent: opening it lands on a NEW project id
    //    and shows the same content (fresh identity, retained content).
    await page
      .locator('[aria-label="Open project Lifecycle Original Copy"]')
      .click();
    await page.waitForURL(/\/editor\/.+/, { timeout: 90000 });
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
      timeout: 90000,
    });
    const duplicateUrl = page.url();
    expect(duplicateUrl).not.toContain(originalId);
    await expect(
      page.locator('[data-testid="preview-content"]'),
    ).toBeVisible({ timeout: 15000 });

    // 5. Archive the original (from the dashboard).
    await page.getByRole("button", { name: "Back to Dashboard" }).click();
    await page.waitForURL("/", { timeout: 30000 });
    await expect(
      page.getByText("Lifecycle Original", { exact: true }).first(),
    ).toBeVisible({ timeout: 15000 });

    await openCardMenu(page, "Lifecycle Original");
    await page.getByRole("menuitem", { name: "Archive" }).click();
    // Archived projects hide from the main grid (exact name match — the
    // "Copy" card must not be counted).
    await expect(page.getByText("Lifecycle Original", { exact: true })).toHaveCount(
      0,
      { timeout: 10000 },
    );
    await expect(
      page.getByText("Lifecycle Original Copy").first(),
    ).toBeVisible();

    // Archived view shows the archived project.
    await page.getByRole("button", { name: "Show archived projects" }).click();
    await expect(
      page.getByText("Lifecycle Original", { exact: true }).first(),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Lifecycle Original Copy")).toHaveCount(0);

    // 6. Restore it.
    await openCardMenu(page, "Lifecycle Original");
    await page.getByRole("menuitem", { name: "Restore" }).click();
    // Back to the main grid.
    await page.getByRole("button", { name: "Show archived projects" }).click();
    await expect(
      page.getByText("Lifecycle Original", { exact: true }).first(),
    ).toBeVisible({ timeout: 10000 });

    // 7. Save the duplicate as a personal template.
    await openCardMenu(page, "Lifecycle Original Copy");
    await page.getByRole("menuitem", { name: "Save as template" }).click();
    const satDialog = page.getByRole("dialog", { name: "Save as template" });
    await expect(satDialog).toBeVisible({ timeout: 10000 });
    await satDialog.getByLabel(/Template name/i).fill("Lifecycle Template");
    await satDialog.getByTestId("sat-save-button").click();
    await expect(satDialog).toHaveCount(0, { timeout: 5000 });

    // 8. Delete the original (with confirmation).
    await openCardMenu(page, "Lifecycle Original");
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const confirmDialog = page.getByRole("dialog", { name: /Delete Project/i });
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });
    await confirmDialog.getByRole("button", { name: "Delete" }).click();

    // 9. The duplicate survives; the deleted project is gone.
    await expect(page.getByText("Lifecycle Original", { exact: true })).toHaveCount(0, {
      timeout: 10000,
    });
    await expect(
      page.getByText("Lifecycle Original Copy").first(),
    ).toBeVisible({ timeout: 10000 });

    // The saved template still exists in the personal library.
    await page.getByRole("button", { name: "My Templates" }).click();
    const library = page.getByRole("dialog", { name: "Your templates" });
    await expect(library).toBeVisible({ timeout: 5000 });
    await expect(
      library.getByRole("button", { name: "Use Lifecycle Template" }),
    ).toBeVisible({ timeout: 10000 });

    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
