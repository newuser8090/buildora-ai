// ---------------------------------------------------------------------------
// Share Links & Review Experience (Phase P12) — SupabaseShareProvider
//
// Implements ShareLinkProvider against the Supabase RPCs defined in
// supabase/migrations/20260809000001_share_review_schema.sql. All
// authorization is enforced server-side (SECURITY DEFINER RPCs + RLS) — this
// provider is a thin typed client and never trusts client-side checks.
//
// The raw token is generated inside create_share_link / regenerate_share_link
// and returned exactly once; the provider builds the public URL from the
// current origin and the raw token.
// ---------------------------------------------------------------------------

import { getSupabaseClient } from "@/features/auth/supabase-client";
import { makeShareError, type ShareError } from "../errors";
import { EXPIRY_PRESETS } from "../constants";
import type {
  PublicShareResult,
  ReviewComment,
  ReviewCommentInput,
  ShareExpiryPreset,
  ShareLinkSummary,
  ShareLinkWithToken,
  ShareProjection,
} from "../types";
import type {
  CreateShareInput,
  ShareLinkProvider,
  UpdateShareInput,
} from "./share-link-provider";

interface RpcResult<T> {
  data: T | null;
  error: { message: string } | null;
}

interface CreatedShare {
  id: string;
  rawToken: string;
  summary: unknown;
}

interface ResolveRow {
  state: "active" | "invalid" | "expired" | "revoked";
  share_id: string;
  project_name: string;
  feedback_enabled: boolean;
  require_name: boolean;
  projection: unknown;
}

/** Convert an RPC failure into a structured share error. */
function rpcError(message: string): ShareError {
  const text = (message || "").trim().toUpperCase();
  switch (text) {
    case "AUTH_REQUIRED":
      return makeShareError("AUTH_REQUIRED", "Sign in to share this website.");
    case "INVALID_TOKEN":
      return makeShareError("INVALID_TOKEN", "This review link isn't working.");
    case "EXPIRED":
      return makeShareError("EXPIRED", "This review link has expired.");
    case "REVOKED":
      return makeShareError("REVOKED", "This review link is no longer available.");
    case "FEEDBACK_DISABLED":
      return makeShareError("FEEDBACK_DISABLED", "Feedback isn't enabled for this review link.");
    case "RATE_LIMITED":
      return makeShareError("RATE_LIMITED", "Too many comments — please wait a moment and try again.");
    case "INVALID_INPUT":
      return makeShareError("INVALID_INPUT", "Please check your input and try again.");
    case "PROJECTION_TOO_LARGE":
      return makeShareError("PROJECTION_TOO_LARGE", "This website is too large to share right now.");
    case "NOT_FOUND":
      return makeShareError("NOT_FOUND", "That review link could not be found.");
    default:
      return makeShareError(
        "NETWORK_FAILED",
        "The review service is having trouble. Please try again shortly.",
        message,
      );
  }
}

function throwRpc(rpcName: string, err: { message: string } | null): never {
  throw rpcError(err?.message ?? `RPC ${rpcName} failed`);
}

function shareUrl(rawToken: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/share/${rawToken}`;
}

function parseSummary(raw: unknown): ShareLinkSummary {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: typeof r.id === "string" ? r.id : "",
    projectId: typeof r.projectId === "string" ? r.projectId : "",
    status: r.status === "revoked" ? "revoked" : "active",
    feedbackEnabled: r.feedbackEnabled === true,
    requireName: r.requireName === true,
    expiresAt: typeof r.expiresAt === "string" ? r.expiresAt : null,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
    lastOpenedAt: typeof r.lastOpenedAt === "string" ? r.lastOpenedAt : null,
    feedbackCount: typeof r.feedbackCount === "number" ? r.feedbackCount : 0,
  };
}

function parseComment(raw: unknown): ReviewComment {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: typeof r.id === "string" ? r.id : "",
    shareId: typeof r.shareId === "string" ? r.shareId : "",
    projectId: typeof r.projectId === "string" ? r.projectId : "",
    pageId: typeof r.pageId === "string" ? r.pageId : undefined,
    sectionId: typeof r.sectionId === "string" ? r.sectionId : undefined,
    authorName: typeof r.authorName === "string" ? r.authorName : undefined,
    body: typeof r.body === "string" ? r.body : "",
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
    resolvedAt: typeof r.resolvedAt === "string" ? r.resolvedAt : null,
  };
}

function expiresAtFromPreset(preset: ShareExpiryPreset): string | null {
  const entry = EXPIRY_PRESETS.find((p) => p.id === preset);
  if (!entry || entry.expiresInMs === null) return null;
  return new Date(Date.now() + entry.expiresInMs).toISOString();
}

export class SupabaseShareProvider implements ShareLinkProvider {
  readonly kind = "supabase" as const;

  private client() {
    const client = getSupabaseClient();
    if (!client) {
      throw makeShareError("NOT_CONFIGURED", "Review links aren't set up for this app yet.");
    }
    return client;
  }

  async createShare(input: CreateShareInput): Promise<ShareLinkWithToken> {
    const { data, error } = (await this.client().rpc("create_share_link", {
      p_project_id: input.projectId,
      p_feedback_enabled: input.feedbackEnabled,
      p_require_name: input.requireName,
      p_expires_at: expiresAtFromPreset(input.preset),
    })) as RpcResult<CreatedShare>;
    if (error || !data || !data.rawToken) throwRpc("create_share_link", error);
    return {
      link: parseSummary(data.summary),
      rawToken: data.rawToken,
      url: shareUrl(data.rawToken),
    };
  }

  async listShares(projectId: string): Promise<ShareLinkSummary[]> {
    const { data, error } = (await this.client().rpc("list_share_links", {
      p_project_id: projectId,
    })) as RpcResult<unknown[]>;
    if (error) throwRpc("list_share_links", error);
    return Array.isArray(data) ? data.map(parseSummary) : [];
  }

  async shareStatusBatch(projectIds: string[]): Promise<Record<string, boolean>> {
    const { data, error } = (await this.client().rpc("share_status_batch", {
      p_project_ids: projectIds,
    })) as RpcResult<Array<{ project_id: string; has_active: boolean }>>;
    if (error) throwRpc("share_status_batch", error);
    const out: Record<string, boolean> = {};
    for (const row of Array.isArray(data) ? data : []) {
      out[row.project_id] = row.has_active === true;
    }
    return out;
  }

  async updateShare(id: string, patch: UpdateShareInput): Promise<ShareLinkSummary> {
    const args: Record<string, unknown> = { p_share_id: id };
    if (patch.feedbackEnabled !== undefined) args.p_feedback_enabled = patch.feedbackEnabled;
    if (patch.requireName !== undefined) args.p_require_name = patch.requireName;
    if (patch.preset !== undefined) {
      args.p_expires_at = expiresAtFromPreset(patch.preset);
      // "Never" (null) must actually clear an existing expiry — a null
      // parameter would coalesce into a no-op server-side, so signal the
      // clear explicitly (matches the mock's handleUpdateShare behavior).
      args.p_clear_expiry = args.p_expires_at === null;
    }
    const { data, error } = (await this.client().rpc("update_share_link", args)) as RpcResult<unknown>;
    if (error) throwRpc("update_share_link", error);
    return parseSummary(data);
  }

  async pushSnapshot(id: string, projectionJson: string, projectRevision: number): Promise<void> {
    let projection: unknown = null;
    try {
      projection = JSON.parse(projectionJson);
    } catch {
      throw makeShareError("INVALID_INPUT", "The website snapshot isn't valid.");
    }
    const { error } = (await this.client().rpc("push_share_snapshot", {
      p_share_id: id,
      p_projection: projection,
      p_projection_revision: projectRevision,
    })) as RpcResult<null>;
    if (error) throwRpc("push_share_snapshot", error);
  }

  async regenerateShare(id: string): Promise<ShareLinkWithToken> {
    const { data, error } = (await this.client().rpc("regenerate_share_link", {
      p_share_id: id,
    })) as RpcResult<CreatedShare>;
    if (error || !data || !data.rawToken) throwRpc("regenerate_share_link", error);
    return {
      link: parseSummary(data.summary),
      rawToken: data.rawToken,
      url: shareUrl(data.rawToken),
    };
  }

  async revokeShare(id: string): Promise<void> {
    const { error } = (await this.client().rpc("revoke_share_link", {
      p_share_id: id,
    })) as RpcResult<null>;
    if (error) throwRpc("revoke_share_link", error);
  }

  async listComments(shareId: string): Promise<ReviewComment[]> {
    const { data, error } = (await this.client().rpc("list_review_comments", {
      p_share_id: shareId,
    })) as RpcResult<unknown[]>;
    if (error) throwRpc("list_review_comments", error);
    return Array.isArray(data) ? data.map(parseComment) : [];
  }

  async submitComment(
    shareId: string,
    rawToken: string,
    input: ReviewCommentInput,
  ): Promise<ReviewComment> {
    const { data, error } = (await this.client().rpc("submit_review_comment", {
      p_token: rawToken,
      p_share_id: shareId,
      p_page_id: input.pageId ?? null,
      p_section_id: input.sectionId ?? null,
      p_author_name: input.authorName ?? null,
      p_body: input.body,
    })) as RpcResult<unknown>;
    if (error) throwRpc("submit_review_comment", error);
    return parseComment(data);
  }

  async setCommentResolved(shareId: string, commentId: string, resolved: boolean): Promise<void> {
    const { error } = (await this.client().rpc("set_comment_resolved", {
      p_share_id: shareId,
      p_comment_id: commentId,
      p_resolved: resolved,
    })) as RpcResult<null>;
    if (error) throwRpc("set_comment_resolved", error);
  }

  async deleteComment(shareId: string, commentId: string): Promise<void> {
    const { error } = (await this.client().rpc("delete_review_comment", {
      p_share_id: shareId,
      p_comment_id: commentId,
    })) as RpcResult<null>;
    if (error) throwRpc("delete_review_comment", error);
  }

  async resolvePublic(rawToken: string): Promise<PublicShareResult> {
    const { data, error } = (await this.client().rpc("resolve_share", {
      p_token: rawToken,
    })) as RpcResult<ResolveRow[]>;
    if (error || !Array.isArray(data) || data.length === 0) {
      throw makeShareError("NETWORK_FAILED", "Couldn't reach the review service. Please try again.");
    }
    const row = data[0];
    if (row.state !== "active") {
      return { ok: false, state: row.state };
    }
    return {
      ok: true,
      state: "active",
      share: {
        shareId: row.share_id,
        projectId: "",
        projectName: row.project_name,
        feedbackEnabled: row.feedback_enabled,
        requireName: row.require_name,
      },
      projection: row.projection as ShareProjection,
    };
  }

  async deleteProjectShareData(
    projectId: string,
  ): Promise<{ revokedShares: number; deletedComments: number }> {
    const { data, error } = (await this.client().rpc("delete_share_data_for_project", {
      p_project_id: projectId,
    })) as RpcResult<{ revokedShares: number; deletedComments: number }>;
    if (error) throwRpc("delete_share_data_for_project", error);
    return {
      revokedShares: data?.revokedShares ?? 0,
      deletedComments: data?.deletedComments ?? 0,
    };
  }
}
