import { expect, type Page } from "@playwright/test";
import {
  createSaaSProjectAndOpenEditor,
} from "./projects";
import { signUp, uniqueSuffix } from "./cloud-sync";

// ---------------------------------------------------------------------------
// Phase P8 — shared E2E helpers
//
// The Vercel provider requires a signed-in Buildora session (server-side
// routes verify it), so every P8 flow starts by creating a project AND
// signing up with a fresh mock account. The Vercel provider itself runs in
// mock mode on the dev server (no VERCEL_API_TOKEN), so the exact wire
// contract is exercised without real credentials.
// ---------------------------------------------------------------------------

/** Create a SaaS project, open the editor, and sign up with a fresh account. */
export async function createSignedInProjectAndOpenEditor(page: Page): Promise<string> {
  const projectId = await createSaaSProjectAndOpenEditor(page);
  const email = `p8-${uniqueSuffix()}@example.com`;
  await signUp(page, email, "password123");
  return projectId;
}

/** Open the Launch Center from the editor TopNav. */
export async function openLaunchCenter(page: Page): Promise<void> {
  await page.locator('[data-testid="topnav-publish-button"]').click();
  await expect(page.locator('[data-testid="launch-score"]')).toBeVisible({
    timeout: 10000,
  });
}

/** Publish through the Vercel provider and wait for the success screen. */
export async function publishViaVercel(page: Page): Promise<void> {
  await openLaunchCenter(page);
  await page.locator('[data-testid="launch-publish"]').click();
  await expect(
    page.getByRole("dialog", { name: "Publish your site" }),
  ).toBeVisible({ timeout: 10000 });

  // The dialog defaults to the mock provider — select Vercel explicitly.
  await page.locator('[data-testid="provider-vercel"]').check();
  await page.locator('[data-testid="publish-confirm"]').click();

  await expect(page.locator('[data-testid="publish-success"]')).toBeVisible({
    timeout: 30000,
  });
  // "Your site is live." — the Vercel provider never claims otherwise.
  await expect(
    page.locator('[data-testid="publish-success"]'),
  ).toContainText("Your site is live.");
}

/** Close the publish dialog from the success/history view. */
export async function closePublishDialog(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Close publish dialog" }).click();
  await expect(page.getByRole("dialog", { name: /Publish/ })).toHaveCount(0, {
    timeout: 5000,
  });
}

/** Open publish history from the publish dialog header. */
export async function openHistoryFromPublishDialog(page: Page): Promise<void> {
  await page.locator('[data-testid="publish-open-history"]').click();
  await expect(page.locator('[data-testid="deployment-card"]').first()).toBeVisible({
    timeout: 10000,
  });
}

/** Open the deployment details dialog from the current history card. */
export async function openDeploymentDetails(page: Page): Promise<void> {
  await page.locator('[data-testid="deployment-details"]').first().click();
  await expect(
    page.getByRole("dialog", { name: "Deployment details" }),
  ).toBeVisible({ timeout: 5000 });
}

/** Edit the hero headline through the section inspector. */
export async function editHeroHeadline(page: Page, text: string): Promise<void> {
  const wrappers = page.locator('[data-testid="section-wrapper"]');
  await wrappers.nth(1).click();
  const inspector = page.locator('[data-testid="inspector-panel"]');
  await expect(inspector).toBeVisible({ timeout: 5000 });
  const headline = inspector.locator("textarea").first();
  await headline.fill(text);
  await headline.blur();
  await expect(
    page.locator('[data-testid="preview-content"]').getByText(text, { exact: true }),
  ).toBeVisible({ timeout: 5000 });
}
