// ---------------------------------------------------------------------------
// Publishing idempotency + deploy rate limit (Phase P8) — Phase P21 (F4) bound
//
// REGRESSION (P21 F4): `deployAttempts` grew without bound — every DISTINCT
// projectId added a key forever on a warm instance. The generate-rate-limit
// map was already bounded (10k-key sweep); the deploy limiter is now bounded
// the same way: expired buckets are swept first, then the oldest keys are
// evicted as a cap.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  lookupIdempotency,
  storeIdempotency,
  deployRateLimited,
  RATE_WINDOW_MS,
  _resetIdempotencyForTests,
  type IdempotencyEntry,
} from "../publish-idempotency";

function entry(providerDeploymentId = "dep-1"): IdempotencyEntry {
  return {
    providerDeploymentId,
    url: "https://example.com",
    readyState: "READY",
    createdAt: Date.now(),
    ownerUserId: "user-1",
  };
}

beforeEach(() => {
  _resetIdempotencyForTests();
});

describe("idempotency registry (pre-existing behavior, locked in)", () => {
  it("stores and reuses a live entry for the same key", () => {
    storeIdempotency("p1:hash1", entry());
    expect(lookupIdempotency("p1:hash1")?.providerDeploymentId).toBe("dep-1");
  });

  it("expired entries are dropped (fresh attempt allowed)", () => {
    storeIdempotency("p1:hash1", { ...entry(), createdAt: Date.now() - 200_000 });
    expect(lookupIdempotency("p1:hash1")).toBeNull();
  });

  it("a failed/cancelled publish never stored an entry → a fresh attempt is allowed", () => {
    expect(lookupIdempotency("p1:hash2")).toBeNull();
  });
});

describe("deploy rate limit (Phase P21 F4 — bounded memory)", () => {
  it("enforces the per-project ceiling", () => {
    // RATE_MAX = 10 per project per window.
    for (let i = 0; i < 10; i += 1) {
      expect(deployRateLimited("proj-a")).toBe(false);
    }
    expect(deployRateLimited("proj-a")).toBe(true);
    // A different project is unaffected.
    expect(deployRateLimited("proj-b")).toBe(false);
  });

  it("the window rolls over (expired attempts stop counting)", () => {
    const start = 1_000_000;
    for (let i = 0; i < 10; i += 1) {
      deployRateLimited("proj-a", start + i * 1000);
    }
    expect(deployRateLimited("proj-a", start + 10_000)).toBe(true);
    // Advance past the 60 s window → the bucket is effectively empty.
    expect(deployRateLimited("proj-a", start + 70_000)).toBe(false);
  });

  it("keeps the tracked-project map bounded under many distinct projects (oldest evicted)", () => {
    let now = 1_000_000;
    // Saturate the oldest project's bucket.
    for (let i = 0; i < 10; i += 1) {
      expect(deployRateLimited("proj-0", (now += 1000))).toBe(false);
    }
    expect(deployRateLimited("proj-0", (now += 1000))).toBe(true);

    // Flood past the 10,000-key cap with distinct live projects.
    for (let i = 1; i <= 10_001; i += 1) {
      deployRateLimited(`proj-${i}`, (now += 1000));
    }

    // The sweep evicted the OLDEST key — proj-0's bucket is gone, so it gets
    // a FRESH bucket (not limited) instead of an ever-growing registry.
    expect(deployRateLimited("proj-0", (now += 1000))).toBe(false);

    // Recently-seen projects are still tracked and still enforced.
    // (proj-10001 already has ONE timestamp from the flood — 9 more keep it
    // under the ceiling, the 10th new call trips it.)
    for (let i = 0; i < 9; i += 1) {
      expect(deployRateLimited("proj-10001", (now += 1000))).toBe(false);
    }
    expect(deployRateLimited("proj-10001", (now += 1000))).toBe(true);
  });

  it("expired buckets are swept before the insertion-order bound (live keys survive)", () => {
    let now = 1_000_000;
    // 10,001 keys whose buckets are ALL expired.
    for (let i = 0; i < 10_001; i += 1) {
      deployRateLimited(`old-${i}`, (now += 1000));
    }
    // Everything is now past the window; one LIVE key pushes over the cap.
    const liveNow = now + RATE_WINDOW_MS;
    deployRateLimited("live-key", liveNow);

    // The expired sweep evicts the old buckets; the live key keeps working.
    // (live-key already has one timestamp — 8 more stay under the ceiling,
    // the 9th new call trips it.)
    expect(deployRateLimited("live-key", liveNow + 1000)).toBe(false);
    let ticking = liveNow;
    for (let i = 0; i < 8; i += 1) {
      deployRateLimited("live-key", (ticking += 1000));
    }
    expect(deployRateLimited("live-key", (ticking += 1000))).toBe(true);
  });
});
