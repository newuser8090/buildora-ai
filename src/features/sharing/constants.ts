// ---------------------------------------------------------------------------
// Share Links & Review Experience (Phase P12) — constants
//
// Bounds are enforced at the server (mock + Supabase RPCs) AND validated
// again by the service layer. The client never trusts itself.
// ---------------------------------------------------------------------------

import type { ShareExpiryPreset } from "./types";

/** Review comment body cap (chars). Server-enforced. */
export const COMMENT_BODY_MAX = 2000;

/** Review comment author-name cap (chars). Server-enforced. */
export const COMMENT_NAME_MAX = 60;

/** Project name shown to viewers is capped (project names are user input). */
export const SHARE_PROJECT_NAME_MAX = 120;

/** Per-share comment rate limit: max submissions in the window. */
export const COMMENT_RATE_LIMIT_MAX = 20;

/** Per-share comment rate-limit window (ms). */
export const COMMENT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Duplicate-spam guard: consecutive submissions with the same body + name
 * within this window are rejected (mock backend; documented limitation for
 * Supabase where edge protection is the enforcement point).
 */
export const COMMENT_DUPLICATE_WINDOW_MS = 60 * 1000;

/** Max serialized projection size (bytes) accepted server-side. */
export const PROJECTION_MAX_BYTES = 4 * 1024 * 1024;

/** Share URL path prefix (public route). */
export const SHARE_ROUTE_PREFIX = "/share/";

/** Expiry presets offered in the dialog (values in ms, null = never). */
export const EXPIRY_PRESETS: ReadonlyArray<{
  id: ShareExpiryPreset;
  label: string;
  expiresInMs: number | null;
}> = [
  { id: "never", label: "Never", expiresInMs: null },
  { id: "24h", label: "24 hours", expiresInMs: 24 * 60 * 60 * 1000 },
  { id: "7d", label: "7 days", expiresInMs: 7 * 24 * 60 * 60 * 1000 },
  { id: "30d", label: "30 days", expiresInMs: 30 * 24 * 60 * 60 * 1000 },
];

/** Perf marks (existing transient ring; deterministic counts only). */
export const SHARE_PERF_MARKS = {
  dialogOpen: "share_dialog_open",
  created: "share_created",
  loaded: "share_loaded",
  feedbackSubmitted: "feedback_submitted",
} as const;

/** Mock-only localStorage key that remembers active share ids per project
 *  (used by the snapshot-sync hook and dashboard badge caching). */
export const SHARE_LOCAL_CACHE_KEY = "buildora.share_cache.v1";

/** Debounce for projection refresh pushes from the editor (ms). */
export const SHARE_SNAPSHOT_DEBOUNCE_MS = 1500;
