// ---------------------------------------------------------------------------
// Phase P13 — Template portability E2E
//
// Proves the full portable-template loop in the browser:
//   create project → save as personal template → export .buildora-template
//   → delete the local template → import the package → preview → install
//   → create a brand-new, independent project from it.
// ---------------------------------------------------------------------------

import { test, expect } from "@playwright/test";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

test.describe("P13 template portability", () => {
  test.use({ acceptDownloads: true });

  test("export → delete → import → install → create project", async ({ page }) => {
    // 1. Create + open a project.
    const originalId = await createSaaSProjectAndOpenEditor(page);

    // 2. Save it as a personal template from the editor.
    await page.getByTestId("topnav-save-template-button").click();
    await expect(page.getByRole("dialog", { name: "Save as template" })).toBeVisible();
    await page.locator("#sat-name").fill("Portable SaaS");
    await page.locator('[data-testid="sat-save-button"]').click();
    await expect(page.getByRole("dialog", { name: "Save as template" })).not.toBeVisible({
      timeout: 5000,
    });

    // 3. Dashboard → My Templates → export the template.
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "My Templates" }).click();
    await expect(page.getByRole("dialog", { name: "Your templates" })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("personal-template-export").first().click(),
    ]);
    expect(download.suggestedFilename()).toBe("portable-saas.buildora-template");
    const packagePath = await download.path();
    expect(packagePath).toBeTruthy();

    // 4. Delete the local template to prove the package is portable.
    const deleteConfirm = page.getByRole("dialog", { name: "Delete Portable SaaS" });
    await page.getByRole("button", { name: "Delete Portable SaaS" }).click();
    await expect(deleteConfirm).toBeVisible();
    await deleteConfirm.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("No saved templates yet")).toBeVisible({ timeout: 5000 });

    // 5. Import the exported package (preview before install).
    await page.getByTestId("personal-templates-import").click();
    await expect(page.getByTestId("template-import-dialog")).toBeVisible();
    await page.getByTestId("template-import-file-input").setInputFiles(packagePath!);
    await expect(page.getByTestId("template-import-preview")).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole("heading", { name: "Portable SaaS", level: 3 }),
    ).toBeVisible();

    // 6. Install it. (Scope the Done click — the panel footer also has a
    //    “Done” button.)
    await page.getByTestId("template-import-install-button").click();
    const success = page.getByTestId("template-import-success");
    await expect(success).toBeVisible({ timeout: 5000 });
    await success.getByRole("button", { name: "Done" }).click();

    // 7. The imported template appears with an "Imported" indicator.
    await expect(page.getByTestId("imported-template-chip")).toBeVisible();

    // 8. Create a new project from the imported template.
    await page.getByRole("button", { name: "Use Portable SaaS" }).first().click();
    await page.waitForURL(/\/editor\/.+/, { timeout: 90000 });
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
      timeout: 90000,
    });

    const newId = page.url().match(/\/editor\/([^/?]+)/)?.[1] ?? "";
    expect(newId).not.toBe("");
    expect(newId).not.toBe(originalId);
  });
});
