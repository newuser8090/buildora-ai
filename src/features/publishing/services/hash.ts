// ---------------------------------------------------------------------------
// Publishing — deterministic hashing (Phase P7)
//
// - contentHashOfProject: cheap, canonical hash of project content for
//   "unpublished changes" detection. Never regenerates the export.
// - hashExportFiles: deterministic hash of generated export files, recorded
//   on each deployment.
//
// FNV-1a 64-bit (two 32-bit accumulators) — deterministic, synchronous,
// collision-resistant enough for change detection. Runs in node + browser.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import type { OutputFile } from "@/features/export/pipeline/types";

// ---------------------------------------------------------------------------
// FNV-1a
// ---------------------------------------------------------------------------

const FNV_OFFSET_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

/** FNV-1a 64-bit-ish (two lanes) → 16 hex chars. */
function fnv1a64(input: string): string {
  let h1 = FNV_OFFSET_32;
  let h2 = 0x84222325;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, FNV_PRIME_32);
    h2 ^= c;
    h2 = Math.imul(h2, 0x01000193 + 0x1000003b1); // second prime
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Content hash — canonical serialization of project content
// ---------------------------------------------------------------------------

/**
 * Hash the project content deterministically. Key order is normalized by
 * JSON.stringify on the clone's insertion order; to be robust we re-key the
 * top-level object alphabetically so editor-internal field ordering never
 * changes the hash.
 */
export function contentHashOfProject(project: Project): string {
  const clone = JSON.parse(JSON.stringify(project)) as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(clone).sort()) {
    ordered[key] = clone[key];
  }
  return fnv1a64(JSON.stringify(ordered));
}

// ---------------------------------------------------------------------------
// Export files hash — deterministic over sorted file list
// ---------------------------------------------------------------------------

export function hashExportFiles(files: OutputFile[]): string {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  let payload = "";
  for (const file of sorted) {
    payload += `${file.path}\u0000${file.encoding ?? "utf-8"}\u0000${file.content}\u0001`;
  }
  return fnv1a64(payload);
}
