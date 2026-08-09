// ---------------------------------------------------------------------------
// Share Links & Review Experience (Phase P12) — MockHttpShareProvider
// (dev/test backend)
//
// Implements ShareLinkProvider against the in-memory mock share backend
// exposed through Next.js API routes (/api/share/...). Only active when the
// cloud environment is "mock" (dev builds without Supabase env vars). The
// mock backend keeps state server-side so e2e can simulate a viewer on a
// second device hitting the same "cloud".
// ---------------------------------------------------------------------------

import { getMockSessionToken } from "@/features/cloud-sync/providers/mock-session";
import { makeShareError, type ShareError } from "../errors";
import type {
  PublicShareResult,
  ReviewComment,
  ReviewCommentInput,
  ShareApiEnvelope,
  ShareLinkSummary,
  ShareLinkWithToken,
  ShareProjection,
} from "../types";
import type {
  CreateShareInput,
  ShareLinkProvider,
  UpdateShareInput,
} from "./share-link-provider";

interface RawResolveData {
  state: "active";
  share: {
    shareId: string;
    projectId: string;
    projectName: string;
    feedbackEnabled: boolean;
    requireName: boolean;
  };
  projection: unknown;
}

async function mockFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; maxBytes?: number } = {},
): Promise<T> {
  const token = getMockSessionToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  const url = path ? `/api/share/${path}` : "/api/share";
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw makeShareError(
      "NETWORK_FAILED",
      "Couldn't reach the review service. Please try again.",
    );
  }

  const envelope = (await response.json().catch(() => null)) as ShareApiEnvelope<T> | null;
  if (response.ok && envelope?.ok) return envelope.data as T;
  const code = mapErrorCode(envelope?.error?.code);
  // Never leak an unmapped/raw server message to the UI. Known codes get the
  // server copy; UNKNOWN degrades to the safe generic fallback.
  const message =
    code === "UNKNOWN"
      ? "Sharing couldn't complete right now."
      : (envelope?.error?.message ?? "Sharing couldn't complete right now.");
  throw makeShareError(code, message, envelope?.error?.code);
}

function mapErrorCode(code?: string): ShareError["code"] {
  switch (code) {
    case "AUTH_REQUIRED":
      return "AUTH_REQUIRED";
    case "SESSION_EXPIRED":
    case "UNAUTHORIZED":
      return "SESSION_EXPIRED";
    case "PERMISSION_DENIED":
      return "PERMISSION_DENIED";
    case "RATE_LIMITED":
      return "RATE_LIMITED";
    case "INVALID_TOKEN":
      return "INVALID_TOKEN";
    case "EXPIRED":
      return "EXPIRED";
    case "REVOKED":
      return "REVOKED";
    case "FEEDBACK_DISABLED":
      return "FEEDBACK_DISABLED";
    case "NOT_FOUND":
      return "NOT_FOUND";
    case "PROJECTION_TOO_LARGE":
      return "PROJECTION_TOO_LARGE";
    case "INVALID_INPUT":
      return "INVALID_INPUT";
    case "NOT_CONFIGURED":
      return "NOT_CONFIGURED";
    default:
      return "UNKNOWN";
  }
}

export class MockHttpShareProvider implements ShareLinkProvider {
  readonly kind = "mock" as const;

  async createShare(input: CreateShareInput): Promise<ShareLinkWithToken> {
    return mockFetch<ShareLinkWithToken>("", {
      method: "POST",
      body: input,
    });
  }

  async listShares(projectId: string): Promise<ShareLinkSummary[]> {
    const params = new URLSearchParams({ projectId });
    return mockFetch<ShareLinkSummary[]>(`?${params.toString()}`, {});
  }

  async shareStatusBatch(projectIds: string[]): Promise<Record<string, boolean>> {
    const params = new URLSearchParams({ projectIds: projectIds.join(",") });
    return mockFetch<Record<string, boolean>>(`?${params.toString()}`, {});
  }

  async updateShare(id: string, patch: UpdateShareInput): Promise<ShareLinkSummary> {
    return mockFetch<ShareLinkSummary>(encodeURIComponent(id), {
      method: "PATCH",
      body: patch,
    });
  }

  async pushSnapshot(id: string, projectionJson: string, projectRevision: number): Promise<void> {
    await mockFetch<void>(`${encodeURIComponent(id)}/snapshot`, {
      method: "POST",
      body: { projection: projectionJson, projectionRevision: projectRevision },
      maxBytes: 8 * 1024 * 1024,
    });
  }

  async regenerateShare(id: string): Promise<ShareLinkWithToken> {
    return mockFetch<ShareLinkWithToken>(`${encodeURIComponent(id)}/regenerate`, {
      method: "POST",
    });
  }

  async revokeShare(id: string): Promise<void> {
    await mockFetch<void>(`${encodeURIComponent(id)}/revoke`, { method: "POST" });
  }

  async listComments(shareId: string): Promise<ReviewComment[]> {
    return mockFetch<ReviewComment[]>(`${encodeURIComponent(shareId)}/feedback`, {});
  }

  async submitComment(
    shareId: string,
    rawToken: string,
    input: ReviewCommentInput,
  ): Promise<ReviewComment> {
    return mockFetch<ReviewComment>(`${encodeURIComponent(shareId)}/feedback`, {
      method: "POST",
      body: { ...input, token: rawToken },
    });
  }

  async setCommentResolved(shareId: string, commentId: string, resolved: boolean): Promise<void> {
    await mockFetch<void>(`${encodeURIComponent(shareId)}/feedback/${encodeURIComponent(commentId)}`, {
      method: "PATCH",
      body: { resolved },
    });
  }

  async deleteComment(shareId: string, commentId: string): Promise<void> {
    await mockFetch<void>(
      `${encodeURIComponent(shareId)}/feedback/${encodeURIComponent(commentId)}`,
      { method: "DELETE" },
    );
  }

  async resolvePublic(rawToken: string): Promise<PublicShareResult> {
    try {
      const data = await mockFetch<RawResolveData>(`view/${encodeURIComponent(rawToken)}`, {});
      return {
        ok: true,
        state: "active",
        share: data.share,
        projection: data.projection as ShareProjection,
      };
    } catch (err) {
      const shareErr = toShareErrorSafe(err);
      switch (shareErr.code) {
        case "INVALID_TOKEN":
          return { ok: false, state: "invalid" };
        case "EXPIRED":
          return { ok: false, state: "expired" };
        case "REVOKED":
          return { ok: false, state: "revoked" };
        default:
          throw err;
      }
    }
  }

  async deleteProjectShareData(
    projectId: string,
  ): Promise<{ revokedShares: number; deletedComments: number }> {
    return mockFetch<{ revokedShares: number; deletedComments: number }>(
      "delete-project-data",
      { method: "POST", body: { projectId } },
    );
  }
}

/** Narrow helper: convert a thrown value to a ShareError without rethrowing. */
function toShareErrorSafe(err: unknown): ShareError {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    const candidate = err as { code?: unknown; message?: unknown };
    if (
      typeof candidate.code === "string" &&
      typeof candidate.message === "string"
    ) {
      return candidate as unknown as ShareError;
    }
  }
  return makeShareError("UNKNOWN", "Sharing couldn't complete right now.");
}
