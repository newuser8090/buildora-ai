// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — device identity
//
// A stable, NON-identifying device id used only for sync diagnostics and
// conflict metadata. Requirements:
//   - generated once per browser profile
//   - random, non-personal
//   - not derived from fingerprinting (no hardware/browser fingerprints)
//   - resettable by clearing app data (it lives in the app's IndexedDB)
// ---------------------------------------------------------------------------

import { METADATA_KEY_DEVICE_ID } from "@/features/persistence/constants";
import { readMetadata, writeMetadata } from "./metadata-store";

let cached: string | null = null;

/** Generate a fresh random device id (uuid v4, non-personal). */
export function generateDeviceId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the fallback below.
  }
  const random = Math.random().toString(36).slice(2);
  return `dev-${Date.now().toString(36)}-${random}`;
}

/**
 * Get (and lazily persist) the device id. Deterministic within a browser
 * profile until app data is cleared. Never throws — a transient failure
 * falls back to a session-scoped id so sync is never blocked.
 */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  try {
    const stored = await readMetadata(METADATA_KEY_DEVICE_ID);
    if (typeof stored === "string" && stored.length > 0) {
      cached = stored;
      return cached;
    }
  } catch {
    // Fall through — generate a fresh id without persisting.
  }
  const fresh = generateDeviceId();
  cached = fresh;
  try {
    await writeMetadata(METADATA_KEY_DEVICE_ID, fresh);
  } catch {
    // Non-fatal: the session id still works for this load.
  }
  return fresh;
}

/** Test hook: reset the in-memory cache. */
export function resetDeviceIdCacheForTests(): void {
  cached = null;
}
