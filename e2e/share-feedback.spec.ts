import { test, expect } from "@playwright/test";
import { attachRuntimeAudit, assertRuntimeClean } from "./helpers/runtime-audit";
import {
  openOwnerEditor,
  signInOwner,
  createReviewLink,
  tokenOf,
  ownerEmail,
  openShareDialog,
} from "./helpers/share";

// ---------------------------------------------------------------------------
// Phase P12 — E2E: review feedback flow
//
// Owner creates a review link with feedback enabled. A viewer (no account)
// opens the link, leaves a page-scoped comment, and sees the success state.
// The owner opens the canonical review panel, sees the comment grouped by
// page, jumps to the location, then resolves, reopens, and deletes it. The
// viewer cannot reach owner-management endpoints. Runtime audit is clean.
// ---------------------------------------------------------------------------

test.describe("Share feedback flow", () => {
  test("viewer comment → owner review panel → jump → resolve/reopen/delete", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const password = "password123";

    // ----------------------------- Owner -----------------------------
    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    const auditOwner = attachRuntimeAudit(owner);

    await openOwnerEditor(owner);
    await signInOwner(owner, ownerEmail("feedback"), password);

    // Feedback is enabled by default when creating a link.
    const shareUrl = await createReviewLink(owner);
    const rawToken = tokenOf(shareUrl);

    // ----------------------------- Viewer -----------------------------
    const viewerContext = await browser.newContext();
    const viewer = await viewerContext.newPage();
    const auditViewer = attachRuntimeAudit(viewer);

    await viewer.goto(shareUrl);
    await expect(viewer.locator('[data-testid="share-review-badge"]')).toBeVisible({
      timeout: 15000,
    });

    // Leave feedback with an optional name.
    await viewer.locator('[data-testid="share-leave-feedback"]').click();
    await expect(viewer.locator('[data-testid="feedback-sheet"]')).toBeVisible();
    await viewer.locator('[data-testid="feedback-name"]').fill("Sam");
    await viewer.locator('[data-testid="feedback-body"]').fill("Love the hero section!");
    await viewer.locator('[data-testid="feedback-submit"]').click();
    await expect(viewer.locator('[data-testid="feedback-sheet"]')).toContainText(
      /thanks.*feedback was sent/i,
      { timeout: 10000 },
    );
    await viewer.locator('[data-testid="feedback-done"]').click();

    // ----------------------------- Owner review panel -----------------------------
    // Open the canonical share surface → Review feedback tab.
    await openShareDialog(owner);
    await owner.getByRole("tab", { name: "Review feedback" }).click();

    // Feedback appears, grouped under the page title.
    await expect(owner.locator('[data-testid="review-comment"]')).toHaveCount(1, {
      timeout: 15000,
    });
    await expect(owner.locator('[data-testid="review-comment"]')).toContainText(
      "Love the hero section!",
    );
    await expect(owner.locator('[data-testid="review-comment"]')).toContainText("Sam");

    // Jump to the page the comment was left on (page still exists).
    const jump = owner.locator('[data-testid="review-comment"]').getByRole("button", {
      name: /jump to page/i,
    });
    await expect(jump).toBeVisible();
    await jump.click();
    // The dialog closes and the editor selects the commented page.
    await expect(owner.locator('[data-testid="share-dialog"]')).toHaveCount(0, {
      timeout: 5000,
    });
    const selected = owner.locator('[data-page-tab][aria-selected="true"]');
    await expect(selected).toHaveCount(1, { timeout: 5000 });
    expect(await selected.getAttribute("aria-label")).toMatch(/Page: Home/);

    // Back into the review panel: resolve → reopen → delete.
    await openShareDialog(owner);
    await owner.getByRole("tab", { name: "Review feedback" }).click();
    await expect(owner.locator('[data-testid="review-comment"]')).toHaveCount(1, {
      timeout: 10000,
    });

    await owner.locator('[data-testid^="comment-resolve-"]').click();
    await expect(owner.locator('[data-testid^="comment-reopen-"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(owner.locator('[data-testid="review-comment"]')).toContainText("Resolved");

    await owner.locator('[data-testid^="comment-reopen-"]').click();
    await expect(owner.locator('[data-testid^="comment-resolve-"]')).toBeVisible({
      timeout: 10000,
    });

    await owner.locator('[data-testid^="comment-delete-"]').click();
    await expect(owner.locator('[data-testid="share-delete-comment-dialog"]')).toBeVisible();
    await owner.locator('[data-testid="share-delete-comment-confirm"]').click();
    await expect(owner.locator('[data-testid="review-comment"]')).toHaveCount(0, {
      timeout: 10000,
    });

    // ----------------------------- Security boundary -----------------------------
    // The viewer (anonymous) must not reach owner-management endpoints.
    const listRes = await viewer.request.get(
      `http://localhost:3000/api/share?projectId=proj-1`,
    );
    expect(listRes.status()).toBe(401);

    const manageRes = await viewer.request.post(
      `http://localhost:3000/api/share/does-not-exist/revoke`,
    );
    expect(manageRes.status()).toBe(401);

    const commentsRes = await viewer.request.get(
      `http://localhost:3000/api/share/does-not-exist/feedback`,
    );
    expect(commentsRes.status()).toBe(401);

    // Anonymous feedback still works with the raw token (it is a public
    // capability scoped to the token), but the owner deleted this one — the
    // comment is gone from the owner side regardless.
    void rawToken;

    assertRuntimeClean(auditOwner.state);
    assertRuntimeClean(auditViewer.state);

    await ownerContext.close();
    await viewerContext.close();
  });
});
