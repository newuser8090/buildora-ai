// ---------------------------------------------------------------------------
// Universal Block Import (Phase P3) — source hash
//
// Deterministic FNV-1a hash of the pasted source. Only the hash is stored in
// sourceMetadata — never the source itself.
// ---------------------------------------------------------------------------

/** Deterministic 32-bit FNV-1a hash, hex-encoded (always 8 chars). */
export function hashSource(source: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Force unsigned 32-bit.
  return (hash >>> 0).toString(16).padStart(8, "0");
}
