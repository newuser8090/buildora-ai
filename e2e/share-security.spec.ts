import { test, expect } from "@playwright/test";
import { attachRuntimeAudit, assertRuntimeClean } from "./helpers/runtime-audit";
import {
  openOwnerEditor,
  signInOwner,
  createReviewLink,
  tokenOf,
  apiCreateShare,
  apiPushProjection,
  apiRevokeShare,
  apiResolveToken,
  apiSubmitComment,
  minimalProjection,
  ownerEmail,
  openShareDialog,
} from "./helpers/share";

// ---------------------------------------------------------------------------
// Phase P12 — E2E: share security boundaries
//
// Verifies, end-to-end against the mock backend's real API surface:
//   - fake / expired / revoked tokens are denied (server-enforced)
//   - feedback-disabled shares reject comment writes
//   - malicious comment bodies are stored and rendered as plain text (no
//     script execution), and never echoed back as raw errors
//   - a token for project A can never resolve project B's content
//   - the public response exposes only the sanitized projection (no editor
//     /private state, no tokens, no owner data)
//   - unknown endpoints / bad input return safe envelopes, never raw errors
// ---------------------------------------------------------------------------

test.describe("Share security boundaries", () => {
  test("tokens, expiration, revocation, isolation, and comment safety", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const password = "password123";

    // ----------------------------- Owner -----------------------------
    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    const auditOwner = attachRuntimeAudit(owner);

    await openOwnerEditor(owner);
    await signInOwner(owner, ownerEmail("security"), password);

    // ----------------------------- Fake token -----------------------------
    const fake = await apiResolveToken(owner, "fake-token-fake-token-fake-token");
    expect(fake.status).toBe(404);
    expect(fake.body.ok).toBe(false);
    expect(fake.body.error?.code).toBe("INVALID_TOKEN");
    // No raw backend error text leaks into the message.
    expect(fake.body.error?.message).toContain("isn't working");

    // ----------------------------- Expired token -----------------------------
    const expired = await apiCreateShare(owner, {
      projectId: "proj-expired",
      feedbackEnabled: true,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await apiPushProjection(
      owner,
      String(expired.link.id),
      minimalProjection("Expired Site", "proj-expired"),
    );
    const expiredRes = await apiResolveToken(owner, expired.rawToken);
    expect(expiredRes.status).toBe(410);
    expect(expiredRes.body.error?.code).toBe("EXPIRED");
    expect(expiredRes.body.error?.message).toContain("expired");

    // ----------------------------- Revoked token -----------------------------
    const revoked = await apiCreateShare(owner, {
      projectId: "proj-revoked",
      feedbackEnabled: true,
    });
    await apiPushProjection(
      owner,
      String(revoked.link.id),
      minimalProjection("Revoked Site", "proj-revoked"),
    );
    await apiRevokeShare(owner, String(revoked.link.id));
    const revokedRes = await apiResolveToken(owner, revoked.rawToken);
    expect(revokedRes.status).toBe(410);
    expect(revokedRes.body.error?.code).toBe("REVOKED");
    expect(revokedRes.body.error?.message).toContain("no longer available");

    // ----------------------------- Feedback disabled -----------------------------
    const noFeedback = await apiCreateShare(owner, {
      projectId: "proj-nofb",
      feedbackEnabled: false,
    });
    await apiPushProjection(
      owner,
      String(noFeedback.link.id),
      minimalProjection("No Feedback", "proj-nofb"),
    );
    const writeDenied = await apiSubmitComment(owner, String(noFeedback.link.id), noFeedback.rawToken, {
      body: "hello",
    });
    expect(writeDenied.status).toBe(403);
    expect(writeDenied.body.error?.code).toBe("FEEDBACK_DISABLED");

    // ----------------------------- Cross-project isolation -----------------------------
    const shareA = await apiCreateShare(owner, { projectId: "proj-a", feedbackEnabled: true });
    await apiPushProjection(owner, String(shareA.link.id), minimalProjection("Site A", "proj-a"));
    const shareB = await apiCreateShare(owner, { projectId: "proj-b", feedbackEnabled: true });
    await apiPushProjection(owner, String(shareB.link.id), minimalProjection("Site B", "proj-b"));

    const resolveA = await apiResolveToken(owner, shareA.rawToken);
    expect(resolveA.status).toBe(200);
    const dataA = resolveA.body.data as {
      share: { projectId: string; shareId: string };
      projection: { name: string };
    };
    // Isolation: A's token resolves exactly A's share...
    expect(dataA.share.shareId).toBe(String(shareA.link.id));
    // ...and the public response never carries the canonical project id.
    expect(dataA.share.projectId).toBe("");
    expect(dataA.projection.name).toBe("Site A");

    const resolveB = await apiResolveToken(owner, shareB.rawToken);
    expect(resolveB.status).toBe(200);
    const dataB = resolveB.body.data as {
      share: { projectId: string; shareId: string };
      projection: { name: string };
    };
    expect(dataB.share.shareId).toBe(String(shareB.link.id));
    expect(dataB.share.projectId).toBe("");
    expect(dataB.projection.name).toBe("Site B");

    // A's token never leaks B's content.
    const rawA = JSON.stringify(resolveA.body.data);
    expect(rawA).not.toContain("Site B");
    expect(rawA).not.toContain("proj-b");

    // ----------------------------- Malicious comment -----------------------------
    // The comment must be submitted against a share of the LIVE editor
    // project so the owner's review panel can list it. Create it via the UI
    // (feedback on), then submit the payload through the real API.
    const malShareUrl = await createReviewLink(owner);
    const malToken = tokenOf(malShareUrl);
    const malId = await owner.evaluate(async (rawToken) => {
      const res = await fetch(`/api/share/view/${encodeURIComponent(rawToken)}`);
      const body = (await res.json()) as { data?: { share?: { shareId?: string } } };
      return body.data?.share?.shareId ?? "";
    }, malToken);
    expect(malId).not.toBe("");

    const maliciousBody =
      '<img src=x onerror="alert(1)"> <script>window.__pwned=1</script>';
    const submitRes = await apiSubmitComment(owner, malId, malToken, {
      body: maliciousBody,
    });
    expect(submitRes.status).toBe(200);

    // Owner opens the review panel: the body renders as PLAIN TEXT. No alert
    // dialog, no script execution, no injected element.
    let dialogs = 0;
    owner.on("dialog", () => {
      dialogs += 1;
    });
    await openShareDialog(owner);
    await owner.getByRole("tab", { name: "Review feedback" }).click();
    // Only this one comment exists (fresh owner) — grab the single comment.
    const comment = owner.locator('[data-testid="review-comment"]').first();
    // The comment body is present as text content (the script tag is inert).
    await expect(comment).toContainText("<script>window.__pwned=1</script>", {
      timeout: 15000,
    });
    await expect(comment).toContainText('<img src=x onerror="alert(1)">');
    expect(dialogs).toBe(0);
    // No injected DOM element was created (Next.js injects its own scripts,
    // so only assert the attacker-controlled payload is absent).
    await expect(owner.locator("img[onerror]")).toHaveCount(0);
    await expect(owner.locator("script").filter({ hasText: "__pwned" })).toHaveCount(0);

    // ----------------------------- Public response hygiene -----------------------------
    // The public resolve envelope exposes only the sanitized projection.
    expect(dataA.share).not.toHaveProperty("token");
    expect(dataA.share).not.toHaveProperty("owner");
    const projectionA = dataA.projection as Record<string, unknown>;
    expect(projectionA.id).toBe("");
    expect(projectionA).not.toHaveProperty("createdAt");
    expect(projectionA).not.toHaveProperty("updatedAt");
    expect(rawA).not.toContain("mock_session");
    expect(rawA).not.toContain("session");

    // ----------------------------- No raw backend errors -----------------------------
    // Unknown owner endpoint returns a safe envelope (never a stack trace).
    const unknownRes = await owner.request.get(
      "http://localhost:3000/api/share/nonexistent-xyz",
      {
        headers: {
          Authorization: `Bearer ${(await owner.evaluate(() => localStorage.getItem("buildora.mock_session"))) ?? ""}`,
        },
      },
    );
    expect(unknownRes.status()).toBe(404);
    const unknownBody = (await unknownRes.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string };
    };
    expect(unknownBody.ok).toBe(false);
    expect(unknownBody.error?.message).not.toMatch(/at |Error:|stack|sql|select/i);

    assertRuntimeClean(auditOwner.state);

    await ownerContext.close();
  });
});
