import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Phase P7 — E2E: publishing history, rollback, and unpublished changes
//
//   1. publish revision A (mock provider)
//   2. edit the project (content change bumps revision)
//   3. publish revision B
//   4. verify two deployment records
//   5. rollback to A with the Mock provider
//   6. verify the active deployment changed
//   7. verify the editor project content remains revision B (rollback never
//      touches project content)
//   8. republish the current project
//   9. verify a new deployment record appears
//  10. no console/page/network errors
// ---------------------------------------------------------------------------

const EDITED_HEADLINE = "Edited Hero Title";

async function openLaunchCenter(page: Page): Promise<void> {
  await page.locator('[data-testid="topnav-publish-button"]').click();
  await expect(page.locator('[data-testid="launch-score"]')).toBeVisible({
    timeout: 10000,
  });
}

/** Publish via the mock provider and wait for the success screen. */
async function publishViaMock(page: Page): Promise<void> {
  await openLaunchCenter(page);
  await page.locator('[data-testid="launch-publish"]').click();
  await expect(
    page.getByRole("dialog", { name: "Publish your site" }),
  ).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="provider-mock"]')).toBeChecked();
  await page.locator('[data-testid="publish-confirm"]').click();
  await expect(page.locator('[data-testid="publish-success"]')).toBeVisible({
    timeout: 30000,
  });
}

async function closePublishDialog(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Close publish dialog" }).click();
  await expect(page.getByRole("dialog", { name: /Publish/ })).toHaveCount(0, {
    timeout: 5000,
  });
}

/** Open the publish history from the publish dialog header. */
async function openHistory(page: Page): Promise<void> {
  await page.locator('[data-testid="publish-open-history"]').click();
  await expect(page.locator('[data-testid="deployment-card"]').first()).toBeVisible({
    timeout: 10000,
  });
}

/** Edit the hero headline through the section inspector. */
async function editHeroHeadline(page: Page, text: string): Promise<void> {
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

test.describe("Phase P7 — publishing history", () => {
  test("publish A → edit → publish B → history → rollback → republish", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const audit = attachRuntimeAudit(page);

    // 1. Publish revision A.
    await createSaaSProjectAndOpenEditor(page);
    await publishViaMock(page);
    await closePublishDialog(page);

    // 2. Edit the project content (revision bumps).
    await editHeroHeadline(page, EDITED_HEADLINE);

    // 3. Publish revision B.
    await publishViaMock(page);
    await closePublishDialog(page);

    // 4. Verify two deployment records in history.
    await openLaunchCenter(page);
    await page.locator('[data-testid="launch-publish"]').click();
    await openHistory(page);
    const cards = page.locator('[data-testid="deployment-card"]');
    await expect(cards).toHaveCount(2, { timeout: 10000 });

    // Newest publish (B) is current; the older one (A) offers rollback.
    await expect(cards.first()).toContainText("Current");
    const cardA = cards.nth(1);
    await expect(cardA.locator('[data-testid="deployment-rollback"]')).toBeVisible();

    // 5. Rollback to revision A with the Mock provider.
    await cardA.locator('[data-testid="deployment-rollback"]').click();
    const confirmDialog = page.getByRole("dialog", { name: "Restore this version?" });
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="rollback-confirm"]').click();
    await expect(page.locator('[data-testid="rollback-error"]')).toHaveCount(0, {
      timeout: 5000,
    });

    // 6. Verify the active deployment changed: A now carries the Current badge
    //    and moves to the top of the list (Current group renders first).
    await expect(cards.first()).toContainText("Current", { timeout: 10000 });
    await expect(cards.first()).toContainText("Published from revision 1");
    await expect(cards.nth(1)).not.toContainText("Current");

    // 7. Rollback never touched editor content — revision B is still open.
    await closePublishDialog(page);
    await expect(
      page.locator('[data-testid="preview-content"]').getByText(EDITED_HEADLINE, {
        exact: true,
      }),
    ).toBeVisible({ timeout: 5000 });

    // 8. Republish the current project.
    await publishViaMock(page);
    await closePublishDialog(page);

    // 9. A new deployment record appears (A, B, and the fresh publish).
    await openLaunchCenter(page);
    await page.locator('[data-testid="launch-publish"]').click();
    await openHistory(page);
    await expect(page.locator('[data-testid="deployment-card"]')).toHaveCount(3, {
      timeout: 10000,
    });
    await expect(
      page.locator('[data-testid="deployment-card"]').first(),
    ).toContainText("Current");

    // 10. No console / page / network errors.
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
