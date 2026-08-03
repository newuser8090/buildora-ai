// ---------------------------------------------------------------------------
// useThumbnailObjectUrl
//
// Manages the runtime object URL lifecycle for a thumbnail Blob:
//   - creates a URL only when a Blob is present
//   - reuses the URL for the same Blob reference (no unnecessary recreation)
//   - revokes the previous URL when the Blob changes
//   - revokes on unmount
//   - handles createObjectURL failure without crashing
//
// Object URLs are NEVER persisted — they exist only in UI/runtime.
//
// Implementation note: revocation happens directly from a ref, never inside a
// setState updater. React does not run state updaters on unmounted components,
// so a revoke tucked into setUrl((prev) => …) would silently leak on unmount.
// ---------------------------------------------------------------------------

"use client";

import { useEffect, useRef, useState } from "react";

export function useThumbnailObjectUrl(
  blob: Blob | null | undefined,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const previousBlobRef = useRef<Blob | null | undefined>(null);
  /** Current object URL, tracked for reliable revocation on change/unmount. */
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    // No blob → no URL. Revoke any existing URL and clear.
    if (!blob) {
      if (previousBlobRef.current) {
        previousBlobRef.current = null;
        revokeUrl(urlRef.current);
        urlRef.current = null;
        setUrl(null);
      }
      return;
    }

    // Same Blob reference → keep the existing URL, but ONLY if a live URL
    // still exists. Under React Strict Mode's mount → cleanup → remount cycle
    // the unmount cleanup revokes the URL and nulls urlRef, so the effect
    // must recreate it on the second invocation instead of skipping.
    if (previousBlobRef.current === blob && urlRef.current !== null) {
      return;
    }

    previousBlobRef.current = blob;

    let created: string | null = null;
    try {
      created = URL.createObjectURL(blob);
    } catch {
      created = null;
    }

    // Revoke the previous URL (if any), then publish the new one.
    const previous = urlRef.current;
    urlRef.current = created;
    revokeUrl(previous);
    setUrl(created);
  }, [blob]);

  // Revoke on unmount.
  useEffect(() => {
    return () => {
      revokeUrl(urlRef.current);
      urlRef.current = null;
    };
  }, []);

  return url;
}

function revokeUrl(url: string | null | undefined): void {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // revoke failure must not crash the UI
  }
}
