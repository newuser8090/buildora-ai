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
/** Window in ms — exported so the bounded-memory tests can roll time. */
export const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10; // deploys per project per minute
/** Cap on tracked project keys — bounds memory on a long-lived instance. */
const MAX_TRACKED_PROJECTS = 10_000;

/**
 * Phase P21 (F4) — bounded memory. The tracked-project map must never grow
 * without bound on a warm long-lived instance (each DISTINCT projectId adds a
 * key forever). Mirrors the generate-rate-limit sweep: evict keys whose
 * entries are all outside the window, then drop the oldest keys as a bound.
 */
function boundDeployAttempts(now: number): void {
  if (deployAttempts.size <= MAX_TRACKED_PROJECTS) return;
  for (const [key, timestamps] of [...deployAttempts]) {
    if (timestamps.every((t) => now - t >= RATE_WINDOW_MS)) {
      deployAttempts.delete(key);
    }
  }
  // Map preserves insertion order — the first iterator key is the oldest.
  while (deployAttempts.size > MAX_TRACKED_PROJECTS) {
    const oldestKey = deployAttempts.keys().next().value;
    if (oldestKey === undefined) break;
    deployAttempts.delete(oldestKey);
  }
}

/** True when the project has exceeded the deploy rate limit. */
export function deployRateLimited(projectId: string, now = Date.now()): boolean {
  const timestamps = (deployAttempts.get(projectId) ?? []).filter(
    (t) => now - t < RATE_WINDOW_MS,
  );
  if (timestamps.length >= RATE_MAX) {
    deployAttempts.set(projectId, timestamps);
    boundDeployAttempts(now);
    return true;
  }
  timestamps.push(now);
  deployAttempts.set(projectId, timestamps);
  boundDeployAttempts(now);
  return false;
}

/** Test hook. */
export function _resetIdempotencyForTests(): void {
  entries.clear();
  deployAttempts.clear();
}
