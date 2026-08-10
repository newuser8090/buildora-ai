// ---------------------------------------------------------------------------
// Share Links & Review Experience (Phase P12) — mock share backend tests
//
// These exercise the SAME authorization semantics as the Supabase RLS/RPCs:
// ownership, token hashing, revocation, expiration, rate limiting, feedback
// gating, and lifecycle cleanup.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  getMockCloudState,
  resetMockCloudState,
  handleSignup,
} from "@/features/cloud-sync/mock/mock-cloud-server";
import {
  MockShareError,
  getMockShareState,
  resetMockShareState,
  handleCreateShare,
  handleListShares,
  handleUpdateShare,
  handlePushSnapshot,
  handleRegenerateShare,
  handleRevokeShare,
  handleListComments,
  handleSubmitComment,
  handleSetCommentResolved,
  handleDeleteComment,
  handleResolveShare,
  handleDeleteProjectShareData,
  handleShareStatusBatch,
} from "../mock/mock-share-server";
import { hashShareTokenSync } from "../token";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";
import { buildShareProjection, serializeProjection } from "../projection/sanitize-share-projection";
import {
  getMockWorkspaceState,
  resetMockWorkspaceState,
  handleCreateWorkspace,
  handleCreateWorkspaceProject,
  handleListMembers,
  handleRemoveMember,
  handleInviteMember,
  handleAcceptInvitation,
} from "@/features/workspaces/mock/mock-workspace-server";
import {
  revokeActiveSharesForProject,
  revokeMemberSharesForWorkspace,
  type MockShareState,
} from "../mock/mock-share-server";

const ORIGIN = "http://localhost:3000";

/** Assert a MockShareError with the exact code (codes live in `err.code`). */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error(`Expected MockShareError with code ${code}, but nothing was thrown`);
  } catch (err) {
    expect(err).toBeInstanceOf(MockShareError);
    expect((err as MockShareError).code).toBe(code);
  }
}

function signUp(email: string): string {
  const state = getMockCloudState();
  const result = handleSignup(state, { email, password: "secret1" });
  return result.token;
}

function createShare(
  state: MockShareState,
  token: string | null,
  overrides: { feedbackEnabled?: boolean; requireName?: boolean; preset?: string; expiresAt?: string | null } = {},
) {
  return handleCreateShare(
    state,
    token,
    {
      projectId: "proj-1",
      feedbackEnabled: overrides.feedbackEnabled ?? true,
      requireName: overrides.requireName ?? false,
      preset: overrides.preset ?? "never",
      ...(overrides.expiresAt !== undefined ? { expiresAt: overrides.expiresAt } : {}),
    },
    ORIGIN,
  );
}

/** Push a small valid projection onto a share. */
function pushProjection(state: MockShareState, token: string, shareId: string): void {
  const result = buildShareProjection(JSON.parse(JSON.stringify(MOCK_PROJECT)) as never);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  handlePushSnapshot(state, token, shareId, {
    projection: serializeProjection(result.projection),
    projectionRevision: 3,
  });
}

beforeEach(() => {
  resetMockCloudState();
  resetMockShareState();
  // The workspace mock state is global; P12 share tests must never inherit
  // seeded workspace projects (which would change share-gate outcomes).
  resetMockWorkspaceState();
  getMockShareState();
});

describe("create + ownership", () => {
  it("creates a share and stores only the token hash", () => {
    const state = getMockShareState();
    const token = signUp("a@example.com");
    const created = createShare(state, token);
    expect(created.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.url).toBe(`${ORIGIN}/share/${created.rawToken}`);
    const record = state.shares.get(created.link.id)!;
    expect(record.tokenHash).toBe(hashShareTokenSync(created.rawToken));
    expect(record.tokenHash).not.toBe(created.rawToken);
    expect(record.ownerId).toBeTruthy();
  });

  it("requires a session", () => {
    const state = getMockShareState();
    expect(() => createShare(state, null)).toThrow(MockShareError);
    expect(() => createShare(state, "bogus-token")).toThrow(MockShareError);
  });

  it("rejects an empty project id", () => {
    const state = getMockShareState();
    const token = signUp("a@example.com");
    expect(() =>
      handleCreateShare(state, token, { projectId: "" }, ORIGIN),
    ).toThrow(MockShareError);
  });

  it("lists only the owner's shares for the project", () => {
    const state = getMockShareState();
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    createShare(state, tokenA);
    const listB = handleListShares(state, tokenB, "proj-1");
    expect(listB).toHaveLength(0);
    const listA = handleListShares(state, tokenA, "proj-1");
    expect(listA).toHaveLength(1);
    // B cannot see or manage A's share.
    const shareId = listA[0].id;
    expect(() => handleRevokeShare(state, tokenB, shareId)).toThrow(MockShareError);
  });
});

describe("expiry", () => {
  it("never-expiring share resolves", () => {
    const state = getMockShareState();
    const token = signUp("a@example.com");
    const created = createShare(state, token);
    pushProjection(state, token, created.link.id);
    const resolved = handleResolveShare(state, created.rawToken);
    expect(resolved.state).toBe("active");
  });

  it("expired share fails with EXPIRED on resolve and on comment submit", () => {
    const state = getMockShareState();
    const token = signUp("a@example.com");
    const created = createShare(state, token, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    pushProjection(state, token, created.link.id);
    expectCode(() => handleResolveShare(state, created.rawToken), "EXPIRED");
    expectCode(
      () =>
        handleSubmitComment(state, created.link.id, {
          token: created.rawToken,
          body: "hello",
        }),
      "EXPIRED",
    );
  });

  it("expiry is server-enforced (never trusts browser time)", () => {
    // The check uses server `now`, so a client clock cannot matter — the
    // test asserts the mock compares against its own Date.now.
    const state = getMockShareState();
    const token = signUp("a@example.com");
    const created = createShare(state, token, { expiresAt: new Date(Date.now() + 5000).toISOString() });
    pushProjection(state, token, created.link.id);
    expect(handleResolveShare(state, created.rawToken).state).toBe("active");
  });

  it("owner can extend an expired link by updating expiry", () => {
    const state = getMockShareState();
    const token = signUp("a@example.com");
    const created = createShare(state, token, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const updated = handleUpdateShare(state, token, created.link.id, {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(updated.expiresAt).not.toBeNull();
    pushProjection(state, token, created.link.id);
    expect(handleResolveShare(state, created.rawToken).state).toBe("active");
  });
});

describe("revoke + regenerate", () => {
  it("revoked token fails immediately with REVOKED", () => {
    const state = getMockShareState();
    const token = signUp("a@example.com");
    const created = createShare(state, token);
    pushProjection(state, token, created.link.id);
    handleRevokeShare(state, token, created.link.id);
    expectCode(() => handleResolveShare(state, created.rawToken), "REVOKED");
    expect(handleListShares(state, token, "proj-1")[0].status).toBe("revoked");
  });

  it("regenerate invalidates the old token and returns a new one", () => {
    const state = getMockShareState();
    const token = signUp("a@example.com");
    const created = createShare(state, token);
    pushProjection(state, token, created.link.id);
    const regenerated = handleRegenerateShare(state, token, created.link.id, ORIGIN);
    expect(regenerated.rawToken).not.toBe(created.rawToken);
    // Old token dies immediately.
    expectCode(() => handleResolveShare(state, created.rawToken), "INVALID_TOKEN");
    // New token works.
    expect(handleResolveShare(state, regenerated.rawToken).state).toBe("active");
  });

  it("revoked shares cannot be regenerated", () => {
    const state = getMockShareState();
    const token = signUp("a@example.com");
    const created = createShare(state, token);
    handleRevokeShare(state, token, created.link.id);
    expectCode(() => handleRegenerateShare(state, token, created.link.id, ORIGIN), "REVOKED");
  });
});

describe("feedback", () => {
  it("submits a bounded comment with optional name", () => {
    const state = getMockShareState();
    const token = signUp("a@example.com");
    const created = createShare(state, token);
    const comment = handleSubmitComment(state, created.link.id, {
      token: created.rawToken,
      authorName: "Sam",
      pageId: "page-1",
      body: "Love the hero!",
    });
    expect(comment.body).toBe("Love the hero!");
    expect(comment.authorName).toBe("Sam");
    expect(comment.pageId).toBe("page-1");
    expect(comment.resolvedAt).toBeNull();
    expect(handleListComments(state, token, created.link.id)).toHaveLength(1);
    expect(state.shares.get(created.link.id)!.feedbackCount).toBe(1);
  });

  it("rejects comments when feedback is disabled", () => {
    const state = getMockShareState();
    const token = signUp("a@example.com");
    const created = createShare(state, token, { feedbackEnabled: false });
    expectCode(
      () => handleSubmitComment(state, created.link.id, { token: created.rawToken, body: "hi" }),
      "FEEDBACK_DISABLED",
    );
  });

  it("requires a name when requireName is on", () => {
    const state = getMockShareState();
    const token = signUp("a@example.com");
    const created = createShare(state, token, { feedbackEnabled: true, requireName: true });
    expectCode(
      () => handleSubmitComment(state, created.link.id, { token: created.rawToken, body: "hi" }),
      "INVALID_INPUT",
    );
    const ok = handleSubmitComment(state, created.link.id, {
      token: created.rawToken,
      authorName: "Sam",
      body: "hi",
    });
    expect(ok.authorName).toBe("Sam");
  });

  it("trims the body, rejects empty and oversized bodies", () => {
    const state = getMockShareState();
    const token = signUp("a@example.com");
    const created = createShare(state, token);
    expectCode(
      () => handleSubmitComment(state, created.link.id, { token: created.rawToken, body: "   " }),
      "INVALID_INPUT",
    );
    // Oversized bodies are REJECTED server-side (defense in depth — the UI
    // clamps, the server refuses anything beyond the cap).
    const long = "x".repeat(2500);
    expectCode(
      () => handleSubmitComment(state, created.link.id, { token: created.rawToken, body: long }),
      "INVALID_INPUT",
    );
    // Exactly-at-limit bodies are accepted and trimmed.
    const atLimit = handleSubmitComment(state, created.link.id, {
      token: created.rawToken,
      body: "  " + "x".repeat(2000) + "  ",
    });
    expect(atLimit.body.length).toBe(2000);
  });

  it("rejects comments with a wrong token (invalid)", () => {
    const state = getMockShareState();
    const token = signUp("a@example.com");
    const created = createShare(state, token);
    expectCode(
      () => handleSubmitComment(state, created.link.id, { token: "wrong-token", body: "hi" }),
      "INVALID_TOKEN",
    );
  });

  it("rate-limits submissions per share", () => {
    const state = getMockShareState();
    const token = signUp("a@example.com");
    const created = createShare(state, token);
    for (let i = 0; i < 20; i++) {
      handleSubmitComment(state, created.link.id, { token: created.rawToken, body: `c${i}` });
    }
    expectCode(
      () => handleSubmitComment(state, created.link.id, { token: created.rawToken, body: "one more" }),
      "RATE_LIMITED",
    );
  });

  it("suppresses duplicate submissions within the window", () => {
    const state = getMockShareState();
    const token = signUp("a@example.com");
    const created = createShare(state, token);
    handleSubmitComment(state, created.link.id, {
      token: created.rawToken,
      authorName: "Sam",
      body: "same text",
    });
    expectCode(
      () =>
        handleSubmitComment(state, created.link.id, {
          token: created.rawToken,
          authorName: "Sam",
          body: "same text",
        }),
      "RATE_LIMITED",
    );
  });

  it("owner resolves, reopens, and deletes comments", () => {
    const state = getMockShareState();
    const token = signUp("a@example.com");
    const created = createShare(state, token);
    const comment = handleSubmitComment(state, created.link.id, {
      token: created.rawToken,
      body: "nice",
    });
    handleSetCommentResolved(state, token, created.link.id, comment.id, true);
    let listed = handleListComments(state, token, created.link.id);
    expect(listed[0].resolvedAt).not.toBeNull();
    handleSetCommentResolved(state, token, created.link.id, comment.id, false);
    listed = handleListComments(state, token, created.link.id);
    expect(listed[0].resolvedAt).toBeNull();
    handleDeleteComment(state, token, created.link.id, comment.id);
    expect(handleListComments(state, token, created.link.id)).toHaveLength(0);
    expect(state.shares.get(created.link.id)!.feedbackCount).toBe(0);
  });

  it("only the owner can manage comments", () => {
    const state = getMockShareState();
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const created = createShare(state, tokenA);
    const comment = handleSubmitComment(state, created.link.id, {
      token: created.rawToken,
      body: "nice",
    });
    expect(() => handleListComments(state, tokenB, created.link.id)).toThrow(MockShareError);
    expect(() => handleSetCommentResolved(state, tokenB, created.link.id, comment.id, true)).toThrow(
      MockShareError,
    );
    expect(() => handleDeleteComment(state, tokenB, created.link.id, comment.id)).toThrow(
      MockShareError,
    );
  });
});

describe("public resolve", () => {
  it("invalid token → INVALID_TOKEN (never reveals which link exists)", () => {
    const state = getMockShareState();
    expectCode(() => handleResolveShare(state, "fake-token-fake-token-fake-token"), "INVALID_TOKEN");
  });

  it("cross-project isolation: a token only ever resolves its own project", () => {
    const state = getMockShareState();
    const token = signUp("a@example.com");
    const shareA = createShare(state, token); // project proj-1
    pushProjection(state, token, shareA.link.id);
    // A second share for another project cannot be reached with A's token.
    const shareB = handleCreateShare(state, token, { projectId: "proj-2" }, ORIGIN);
    expect(shareB.link.id).not.toBe(shareA.link.id);
    const resolved = handleResolveShare(state, shareA.rawToken);
    // Isolation: A's token resolves exactly A's share.
    expect(resolved.share.shareId).toBe(shareA.link.id);
    // The public projection never carries the canonical project id (blank,
    // matching the Supabase resolve_share RPC).
    expect(resolved.share.projectId).toBe("");
    // The projection stored under B never leaks through A's token. Push a
    // projection onto B (like pushProjection does for A) so both resolve.
    pushProjection(state, token, shareB.link.id);
    const resolvedB = handleResolveShare(state, shareB.rawToken);
    expect(resolvedB.share.shareId).toBe(shareB.link.id);
    expect(resolvedB.share.projectId).toBe("");
  });

  it("tracks lastOpenedAt (timestamp only) and returns public info without internals", () => {
    const state = getMockShareState();
    const token = signUp("a@example.com");
    const created = createShare(state, token);
    pushProjection(state, token, created.link.id);
    const resolved = handleResolveShare(state, created.rawToken);
    expect(resolved.share.shareId).toBe(created.link.id);
    expect(resolved.share.feedbackEnabled).toBe(true);
    expect(state.shares.get(created.link.id)!.lastOpenedAt).not.toBeNull();
    // Public info never includes the token hash or owner.
    expect(JSON.stringify(resolved.share)).not.toContain("token");
    expect(JSON.stringify(resolved.share)).not.toContain("owner");
  });

  it("a share without a projection never resolves (no private content without upload)", () => {
    const state = getMockShareState();
    const token = signUp("a@example.com");
    const created = createShare(state, token);
    expectCode(() => handleResolveShare(state, created.rawToken), "INVALID_TOKEN");
  });
});

describe("Phase P14 workspace share gates", () => {
  /** Create a workspace with the given project (returns workspaceId). */
  function seedWorkspaceProject(
    ownerToken: string,
    projectId: string,
    workspaceName = "Acme Team",
  ): string {
    const ws = handleCreateWorkspace(getMockWorkspaceState(), ownerToken, { name: workspaceName });
    handleCreateWorkspaceProject(getMockWorkspaceState(), ownerToken, ws.id, {
      projectId,
      project: JSON.parse(JSON.stringify(MOCK_PROJECT)),
    });
    return ws.id;
  }

  /** Invite + accept a user into a workspace with the given role. */
  function joinWorkspace(
    ownerToken: string,
    inviteeToken: string,
    workspaceId: string,
    role: "editor" | "viewer",
  ): void {
    const state = getMockWorkspaceState();
    handleInviteMember(state, ownerToken, workspaceId, {
      email: "b@example.com",
      role,
    });
    const invitation = [...state.invitations.values()].find(
      (i) => i.workspaceId === workspaceId && i.status === "pending",
    )!;
    handleAcceptInvitation(state, inviteeToken, invitation.id);
  }

  it("a viewer in a workspace cannot create a review link for its project", () => {
    const state = getMockShareState();
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const wsId = seedWorkspaceProject(tokenA, "proj-1");
    joinWorkspace(tokenA, tokenB, wsId, "viewer");
    expectCode(
      () => handleCreateShare(state, tokenB, { projectId: "proj-1" }, ORIGIN),
      "PERMISSION_DENIED",
    );
    // Enumeration is also empty for the viewer.
    expect(handleListShares(state, tokenB, "proj-1")).toHaveLength(0);
  });

  it("an editor can create and manage a review link for the workspace project", () => {
    const state = getMockShareState();
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const wsId = seedWorkspaceProject(tokenA, "proj-1");
    joinWorkspace(tokenA, tokenB, wsId, "editor");
    const created = handleCreateShare(state, tokenB, { projectId: "proj-1" }, ORIGIN);
    pushProjection(state, tokenB, created.link.id);
    expect(handleResolveShare(state, created.rawToken).state).toBe("active");
  });

  it("a removed member loses the ability to manage their review links", () => {
    const state = getMockShareState();
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const wsId = seedWorkspaceProject(tokenA, "proj-1");
    joinWorkspace(tokenA, tokenB, wsId, "editor");
    const created = handleCreateShare(state, tokenB, { projectId: "proj-1" }, ORIGIN);
    // Owner removes b — the workspace role check now denies link management.
    const wsState = getMockWorkspaceState();
    const members = handleListMembers(wsState, tokenA, wsId);
    handleRemoveMember(wsState, tokenA, wsId, members[0].userId);
    expectCode(
      () => handleRevokeShare(state, tokenB, created.link.id),
      "PERMISSION_DENIED",
    );
  });

  it("same project id in two workspaces: viewer in ANY workspace is denied", () => {
    const state = getMockShareState();
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    // A owns a workspace where b is an EDITOR, and another where b is a VIEWER
    // — both hold the same project id.
    const wsEditor = seedWorkspaceProject(tokenA, "proj-shared", "Team A");
    const wsViewer = seedWorkspaceProject(tokenA, "proj-shared", "Team B");
    joinWorkspace(tokenA, tokenB, wsEditor, "editor");
    joinWorkspace(tokenA, tokenB, wsViewer, "viewer");
    // Denied: b is a viewer in one of the workspaces holding the id.
    expectCode(
      () => handleCreateShare(state, tokenB, { projectId: "proj-shared" }, ORIGIN),
      "PERMISSION_DENIED",
    );
  });

  it("same project id in two workspaces: editor in ALL workspaces is allowed", () => {
    const state = getMockShareState();
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const ws1 = seedWorkspaceProject(tokenA, "proj-shared", "Team A");
    const ws2 = seedWorkspaceProject(tokenA, "proj-shared", "Team B");
    joinWorkspace(tokenA, tokenB, ws1, "editor");
    joinWorkspace(tokenA, tokenB, ws2, "editor");
    const created = handleCreateShare(state, tokenB, { projectId: "proj-shared" }, ORIGIN);
    expect(created.link.projectId).toBe("proj-shared");
  });

  it("revoking a workspace project's shares kills every active link to it", () => {
    const state = getMockShareState();
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const wsId = seedWorkspaceProject(tokenA, "proj-1");
    joinWorkspace(tokenA, tokenB, wsId, "editor");
    const byOwner = handleCreateShare(state, tokenA, { projectId: "proj-1" }, ORIGIN);
    const byEditor = handleCreateShare(state, tokenB, { projectId: "proj-1" }, ORIGIN);
    const other = handleCreateShare(state, tokenA, { projectId: "proj-2" }, ORIGIN);
    // Project deletion revokes links by project id (across owners).
    const revoked = revokeActiveSharesForProject(state, "proj-1");
    expect(revoked).toBe(2);
    expect(state.shares.get(byOwner.link.id)!.status).toBe("revoked");
    expect(state.shares.get(byEditor.link.id)!.status).toBe("revoked");
    // Unrelated project untouched.
    expect(state.shares.get(other.link.id)!.status).toBe("active");
  });

  it("a removed member's review links are revoked (mirror of ws_revoke_member_shares)", () => {
    const state = getMockShareState();
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const wsId = seedWorkspaceProject(tokenA, "proj-1");
    const wsOther = seedWorkspaceProject(tokenA, "proj-2", "Other Team");
    joinWorkspace(tokenA, tokenB, wsId, "editor");
    joinWorkspace(tokenA, tokenB, wsOther, "editor");
    const inWorkspace = handleCreateShare(state, tokenB, { projectId: "proj-1" }, ORIGIN);
    const otherWorkspace = handleCreateShare(state, tokenB, { projectId: "proj-2" }, ORIGIN);
    // Removal from one workspace revokes only that workspace's project links.
    const userBId = getMockCloudState().sessions.get(tokenB)!;
    const revoked = revokeMemberSharesForWorkspace(state, wsId, userBId);
    expect(revoked).toBe(1);
    expect(state.shares.get(inWorkspace.link.id)!.status).toBe("revoked");
    expect(state.shares.get(otherWorkspace.link.id)!.status).toBe("active");
  });
});

describe("lifecycle cleanup", () => {
  it("delete-project-data revokes shares and deletes comments for that project only", () => {
    const state = getMockShareState();
    const token = signUp("a@example.com");
    const share1 = createShare(state, token);
    const share2 = handleCreateShare(state, token, { projectId: "proj-2" }, ORIGIN);
    handleSubmitComment(state, share1.link.id, { token: share1.rawToken, body: "bye" });
    const result = handleDeleteProjectShareData(state, token, "proj-1");
    expect(result.revokedShares).toBe(1);
    expect(result.deletedComments).toBe(1);
    expect(state.shares.get(share1.link.id)!.status).toBe("revoked");
    // Project 2 untouched.
    expect(state.shares.get(share2.link.id)!.status).toBe("active");
  });

  it("status batch reports only active, non-expired shares", () => {
    const state = getMockShareState();
    const token = signUp("a@example.com");
    createShare(state, token);
    const expired = handleCreateShare(
      state,
      token,
      { projectId: "proj-2", expiresAt: new Date(Date.now() - 1000).toISOString() },
      ORIGIN,
    );
    void expired;
    const batch = handleShareStatusBatch(state, token, ["proj-1", "proj-2", "proj-3"]);
    expect(batch["proj-1"]).toBe(true);
    expect(batch["proj-2"]).toBe(false);
    expect(batch["proj-3"]).toBe(false);
  });
});
