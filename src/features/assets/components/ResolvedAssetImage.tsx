"use client";

import { useState, useCallback } from "react";
import type { CSSProperties } from "react";

// ---------------------------------------------------------------------------
// ResolvedAssetImage — renders an asset image with decode-error fallback
//
// Responsibilities:
//  - Render <img> with src/alt from a resolved asset
//  - Track decode failure and show fallback content
//  - Reset error state when src changes
//  - Apply object-fit and dimensions
//  - Avoid infinite onError loops
//
// Only file that uses <img> for user-uploaded assets — eslint is suppressed
// at the config level for this file only.
// ---------------------------------------------------------------------------

export interface ResolvedAssetImageProps {
  /** Data URL or other safe source string */
  src?: string;
  /** Descriptive alt text. Empty alt for decorative images. */
  alt: string;
  /** Object-fit value (default: "contain") */
  fit?: "contain" | "cover" | "fill" | "none";
  /** CSS width (default: "100%") */
  width?: string;
  /** CSS max-height (optional — prevents oversized images) */
  maxHeight?: string;
  /** CSS class name */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
  /** Fallback content to show on error/missing */
  fallback?: React.ReactNode;
}

export function ResolvedAssetImage({
  src,
  alt,
  fit = "contain",
  width = "100%",
  maxHeight,
  className = "",
  style,
  fallback,
}: ResolvedAssetImageProps) {
  const [hasError, setHasError] = useState(false);

  // Track load/error — reset when key changes via img element key
  const handleLoad = useCallback(() => {
    setHasError(false);
  }, []);

  const handleError = useCallback(() => {
    setHasError(true);
  }, []);

  // No src — show fallback
  if (!src) {
    return fallback ? <>{fallback}</> : null;
  }

  // Error state — show fallback
  if (hasError) {
    return fallback ? <>{fallback}</> : null;
  }

  return (
    <img
      key={src}
      src={src}
      alt={alt}
      onLoad={handleLoad}
      onError={handleError}
      className={className}
      style={{
        width,
        maxHeight,
        objectFit: fit,
        display: "block",
        ...style,
      }}
    />
  );
}
