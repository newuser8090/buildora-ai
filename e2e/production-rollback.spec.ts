import { test, expect } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import {
  createSignedInProjectAndOpenEditor,
  openLaunchCenter,
  publishViaVercel,
  closePublishDialog,
  openHistoryFromPublishDialog,
  editHeroHeadline,
} from "./helpers/publishing";

// ---------------------------------------------------------------------------
// Phase P8 — E2E: production rollback (Vercel provider, mock mode)
//
//   1. publish revision A via Vercel (live)
//   2. edit the project (revision bumps)
//   3. publish revision B via Vercel (live)
//   4. history shows two live deployments; B is current
//   5. rollback to A → the provider re-points the production alias
//   6. A becomes the current version; editor content stays at B (rollback
//      never touches project content)
//   7. no console/page/network errors
// ---------------------------------------------------------------------------

const EDITED_HEADLINE = "Rollback Target Headline";

test.describe("Phase P8 — production rollback (Vercel)", () => {
  test("publish A → edit → publish B → rollback to A", async ({ page }) => {
    test.setTimeout(300_000);
    const audit = attachRuntimeAudit(page);

    // 1. Project + signed-in session.
    await createSignedInProjectAndOpenEditor(page);

    // 2. Publish revision A via Vercel.
    await publishViaVercel(page);
    await closePublishDialog(page);

    // 3. Edit the project content (revision bumps).
    await editHeroHeadline(page, EDITED_HEADLINE);

    // 4. Publish revision B via Vercel.
    await publishViaVercel(page);
    await closePublishDialog(page);

    // 5. History shows two live deployments; newest (B) is current.
    await openLaunchCenter(page);
    await page.locator('[data-testid="launch-publish"]').click();
    await openHistoryFromPublishDialog(page);
    const cards = page.locator('[data-testid="deployment-card"]');
    await expect(cards).toHaveCount(2, { timeout: 10000 });
    await expect(cards.first()).toContainText("Current");

    // 6. Roll back to A with the Vercel provider.
    const cardA = cards.nth(1);
    await expect(cardA.locator('[data-testid="deployment-rollback"]')).toBeVisible();
    await cardA.locator('[data-testid="deployment-rollback"]').click();
    const confirmDialog = page.getByRole("dialog", { name: "Restore this version?" });
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="rollback-confirm"]').click();
    await expect(page.locator('[data-testid="rollback-error"]')).toHaveCount(0, {
      timeout: 10000,
    });

    // The active deployment changed: A now carries the Current badge and
    // moves to the top of the history list (Current group renders first).
    await expect(cards.first()).toContainText("Current", { timeout: 10000 });
    await expect(cards.first()).toContainText("Published from revision 1");
    await expect(cards.nth(1)).not.toContainText("Current");

    // 7. Rollback never touched editor content — B is still open.
    await closePublishDialog(page);
    await expect(
      page.locator('[data-testid="preview-content"]').getByText(EDITED_HEADLINE, {
        exact: true,
      }),
    ).toBeVisible({ timeout: 5000 });

    // 8. No console / page / network errors.
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
