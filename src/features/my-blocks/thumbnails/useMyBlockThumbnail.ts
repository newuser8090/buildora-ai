"use client";

// ---------------------------------------------------------------------------
// My Blocks Library (Phase P5) — useMyBlockThumbnail hook
//
// Loads the persistent thumbnail Blob for a saved block and manages the
// runtime object URL lifecycle. Regenerates automatically when the stored
// image is missing or stale (tree contentRevision changed).
//
// Guarantees:
//   - no state updates after unmount
//   - stale-request protection (a newer request wins; old results dropped)
//   - object URLs created only for real Blobs and revoked on change/unmount
//   - errors are isolated per card — one bad thumbnail never breaks the grid
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import type { MyBlockRecord } from "../types";
import { getMyBlockThumbnailService } from "./my-block-thumbnail-singleton";

export type MyBlockThumbnailHookStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error";

export interface MyBlockThumbnailHookState {
  status: MyBlockThumbnailHookStatus;
  /** Runtime-only object URL. Never persisted. */
  objectUrl: string | null;
}

/**
 * Load (and lazily regenerate) the persistent thumbnail for a record.
 * `enabled` lets the caller gate work on visibility (IntersectionObserver).
 */
export function useMyBlockThumbnail(
  record: MyBlockRecord | null,
  enabled: boolean,
): MyBlockThumbnailHookState {
  const [status, setStatus] = useState<MyBlockThumbnailHookStatus>("idle");
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  // Reliable revocation + stale-request protection.
  const urlRef = useRef<string | null>(null);
  const requestToken = useRef(0);

  // Deferred state transitions (the effect body must not call setState
  // synchronously — that would trigger cascading renders). Every transition
  // happens either in this render-phase adjustment (same pattern as the
  // library dialogs) or inside the async load below.
  const idle = !record || !enabled;
  const [prevIdle, setPrevIdle] = useState<boolean | null>(null);
  if (prevIdle !== idle) {
    setPrevIdle(idle);
    setStatus(idle ? "idle" : "loading");
  }

  // Revoke the runtime URL when the card goes idle (off-screen / no record).
  // This effect never calls setState, so it is lint-safe and cannot cascade.
  useEffect(() => {
    if (!idle) return;
    if (urlRef.current) {
      revoke(urlRef.current);
      urlRef.current = null;
    }
  }, [idle]);

  useEffect(() => {
    if (!record || !enabled) return;

    const token = ++requestToken.current;
    const blockId = record.id;
    const expectedRevision = record.contentRevision ?? 1;

    let cancelled = false;

    const service = getMyBlockThumbnailService();

    const apply = (blob: Blob) => {
      if (cancelled || requestToken.current !== token) return;
      const previous = urlRef.current;
      let created: string | null = null;
      try {
        created = URL.createObjectURL(blob);
      } catch {
        created = null;
      }
      urlRef.current = created;
      revoke(previous);
      setObjectUrl(created);
      setStatus("ready");
    };

    const fail = () => {
      if (cancelled || requestToken.current !== token) return;
      setStatus("error");
    };

    const load = async () => {
      setStatus("loading");
      const result = await service.getRecord(blockId);
      if (result.ok) {
        if (result.value.revision === expectedRevision) {
          apply(result.value.data);
          return;
        }
        // Stale — regenerate from the current tree.
      } else if (result.error.code !== "THUMBNAIL_NOT_FOUND") {
        fail();
        return;
      }
      // Missing or stale → generate (deduplicated by the service).
      const generated = await service.generateForRecord(record);
      if (generated.ok) {
        apply(generated.value.data);
      } else {
        fail();
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [record, enabled]);

  // Revoke the URL on unmount (final cleanup) — revocation must never leak.
  useEffect(() => {
    return () => {
      revoke(urlRef.current);
      urlRef.current = null;
    };
  }, []);

  return { status, objectUrl };
}

function revoke(url: string | null | undefined): void {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // revocation must never crash the UI
  }
}
