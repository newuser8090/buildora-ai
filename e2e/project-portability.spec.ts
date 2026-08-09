// ---------------------------------------------------------------------------
// Phase P13 — Project portability E2E
//
// Audits the established .buildora.json project round trip:
//   create project → export → verify privacy (no private runtime state)
//   → import → fresh identity (new project id) + content preserved.
// The existing format is intentionally kept unchanged; this spec proves it.
// ---------------------------------------------------------------------------

import { test, expect } from "@playwright/test";
import fs from "fs";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// Private/runtime tokens that must NEVER appear in a project export.
const FORBIDDEN_TOKENS = [
  "shareToken",
  "reviewComment",
  "copilotConversation",
  "copilotMemory",
  "cloudSyncQueue",
  "recoverySnapshot",
  "providerSecret",
  "deploymentToken",
];

test.describe("P13 project portability", () => {
  test.use({ acceptDownloads: true });

  test(".buildora.json round trip: privacy + fresh identity", async ({ page }) => {
    const originalId = await createSaaSProjectAndOpenEditor(page);

    // ---- Export from the dashboard card menu ------------------------------
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Menu for SaaS Landing Page" }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: "Export" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("saas-landing-page.buildora.json");
    const filePath = await download.path();
    expect(filePath).toBeTruthy();

    // ---- Privacy: exported envelope contains only project content ---------
    const content = fs.readFileSync(filePath!, "utf8");
    expect(content).toContain('"format": "buildora-project"');
    const lower = content.toLowerCase();
    for (const token of FORBIDDEN_TOKENS) {
      expect(lower).not.toContain(token);
    }

    // ---- Import the file back (fresh identity, never overwrite) -----------
    // Real users get the file with its suggested name (saas-landing-page
    // .buildora.json); Playwright's temp path has a random name, so save the
    // download under its real filename before re-uploading. The audited
    // .buildora.json extension gate stays untouched.
    const importPath = test.info().outputPath(download.suggestedFilename());
    await download.saveAs(importPath);

    await page.getByRole("button", { name: "Import Project" }).click();
    // The file input is visually hidden behind the “Choose File” button —
    // setInputFiles targets it directly (Playwright supports hidden inputs).
    await page.getByTestId("import-file-input").setInputFiles(importPath);
    await expect(page.getByTestId("import-and-open-button")).toBeVisible({
      timeout: 15000,
    });
    await page.getByTestId("import-and-open-button").click();

    await page.waitForURL(/\/editor\/.+/, { timeout: 90000 });
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
      timeout: 90000,
    });

    // Fresh identity — never the original project id.
    const newId = page.url().match(/\/editor\/([^/?]+)/)?.[1] ?? "";
    expect(newId).not.toBe("");
    expect(newId).not.toBe(originalId);
  });
});
