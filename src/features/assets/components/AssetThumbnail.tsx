"use client";

import { useState, useCallback } from "react";
import { ImageIcon } from "lucide-react";

export interface AssetThumbnailProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
}

export function AssetThumbnail({ src, alt, width, height, className = "" }: AssetThumbnailProps) {
  const [hasError, setHasError] = useState(false);

  const handleError = useCallback(() => setHasError(true), []);

  if (hasError || !src) {
    return (
      <div
        className={`flex items-center justify-center bg-card/50 ${className}`}
        aria-label={alt || "Image preview unavailable"}
      >
        <ImageIcon className="h-6 w-6 text-text-dim/40" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      onError={handleError}
      className={`object-cover ${className}`}
      loading="lazy"
    />
  );
}
