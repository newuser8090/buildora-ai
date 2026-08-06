"use client";

// ---------------------------------------------------------------------------
// MyBlockThumb — visual thumbnail for a saved block card
//
// - IntersectionObserver gating: thumbnails load only when a card is near the
//   viewport (large libraries stay fast — no 500 simultaneous blob reads)
// - fixed-aspect container → no layout shift when the image arrives
// - skeleton while loading; structural fallback preview on error/missing
//   ("Preview unavailable — the block is still safe to use.")
// - real <img> with descriptive alt text (never raw file content)
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { ImageOff } from "lucide-react";
import type { MyBlockRecord } from "../types";
import { useMyBlockThumbnail } from "../thumbnails/useMyBlockThumbnail";
import { MyBlockPreview } from "./MyBlockPreview";

export interface MyBlockThumbProps {
  block: MyBlockRecord;
  /** Visual height in px (fixed → no layout shift). */
  height?: number;
}

export function MyBlockThumb({ block, height = 88 }: MyBlockThumbProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  // Lazy gate: only start loading when the card is on/near screen.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
          }
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { status, objectUrl } = useMyBlockThumbnail(block, inView);

  const renderInner = () => {
    if (status === "ready" && objectUrl) {
      return (
        <img
          src={objectUrl}
          alt={`Preview of ${block.name}`}
          loading="lazy"
          draggable={false}
          className="h-full w-full object-cover object-top"
          data-testid={`my-block-thumb-img-${block.id}`}
        />
      );
    }
    if (status === "error") {
      return (
        <div
          className="flex h-full w-full flex-col items-center justify-center gap-1 bg-secondary"
          data-testid={`my-block-thumb-fallback-${block.id}`}
          role="img"
          aria-label={`Preview unavailable for ${block.name}`}
        >
          <ImageOff className="h-4 w-4 text-text-dim/50" aria-hidden="true" />
          <span className="px-2 text-center text-[9px] leading-tight text-text-dim/70">
            Preview unavailable — still safe to use
          </span>
        </div>
      );
    }
    if (status === "loading") {
      return (
        <div
          className="h-full w-full animate-pulse bg-secondary"
          data-testid={`my-block-thumb-skeleton-${block.id}`}
          aria-hidden="true"
        />
      );
    }
    // idle (off-screen) → cheap structural preview, no Blob work.
    return <MyBlockPreview tree={block.tree} height={height} maxNodes={24} />;
  };

  return (
    <div
      ref={containerRef}
      data-testid={`my-block-thumb-${block.id}`}
      className="relative w-full overflow-hidden rounded-lg border border-border/60 bg-white"
      style={{ height }}
    >
      {renderInner()}
    </div>
  );
}
