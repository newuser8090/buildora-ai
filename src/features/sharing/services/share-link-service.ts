// ---------------------------------------------------------------------------
// Share Links & Review Experience (Phase P12) — service
//
// Thin, provider-independent service used by the UI (mirrors
// SharedLibraryService). All authorization is enforced server-side (RLS +
// RPCs / mock enforcement). Every action returns structured errors mapped to
// beginner-safe copy; malformed provider responses degrade to a safe error.
// ---------------------------------------------------------------------------

import { getCloudEnvironment } from "@/features/cloud-sync/cloud-environment";
import { toShareError } from "../errors";
import type {
  PublicShareResult,
  ReviewComment,
  ReviewCommentInput,
  ShareExpiryPreset,
  ShareLinkSummary,
  ShareLinkWithToken,
  ShareResult,
} from "../types";
import type { CreateShareInput, ShareLinkProvider } from "../providers/share-link-provider";
import { MockHttpShareProvider } from "../providers/mock-http-share-provider";
import { SupabaseShareProvider } from "../providers/supabase-share-provider";

export class ShareLinkService {
  private provider: ShareLinkProvider;

  constructor(provider: ShareLinkProvider) {
    this.provider = provider;
  }

  async create(
    input: CreateShareInput,
  ): Promise<ShareResult<ShareLinkWithToken>> {
    try {
      return { ok: true, value: await this.provider.createShare(input) };
    } catch (err) {
      return { ok: false, error: toShareError(err) };
    }
  }

  async list(projectId: string): Promise<ShareResult<ShareLinkSummary[]>> {
    try {
      return { ok: true, value: await this.provider.listShares(projectId) };
    } catch (err) {
      return { ok: false, error: toShareError(err) };
    }
  }

  async statusBatch(projectIds: string[]): Promise<ShareResult<Record<string, boolean>>> {
    try {
      return { ok: true, value: await this.provider.shareStatusBatch(projectIds) };
    } catch (err) {
      return { ok: false, error: toShareError(err) };
    }
  }

  async update(
    id: string,
    patch: { feedbackEnabled?: boolean; requireName?: boolean; preset?: ShareExpiryPreset },
  ): Promise<ShareResult<ShareLinkSummary>> {
    try {
      return { ok: true, value: await this.provider.updateShare(id, patch) };
    } catch (err) {
      return { ok: false, error: toShareError(err) };
    }
  }

  async pushSnapshot(
    id: string,
    projectionJson: string,
    projectRevision: number,
  ): Promise<ShareResult<void>> {
    try {
      await this.provider.pushSnapshot(id, projectionJson, projectRevision);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: toShareError(err) };
    }
  }

  async regenerate(id: string): Promise<ShareResult<ShareLinkWithToken>> {
    try {
      return { ok: true, value: await this.provider.regenerateShare(id) };
    } catch (err) {
      return { ok: false, error: toShareError(err) };
    }
  }

  async revoke(id: string): Promise<ShareResult<void>> {
    try {
      await this.provider.revokeShare(id);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: toShareError(err) };
    }
  }

  async listComments(shareId: string): Promise<ShareResult<ReviewComment[]>> {
    try {
      return { ok: true, value: await this.provider.listComments(shareId) };
    } catch (err) {
      return { ok: false, error: toShareError(err) };
    }
  }

  async submitComment(
    shareId: string,
    rawToken: string,
    input: ReviewCommentInput,
  ): Promise<ShareResult<ReviewComment>> {
    try {
      return { ok: true, value: await this.provider.submitComment(shareId, rawToken, input) };
    } catch (err) {
      return { ok: false, error: toShareError(err) };
    }
  }

  async setCommentResolved(
    shareId: string,
    commentId: string,
    resolved: boolean,
  ): Promise<ShareResult<void>> {
    try {
      await this.provider.setCommentResolved(shareId, commentId, resolved);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: toShareError(err) };
    }
  }

  async deleteComment(shareId: string, commentId: string): Promise<ShareResult<void>> {
    try {
      await this.provider.deleteComment(shareId, commentId);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: toShareError(err) };
    }
  }

  /** Anonymous public resolve — never throws for invalid/expired/revoked. */
  async resolvePublic(rawToken: string): Promise<PublicShareResult> {
    try {
      return await this.provider.resolvePublic(rawToken);
    } catch {
      // Unknown provider failure on the public route → safe generic state.
      return { ok: false, state: "invalid" };
    }
  }

  async deleteProjectShareData(
    projectId: string,
  ): Promise<ShareResult<{ revokedShares: number; deletedComments: number }>> {
    try {
      return {
        ok: true,
        value: await this.provider.deleteProjectShareData(projectId),
      };
    } catch (err) {
      return { ok: false, error: toShareError(err) };
    }
  }
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

let providerSingleton: ShareLinkProvider | null = null;

/**
 * Get the share provider for the current cloud environment, or null when no
 * cloud backend is configured (pure local mode — sharing unavailable).
 */
export function getShareProvider(): ShareLinkProvider | null {
  if (providerSingleton) return providerSingleton;
  const env = getCloudEnvironment();
  if (env.kind === "supabase") {
    providerSingleton = new SupabaseShareProvider();
  } else if (env.kind === "mock") {
    providerSingleton = new MockHttpShareProvider();
  }
  return providerSingleton;
}

/** Test hook. */
export function setShareProviderForTests(provider: ShareLinkProvider | null): void {
  providerSingleton = provider;
}

/** True when a share backend is available at all (not "none"). */
export function shareBackendAvailable(): boolean {
  return getShareProvider() !== null;
}
