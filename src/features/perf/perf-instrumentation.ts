// ---------------------------------------------------------------------------
// Performance Instrumentation (Phase P9)
//
// Lightweight, TRANSIENT client-side measurements. Records soft metrics into
// an in-memory bounded ring. Nothing is persisted and nothing is sent to any
// server unless explicitly enabled (it never is in P9). No tracking
// analytics.
//
// Soft budgets (documented in docs/product-quality-checklist.md):
//   - dashboard first interaction      — no wall-clock assertion
//   - editor hydration                 — recorded, not asserted in tests
//   - template gallery render          — recorded, not asserted in tests
//   - preview open                     — recorded, not asserted in tests
//   - publish dialog open              — recorded, not asserted in tests
//   - large project tree render        — operation counts, not timings
// ---------------------------------------------------------------------------

export interface PerfMeasurement {
  /** Stable label, e.g. "editor-hydration". */
  label: string;
  /** Wall-clock timestamp of when the measurement was recorded. */
  timestamp: number;
  /** Duration in milliseconds (may be 0 for pure markers). */
  durationMs: number;
  /** Optional deterministic count (e.g. block count) — safe to assert. */
  count?: number;
  /** Optional structured detail (never contains user content). */
  detail?: string;
}

const MAX_MEASUREMENTS = 200;

/** In-memory ring buffer — transient, never persisted. */
const measurements: PerfMeasurement[] = [];

/**
 * Record a completed measurement. Bounded: older entries are evicted when the
 * ring is full. Safe to call from any module — never throws.
 */
export function recordPerf(
  label: string,
  durationMs: number,
  options?: { count?: number; detail?: string },
): void {
  measurements.push({
    label,
    timestamp: Date.now(),
    durationMs,
    count: options?.count,
    detail: options?.detail,
  });
  if (measurements.length > MAX_MEASUREMENTS) {
    measurements.splice(0, measurements.length - MAX_MEASUREMENTS);
  }
}

/**
 * Run fn and record its duration. Returns fn's result unchanged. Safe for
 * hot paths — the timing overhead is negligible and never throws.
 */
export function measurePerf<T>(
  label: string,
  fn: () => T,
  options?: { count?: number },
): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    recordPerf(label, performance.now() - start, options);
  }
}

/** Record a zero-duration marker (e.g. "preview-open"). */
export function markPerf(label: string, options?: { count?: number }): void {
  recordPerf(label, 0, options);
}

/** Read-only snapshot of recorded measurements (newest last). */
export function getPerfMeasurements(): readonly PerfMeasurement[] {
  return measurements.slice();
}

/** Clear all measurements. Used by tests and the optional debug surface. */
export function resetPerf(): void {
  measurements.length = 0;
}

/** Deterministic count of recordings for a label (safe to assert in tests). */
export function countPerf(label: string): number {
  return measurements.filter((m) => m.label === label).length;
}
