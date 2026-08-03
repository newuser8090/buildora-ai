import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Shared dashboard → editor flow
//
// The dashboard (/) creates projects from templates and navigates to
// /editor/[projectId] on success. Every Playwright test gets a fresh browser
// context (empty IndexedDB), so helpers here always start from the first-run
// empty dashboard state. Used by both editor.spec.ts and thumbnails.spec.ts
// so the flow never drifts between specs.
// ---------------------------------------------------------------------------

/**
 * Open the dashboard and create a project from the SaaS template, landing in
 * the editor at /editor/<projectId>. Returns the created project id.
 */
export async function createSaaSProjectAndOpenEditor(page: Page): Promise<string> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // First-run empty dashboard — no automatic project is created.
  await expect(
    page.getByRole("heading", { name: "Welcome to Buildora" }),
  ).toBeVisible({ timeout: 10000 });

  await page.getByRole("button", { name: "New Project" }).first().click();
  await expect(page.getByRole("dialog", { name: "New Project" })).toBeVisible();

  // The SaaS card may appear in both the featured strip and the full grid —
  // click the first match.
  await page.getByRole("button", { name: "Use SaaS Landing Page" }).first().click();
  await expect(page.locator("#new-project-name")).toHaveValue("SaaS Landing Page");

  await page.locator('[data-testid="create-project-button"]').click();
  await page.waitForURL(/\/editor\/.+/, { timeout: 15000 });

  await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
    timeout: 15000,
  });

  const match = page.url().match(/\/editor\/([^/?]+)/);
  const projectId = match ? match[1] : "";
  expect(projectId).not.toBe("");
  return projectId;
}

/**
 * Open the dashboard and create a project from the Blank template (single
 * starter hero section), landing in the editor. Returns the project id.
 */
export async function createBlankProjectAndOpenEditor(
  page: Page,
): Promise<string> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByRole("heading", { name: "Welcome to Buildora" }),
  ).toBeVisible({ timeout: 10000 });

  await page.getByRole("button", { name: "New Project" }).first().click();
  await expect(page.getByRole("dialog", { name: "New Project" })).toBeVisible();

  // Blank template card — click the first match.
  await page.getByRole("button", { name: "Use Blank Project" }).first().click();
  await expect(page.locator("#new-project-name")).toHaveValue("Untitled Project");

  await page.locator('[data-testid="create-project-button"]').click();
  await page.waitForURL(/\/editor\/.+/, { timeout: 15000 });

  await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
    timeout: 15000,
  });

  const match = page.url().match(/\/editor\/([^/?]+)/);
  const projectId = match ? match[1] : "";
  expect(projectId).not.toBe("");
  return projectId;
}
