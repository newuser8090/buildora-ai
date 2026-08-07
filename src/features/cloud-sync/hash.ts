// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — stable hashing
//
// Deterministic, cross-device content hashes used for:
//   - initial-merge duplicate detection (never dedupe by name alone)
//   - queue payload staleness checks
//   - sync markers / last-synced baselines
//
// Keys are canonicalized (sorted recursively) so the same logical content
// always hashes identically regardless of property insertion order.
// ---------------------------------------------------------------------------

/** Recursively sort object keys for deterministic JSON serialization. */
export function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return out;
}

/**
 * Stable string hash (FNV-1a, 64-bit folded to 32) over a canonical JSON
 * string. Deterministic across devices and sessions — no crypto required.
 * Good enough for duplicate detection; not used for security.
 */
export function stableHash(input: unknown): string {
  const json = JSON.stringify(canonicalize(input));
  if (json === undefined) return "hash:";
  // FNV-1a 64-bit (two 32-bit lanes) for a wide, stable fingerprint.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < json.length; i += 1) {
    const code = json.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const h1Hex = (h1 >>> 0).toString(16).padStart(8, "0");
  const h2Hex = (h2 >>> 0).toString(16).padStart(8, "0");
  return `h:${h1Hex}${h2Hex}:${json.length}`;
}

/** Stable hash of a canonicalized JSON payload (used for record baselines). */
export function hashPayload(payload: unknown): string {
  return stableHash(payload);
}
