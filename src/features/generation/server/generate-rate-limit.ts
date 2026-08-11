// ---------------------------------------------------------------------------
// Generate route rate limiting (Phase P20 — release hardening)
//
// /api/generate is the ONE production API surface with no throttling: it is
// not mock-gated (it runs in production builds), it invokes a PAID external
// AI provider (Gemini) with a server-side key, and it is unauthenticated by
// design (generation works without an account — local-first product rule).
// Every other API surface in the app has a ceiling (mock auth 10/min/email,
// publish deploy 10/min/project, collab 2400/min/room, share comments
// 20/min/share) — the generate route had none, leaving an open cost-abuse /
// DoS surface on the paid provider.
//
// Design (mirrors the established `rateLimited` / `deployRateLimited`
// patterns):
//   - in-memory, per-client, fixed window
//   - enforced in PRODUCTION only (NODE_ENV === "production"). In dev/E2E
//     the route is a local/testing surface (x-buildora-force-local, mock
//     cloud) and the ceiling would only add flake risk to the matrix suite —
//     the same "mock in dev, real in prod" posture the rest of the app uses.
//   - ceiling is generous (60/min) — never trips a human generating/editing
//     sites, tight enough to bound a flood
//   - single-instance best-effort (per warm serverless instance), exactly
//     like `deployRateLimited`; documented as such (real multi-instance
//     enforcement needs an external limiter — P3 future enhancement)
// ---------------------------------------------------------------------------

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60; // requests per client per minute
/** Cap on tracked client keys — bounds memory on a long-lived instance. */
const MAX_TRACKED_CLIENTS = 10_000;

const attempts = new Map<string, number[]>();

/**
 * Opportunistic sweep: when the map grows past the cap, evict keys whose
 * entries are all outside the window (and, if still over the cap, drop the
 * oldest keys). Mirrors the bounded-memory pattern of `storeIdempotency` in
 * publish-idempotency.ts — an unbounded Map would itself be a memory-DoS
 * vector for a client that can vary the forwarded header.
 */
function boundAttempts(now: number): void {
  if (attempts.size <= MAX_TRACKED_CLIENTS) return;
  for (const [key, timestamps] of [...attempts]) {
    if (timestamps.every((t) => now - t >= RATE_WINDOW_MS)) {
      attempts.delete(key);
    }
  }
  // Map preserves insertion order, so the first iterator key is the oldest.
  // (keys().next().value is O(1); spreading the whole map per iteration would
  // allocate a full array each time.)
  //
  // Fairness note: under a sustained key-rotation flood the insertion-oldest
  // keys are evicted first — which can churn legitimate clients' buckets (a
  // legit client then just gets a fresh bucket; no data is lost). Acceptable
  // for a documented best-effort limiter; the expired-key sweep above already
  // handles the common case.
  while (attempts.size > MAX_TRACKED_CLIENTS) {
    const oldestKey = attempts.keys().next().value;
    if (oldestKey === undefined) break;
    attempts.delete(oldestKey);
  }
}

/** True when the client has exceeded the ceiling (injects `now` for tests). */
export function generateRateLimited(clientKey: string, now = Date.now()): boolean {
  const timestamps = (attempts.get(clientKey) ?? []).filter(
    (t) => now - t < RATE_WINDOW_MS,
  );
  if (timestamps.length >= RATE_MAX) {
    attempts.set(clientKey, timestamps);
    boundAttempts(now);
    return true;
  }
  timestamps.push(now);
  attempts.set(clientKey, timestamps);
  boundAttempts(now);
  return false;
}

/**
 * Derive a bounded client key for the current request. Uses the first
 * X-Forwarded-For entry when present (standard behind proxies/CDNs), else a
 * shared bucket. Bounded to the entry's first 64 chars — never the raw
 * header (which could be arbitrarily long and is client-controlled).
 *
 * NOTE: the first XFF entry is only trustworthy when a trusted proxy/CDN
 * (e.g. Vercel) overwrites X-Forwarded-For with the real client address. On
 * a deployment that does NOT overwrite it, a client controls its own key —
 * the limit is then trivially bypassable by rotating the header (and the
 * map sweep above bounds the resulting memory growth). Documented, not
 * silently assumed.
 */
export function clientKeyForRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim() ?? "";
  return first ? first.slice(0, 64) : "unknown-client";
}

/** True when production enforcement is active. */
export function generateRateLimitEnabled(): boolean {
  return (
    typeof process !== "undefined" && process.env?.NODE_ENV === "production"
  );
}

/**
 * Dev/test-only escape hatch gate (Phase P20 F3). The x-buildora-force-local
 * header is honored in development/test only — a live deployment must never
 * let an arbitrary external request bypass the configured AI provider. In
 * production the ONLY switch is the server-side BUILDORA_FORCE_LOCAL_GENERATION
 * env var, which an external caller cannot set. Exported so the production
 * ignore-path is unit-testable (the route helper is module-private).
 */
export function isTestForceLocalHeader(request: Request): boolean {
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "production") {
    return false;
  }
  return request.headers.get("x-buildora-force-local") === "true";
}

/** Test hook — clear the attempt bucket. */
export function _resetGenerateRateLimitForTests(): void {
  attempts.clear();
}
