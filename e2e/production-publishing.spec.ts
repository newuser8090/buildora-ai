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
  openDeploymentDetails,
  editHeroHeadline,
} from "./helpers/publishing";

// ---------------------------------------------------------------------------
// Phase P8 — E2E: production publishing (Vercel provider, mock mode)
//
// The Vercel provider requires a signed-in session, so this flow signs up
// first (fresh mock account). Publishing runs against the in-process
// MockVercelServer, so the exact server wire contract is exercised without
// real credentials. Flow:
//   1. create project + sign up
//   2. publish via Vercel → "Your site is live." + live URL
//   3. the live URL is a safe https:// link (open/copy available)
//   4. deployment history shows the Vercel deployment (provider badge)
//   5. deployment details show live URL + current-version badge
//   6. Launch Center shows the current live status + URL
//   7. editing after publish surfaces "Publish updates" (unpublished changes)
//   8. no console/page/network errors
// ---------------------------------------------------------------------------

test.describe("Phase P8 — production publishing (Vercel)", () => {
  test("publish to the internet, verify live link, history, details, and unpublished changes", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const audit = attachRuntimeAudit(page);

    // 1. Project + signed-in session (server-side Vercel auth).
    await createSignedInProjectAndOpenEditor(page);

    // 2. Publish via Vercel → live.
    await publishViaVercel(page);

    // The success screen shows a live link (https, safe to open).
    const liveUrl = await page
      .locator('[data-testid="publish-open-site"]')
      .getAttribute("href");
    expect(liveUrl).toMatch(/^https:\/\/.+\.vercel\.app\/?$/);

    // Copy-link affordance is present.
    await expect(page.locator('[data-testid="publish-copy-link"]')).toBeVisible();

    // 3. Deployment history shows the Vercel deployment.
    await openHistoryFromPublishDialog(page);
    const card = page.locator('[data-testid="deployment-card"]').first();
    await expect(card).toContainText("Vercel");
    await expect(card).toContainText("Current");
    await expect(card.locator('[data-testid="deployment-url"]')).toHaveAttribute(
      "href",
      liveUrl ?? "",
    );

    // 4. Deployment details: live URL + current-version badge.
    await openDeploymentDetails(page);
    const details = page.getByRole("dialog", { name: "Deployment details" });
    await expect(details).toContainText("Current live version");
    await expect(details.locator('[data-testid="details-open-site"]')).toHaveAttribute(
      "href",
      liveUrl ?? "",
    );
    await expect(details.locator('[data-testid="details-copy-link"]')).toBeVisible();
    // Vercel's capabilities surface the domain management action.
    await expect(details.locator('[data-testid="details-manage-domain"]')).toBeVisible();
    // Close the details dialog.
    await page.getByRole("button", { name: "Close deployment details" }).click();

    // 5. Launch Center shows the live status section with the URL.
    await closePublishDialog(page);
    await openLaunchCenter(page);
    await expect(page.locator('[data-testid="launch-live-status"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('[data-testid="launch-live-status"]')).toContainText(
      "Your site is live",
    );
    await expect(page.locator('[data-testid="launch-live-url"]')).toHaveAttribute(
      "href",
      liveUrl ?? "",
    );
    // Close the launch center.
    await page.getByRole("button", { name: "Close launch center" }).click();

    // 6. Editing after publish → "Publish updates" state surfaces.
    await editHeroHeadline(page, "Published Site Headline");
    await expect(page.locator('[data-testid="topnav-publish-button"]')).toContainText(
      "Publish updates",
      { timeout: 10000 },
    );
    // Launch Center flags the unpublished changes too.
    await openLaunchCenter(page);
    await expect(page.locator('[data-testid="launch-publish"]')).toContainText(
      "Publish updates",
    );
    await expect(page.getByRole("dialog", { name: "Launch Center" })).toContainText(
      "You've made changes since the last publish.",
    );

    // 7. No console / page / network errors.
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});
