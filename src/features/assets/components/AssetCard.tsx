"use client";

import { type MouseEvent, useCallback } from "react";
import { Trash2, Pencil, Replace, Check } from "lucide-react";
import { AssetThumbnail } from "./AssetThumbnail";
import type { Asset } from "@/features/assets/types";

export interface AssetCardProps {
  asset: Asset;
  isSelected?: boolean;
  usageCount: number;
  onSelect?: (assetId: string) => void;
  onRename?: (assetId: string) => void;
  onReplace?: (assetId: string) => void;
  onDelete?: (assetId: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDimensions(w?: number, h?: number): string | null {
  if (w && h) return `${w}×${h}`;
  if (w) return `${w}px`;
  if (h) return `${h}px`;
  return null;
}

export function AssetCard({
  asset,
  isSelected,
  usageCount,
  onSelect,
  onRename,
  onReplace,
  onDelete,
}: AssetCardProps) {
  const handleSelect = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onSelect?.(asset.id);
    },
    [asset.id, onSelect],
  );

  const handleRename = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onRename?.(asset.id);
    },
    [asset.id, onRename],
  );

  const handleReplace = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onReplace?.(asset.id);
    },
    [asset.id, onReplace],
  );

  const handleDelete = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onDelete?.(asset.id);
    },
    [asset.id, onDelete],
  );

  const dims = formatDimensions(asset.width, asset.height);
  const displayName = asset.name.length > 28
    ? asset.name.slice(0, 25) + "..."
    : asset.name;

  return (
    <div
      data-testid="asset-card"
      className={`group relative flex flex-col overflow-hidden rounded-xl border transition-all duration-200 ${
        isSelected
          ? "border-accent ring-1 ring-accent/40"
          : "border-border/50 hover:border-border hover:shadow-sm"
      }`}
    >
      {/* Thumbnail */}
      <div className="relative aspect-[4/3] overflow-hidden bg-card/30">
        <AssetThumbnail
          src={asset.source.value}
          alt={asset.altText || asset.name}
          className="h-full w-full"
        />

        {/* Actions overlay — always visible for keyboard users via focus-within */}
        <div className="absolute inset-0 flex items-start justify-end gap-1 p-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={handleRename}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-base/80 text-text-dim backdrop-blur-sm transition-colors hover:bg-card hover:text-text-primary"
            title="Rename"
            aria-label={`Rename ${asset.name}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleReplace}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-base/80 text-text-dim backdrop-blur-sm transition-colors hover:bg-card hover:text-text-primary"
            title="Replace"
            aria-label={`Replace ${asset.name}`}
          >
            <Replace className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-base/80 text-text-dim backdrop-blur-sm transition-colors hover:bg-red-500/20 hover:text-red-400"
            title="Delete"
            aria-label={`Delete ${asset.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Select indicator */}
        {isSelected && (
          <div className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white shadow-sm">
            <Check className="h-3.5 w-3.5" />
          </div>
        )}
      </div>

      {/* Info */}
      <button
        type="button"
        onClick={handleSelect}
        className="flex flex-col gap-1 px-3 py-2.5 text-left transition-colors hover:bg-card/30"
      >
        <p className="text-xs font-medium text-text-primary" title={asset.name}>
          {displayName}
        </p>
        <div className="flex items-center gap-2 text-[11px] text-text-dim/70">
          <span>{asset.mimeType.replace("image/", "")}</span>
          <span>&bull;</span>
          <span>{formatSize(asset.size)}</span>
          {dims && (
            <>
              <span>&bull;</span>
              <span>{dims}</span>
            </>
          )}
        </div>
        {usageCount > 0 && (
          <p className="text-[11px] text-accent/80">
            Used in {usageCount} {usageCount === 1 ? "place" : "places"}
          </p>
        )}
      </button>
    </div>
  );
}
