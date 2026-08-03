// ---------------------------------------------------------------------------
// Storage Estimate Service
//
// Wraps navigator.storage?.estimate() and returns structured results.
// Framework-independent — no React or Zustand imports.
// ---------------------------------------------------------------------------

import type { StorageEstimateInfo } from "../types";

/**
 * Get an approximate storage usage estimate from the browser.
 *
 * Returns available: false when the StorageManager API is unavailable.
 * Estimates are always approximate — never claim exact free space.
 */
export async function getStorageEstimate(): Promise<StorageEstimateInfo> {
  if (
    typeof navigator === "undefined" ||
    !navigator.storage ||
    typeof navigator.storage.estimate !== "function"
  ) {
    return { available: false };
  }

  try {
    const estimate = await navigator.storage.estimate();

    const usage =
      estimate.usage !== undefined && Number.isFinite(estimate.usage)
        ? estimate.usage
        : undefined;
    const quota =
      estimate.quota !== undefined && Number.isFinite(estimate.quota)
        ? estimate.quota
        : undefined;
    const estimatedRemaining =
      usage !== undefined && quota !== undefined ? quota - usage : undefined;

    return {
      available: true,
      usage,
      quota,
      estimatedRemaining,
    };
  } catch {
    return { available: false };
  }
}
