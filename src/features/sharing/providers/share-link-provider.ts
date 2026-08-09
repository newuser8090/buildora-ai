// ---------------------------------------------------------------------------
// Share Links & Review Experience (Phase P12) — provider interface
//
// The UI never talks to a backend directly; it goes through this provider
// boundary (same pattern as CloudLibraryProvider in Phase P6). Authorization
// is ALWAYS enforced server-side (RLS + RPCs / mock enforcement) — the
// client never trusts itself.
// ---------------------------------------------------------------------------

import type {
  PublicShareResult,
  ReviewComment,
  ReviewCommentInput,
  ShareExpiryPreset,
  ShareLinkSummary,
  ShareLinkWithToken,
} from "../types";

export interface CreateShareInput {
  projectId: string;
  feedbackEnabled: boolean;
  requireName: boolean;
  preset: ShareExpiryPreset;
}

export interface UpdateShareInput {
  feedbackEnabled?: boolean;
  requireName?: boolean;
  preset?: ShareExpiryPreset;
}

export interface ShareLinkProvider {
  readonly kind: "mock" | "supabase";

  /** Owner: create a share link (returns the raw token exactly once). */
  createShare(input: CreateShareInput): Promise<ShareLinkWithToken>;

  /** Owner: list links for one project. */
  listShares(projectId: string): Promise<ShareLinkSummary[]>;

  /** Owner: lightweight "has active share" per project (dashboard badge). */
  shareStatusBatch(projectIds: string[]): Promise<Record<string, boolean>>;

  /** Owner: update feedback/expiry settings. */
  updateShare(id: string, patch: UpdateShareInput): Promise<ShareLinkSummary>;

  /** Owner: push a fresh sanitized projection (serialized JSON). */
  pushSnapshot(id: string, projectionJson: string, projectRevision: number): Promise<void>;

  /** Owner: rotate the token (old token invalid immediately). */
  regenerateShare(id: string): Promise<ShareLinkWithToken>;

  /** Owner: revoke (immediate server-side). */
  revokeShare(id: string): Promise<void>;

  /** Owner: list comments for a share. */
  listComments(shareId: string): Promise<ReviewComment[]>;

  /** Anonymous: submit a review comment (token proves access). */
  submitComment(
    shareId: string,
    rawToken: string,
    input: ReviewCommentInput,
  ): Promise<ReviewComment>;

  /** Owner: resolve/reopen a comment. */
  setCommentResolved(shareId: string, commentId: string, resolved: boolean): Promise<void>;

  /** Owner: delete a comment. */
  deleteComment(shareId: string, commentId: string): Promise<void>;

  /** Anonymous: resolve a share token → projection or a safe failure state. */
  resolvePublic(rawToken: string): Promise<PublicShareResult>;

  /** Owner: lifecycle cleanup for a deleted project. */
  deleteProjectShareData(projectId: string): Promise<{ revokedShares: number; deletedComments: number }>;
}
