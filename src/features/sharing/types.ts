// ---------------------------------------------------------------------------
// Share Links & Review Experience (Phase P12) — core model
//
// Provider-independent types shared by the mock backend, the Supabase
// provider, the service layer, and the UI. No React, no DOM, no Zustand.
//
// Sharing is SERVICE METADATA: share links and review comments live on the
// server (Supabase / mock), never inside ProjectSchema, never in .buildora
// exports, never in IndexedDB project records. Only a SANITIZED PROJECTION of
// the website content is ever stored server-side for viewers.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

export type ShareLinkStatus = "active" | "revoked";

export interface ShareLinkSettings {
  /** Whether viewers may submit review comments. */
  feedbackEnabled: boolean;
  /** When feedback is enabled: whether a display name is required. */
  requireName: boolean;
  /** ISO timestamp or null = never expires. */
  expiresAt: string | null;
}

export interface ShareLink extends ShareLinkSettings {
  /** Public share id (uuid) — used by owner management endpoints. NOT secret. */
  id: string;
  projectId: string;
  status: ShareLinkStatus;
  createdAt: string;
  updatedAt: string;
  /**
   * Last time a viewer successfully resolved the link (server-recorded).
   * Privacy-conscious: a timestamp only — never an IP, user-agent, or
   * fingerprint. May be null when never opened. Explicitly optional.
   */
  lastOpenedAt: string | null;
  /** Denormalized number of comments for this link. */
  feedbackCount: number;
}

/** Owner-facing view of a share (management list / dashboard). */
export interface ShareLinkSummary {
  id: string;
  projectId: string;
  status: ShareLinkStatus;
  feedbackEnabled: boolean;
  requireName: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  feedbackCount: number;
}

/** The raw token plus the public URL — returned ONLY at create/regenerate. */
export interface ShareLinkWithToken {
  link: ShareLinkSummary;
  /** The raw 256-bit token. Never persisted server-side; shown once. */
  rawToken: string;
  /** Absolute review URL, e.g. https://host/share/<rawToken>. */
  url: string;
}

/** Expiry presets offered in the beginner dialog (owner-facing). */
export type ShareExpiryPreset = "never" | "24h" | "7d" | "30d";

// ---------------------------------------------------------------------------
// Public (anonymous) view
// ---------------------------------------------------------------------------

export type ShareResolveState =
  | { ok: true; state: "active"; share: PublicShareInfo; projection: ShareProjection }
  | { ok: false; state: "invalid" | "expired" | "revoked" };

/** Public share info — never includes token hash, owner id, or internals. */
export interface PublicShareInfo {
  /** The share's public id (non-secret; used by the viewer to submit). */
  shareId: string;
  projectId: string;
  projectName: string;
  feedbackEnabled: boolean;
  requireName: boolean;
}

/**
 * Sanitized server-stored projection of the project (Project-shaped so the
 * existing VisitorPageView renders it unchanged). Excludes auth state, cloud
 * records, deployment data, recovery, Copilot memory, My Blocks, templates,
 * tokens, and the canonical project id (blanked).
 */
export type ShareProjection = Omit<Project, "id" | "createdAt" | "updatedAt"> & {
  /** Always blank in a projection — the canonical id is never public. */
  id: string;
};

// ---------------------------------------------------------------------------
// Review comments
// ---------------------------------------------------------------------------

export interface ReviewComment {
  id: string;
  shareId: string;
  projectId: string;
  pageId?: string;
  sectionId?: string;
  authorName?: string;
  body: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ReviewCommentInput {
  pageId?: string;
  sectionId?: string;
  authorName?: string;
  body: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ShareErrorCode =
  | "AUTH_REQUIRED"
  | "SESSION_EXPIRED"
  | "PERMISSION_DENIED"
  | "OFFLINE"
  | "NETWORK_FAILED"
  | "RATE_LIMITED"
  | "INVALID_TOKEN"
  | "EXPIRED"
  | "REVOKED"
  | "FEEDBACK_DISABLED"
  | "NOT_FOUND"
  | "PROJECT_NOT_FOUND"
  | "INVALID_INPUT"
  | "PROJECTION_TOO_LARGE"
  | "NOT_CONFIGURED"
  | "MALFORMED_RESPONSE"
  | "UNKNOWN";

export interface ShareError {
  code: ShareErrorCode;
  /** User-safe message — never SQL, tokens, table names, or stack traces. */
  message: string;
  /** Internal diagnostic detail (never shown to beginners). */
  cause?: string;
  /** True when retrying later is likely to succeed. */
  retryable: boolean;
}

/** Envelope for provider/service results. */
export type ShareResult<T> = { ok: true; value: T } | { ok: false; error: ShareError };

/** Public resolve result mapped from the server envelope. */
export type PublicShareResult =
  | { ok: true; state: "active"; share: PublicShareInfo; projection: ShareProjection }
  | { ok: false; state: "invalid" | "expired" | "revoked" };

// ---------------------------------------------------------------------------
// Wire envelopes (mock API + provider parity)
// ---------------------------------------------------------------------------

export interface ShareApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}
