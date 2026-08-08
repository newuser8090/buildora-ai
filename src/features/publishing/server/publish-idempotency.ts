// ---------------------------------------------------------------------------
// Publishing — idempotency registry (Phase P8, server-side)
//
// Best-effort single-instance guard against accidental duplicate production
// publishes. Keyed by `${projectId}:${exportHash}`:
//   - a create that is in-flight or succeeded recently (≤ TTL) is reused
//     (double clicks / network retries never create identical deployments)
//   - failed/cancelled/expired entries allow a fresh attempt
// The client-side in-flight registry (per project+provider) is the first
// line of defense; this is the second. Documented as single-instance only.
// ---------------------------------------------------------------------------

const TTL_MS = 90_000;

export interface IdempotencyEntry {
  providerDeploymentId: string;
  url: string;
  previewUrl?: string;
  readyState: string;
  createdAt: number;
  ownerUserId: string;
}

const entries = new Map<string, IdempotencyEntry>();

/** Look up a reusable entry for the key (expired entries are dropped). */
export function lookupIdempotency(
  key: string,
  now = Date.now(),
): IdempotencyEntry | null {
  const entry = entries.get(key);
  if (!entry) return null;
  if (now - entry.createdAt > TTL_MS) {
    entries.delete(key);
    return null;
  }
  return entry;
}

/** Record a successful provider create for future dedupe. */
export function storeIdempotency(key: string, entry: IdempotencyEntry): void {
  entries.set(key, entry);
  // Opportunistic cleanup of expired entries (bounded memory).
  const now = Date.now();
  for (const [k, e] of entries) {
    if (now - e.createdAt > TTL_MS) entries.delete(k);
  }
}

// ---------------------------------------------------------------------------
// Deploy rate limiting (single-instance, best-effort)
// ---------------------------------------------------------------------------

const deployAttempts = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10; // deploys per project per minute

/** True when the project has exceeded the deploy rate limit. */
export function deployRateLimited(projectId: string, now = Date.now()): boolean {
  const timestamps = (deployAttempts.get(projectId) ?? []).filter(
    (t) => now - t < RATE_WINDOW_MS,
  );
  if (timestamps.length >= RATE_MAX) {
    deployAttempts.set(projectId, timestamps);
    return true;
  }
  timestamps.push(now);
  deployAttempts.set(projectId, timestamps);
  return false;
}

/** Test hook. */
export function _resetIdempotencyForTests(): void {
  entries.clear();
  deployAttempts.clear();
}
