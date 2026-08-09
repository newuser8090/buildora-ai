import { test, expect } from "@playwright/test";
import { attachRuntimeAudit, assertRuntimeClean } from "./helpers/runtime-audit";
import {
  openOwnerEditor,
  signInOwner,
  createReviewLink,
  revokeFirstLink,
  ownerEmail,
} from "./helpers/share";

// ---------------------------------------------------------------------------
// Phase P12 — E2E: review link share flow
//
// Owner (signed in, mock auth) creates a read-only review link from the
// editor. A second browser context (no Buildora account) opens the link and
// sees the shared website with NO editor chrome. The owner revokes the link
// and the viewer's next load shows the revoked message. Runtime audit is
// clean on both sides.
// ---------------------------------------------------------------------------

test.describe("Share review flow", () => {
  test("create link → viewer renders read-only → revoke → viewer loses access", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const password = "password123";

    // ----------------------------- Owner -----------------------------
    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    const auditOwner = attachRuntimeAudit(owner);

    await openOwnerEditor(owner);
    await signInOwner(owner, ownerEmail("review"), password);

    // Give the site a second page so the viewer can navigate pages safely.
    await owner.locator('[data-testid="page-tab-add"]').click();
    await expect(owner.locator('[data-testid="page-rename-input"]')).toBeVisible({
      timeout: 5000,
    });
    await owner.locator('[data-testid="page-rename-input"]').fill("About");
    await owner.locator('[data-testid="page-rename-input"]').press("Enter");
    await expect(owner.locator('[data-testid="page-rename-input"]')).toHaveCount(0, {
      timeout: 5000,
    });

    // Create the review link and capture the URL.
    const shareUrl = await createReviewLink(owner);

    // ----------------------------- Viewer -----------------------------
    const viewerContext = await browser.newContext();
    const viewer = await viewerContext.newPage();
    const auditViewer = attachRuntimeAudit(viewer);

    await viewer.goto(shareUrl);
    await expect(viewer.locator('[data-testid="share-review-badge"]')).toBeVisible({
      timeout: 15000,
    });

    // The shared website renders (the blank template's hero + the second page).
    await expect(viewer.locator('[data-testid="share-page-switcher"]')).toBeVisible();
    const options = viewer.locator('[data-testid="share-page-switcher"] option');
    await expect(options).toHaveCount(2);

    // Navigate pages safely via the switcher.
    await viewer.locator('[data-testid="share-page-switcher"]').selectOption({ index: 1 });
    await expect(viewer.locator('[data-testid="share-review-badge"]')).toBeVisible();

    // NO editor chrome: no TopNav Share button, no undo, no editor root.
    await expect(viewer.locator('[data-testid="topnav-share-button"]')).toHaveCount(0);
    await expect(viewer.locator('[data-testid="undo-button"]')).toHaveCount(0);
    await expect(viewer.locator('[data-testid="editor-root"]')).toHaveCount(0);
    // No account controls either.
    await expect(viewer.locator('[data-testid="cloud-sync-status"]')).toHaveCount(0);

    // ----------------------------- Revoke -----------------------------
    // Back on the owner, stop the link.
    await revokeFirstLink(owner);

    // The viewer's next load shows the revoked message — no stale content.
    await viewer.reload();
    await expect(viewer.locator('[data-testid="share-error-title"]')).toHaveText(
      "This review link is no longer available",
      { timeout: 15000 },
    );
    await expect(viewer.locator('[data-testid="share-review-badge"]')).toHaveCount(0);

    assertRuntimeClean(auditOwner.state);
    assertRuntimeClean(auditViewer.state);

    await ownerContext.close();
    await viewerContext.close();
  });
});
