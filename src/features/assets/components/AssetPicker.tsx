"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { X, Search } from "lucide-react";

// Reusable type for asset type filtering
export type AssetTypeFilter = "all" | "image" | "logo" | "background";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { DragDropZone } from "./DragDropZone";
import { AssetGrid } from "./AssetGrid";
import { validateFile } from "@/features/assets/services/file-validator";
import { processImageFile } from "@/features/assets/services/image-processor";

export interface AssetPickerProps {
  /** Currently selected asset ID, if any */
  currentAssetId?: string;
  /** Filter which asset types to show */
  allowedTypes?: AssetTypeFilter[];
  /** Optional title override */
  title?: string;
  /** Empty state text override */
  emptyText?: string;
  /** Called when an asset is selected */
  onSelect: (assetId: string) => void;
  /** Called when selection is cleared */
  onClear: () => void;
  /** Called to close the picker */
  onClose: () => void;
}

export function AssetPicker({
  currentAssetId,
  allowedTypes,
  title = "Select Image",
  emptyText,
  onSelect,
  onClear,
  onClose,
}: AssetPickerProps) {
  const project = useEditorStore((s) => s.project);
  const addAsset = useEditorStore((s) => s.addAsset);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<AssetTypeFilter>("all");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const handleFiles = useCallback(
    async (files: File[]) => {
      setUploadError(null);
      setIsUploading(true);
      try {
        for (const file of files) {
          const validation = validateFile(file);
          if (!validation.valid) {
            setUploadError(`${file.name}: ${validation.error}`);
            continue;
          }
          const processed = await processImageFile(file);
          addAsset(processed);
        }
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setIsUploading(false);
      }
    },
    [addAsset],
  );

  // Filter and search
  const filtered = project.assets.filter((asset) => {
    if (allowedTypes && allowedTypes.length > 0 && !allowedTypes.includes("all")) {
      if (!allowedTypes.includes(asset.type as AssetTypeFilter)) return false;
    }
    if (filterType !== "all" && asset.type !== filterType) return false;
    if (search) {
      return asset.name.toLowerCase().includes(search.toLowerCase());
    }
    return true;
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="asset-picker-title"
    >
      <div className="mx-4 flex h-[80vh] w-full max-w-3xl flex-col rounded-2xl border border-border bg-secondary shadow-elevated">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 id="asset-picker-title" className="text-sm font-semibold text-text-primary">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search + filter */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-dim/50" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search assets..."
              className="h-8 w-full rounded-lg border border-border bg-base pl-9 pr-3 text-sm text-text-primary placeholder:text-text-dim/50 transition-all duration-200 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/10"
              aria-label="Search assets"
            />
          </div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as AssetTypeFilter)}
            className="h-8 rounded-lg border border-border bg-base px-3 text-sm text-text-muted focus:border-accent/40 focus:outline-none"
            aria-label="Filter by type"
          >
            <option value="all">All</option>
            <option value="image">Images</option>
            <option value="logo">Logos</option>
            <option value="background">Backgrounds</option>
          </select>
        </div>

        {/* Upload */}
        <div className="border-b border-border px-5 py-3">
          <DragDropZone onFilesSelected={handleFiles} disabled={isUploading} />
          {uploadError && (
            <p className="mt-2 text-xs text-red-400">{uploadError}</p>
          )}
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <AssetGrid isEmpty={filtered.length === 0} emptyMessage={emptyText}>
            {filtered.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => onSelect(asset.id)}
                className={`w-full rounded-xl border text-left transition-all duration-200 ${
                  currentAssetId === asset.id
                    ? "border-accent ring-1 ring-accent/40"
                    : "border-border/50 hover:border-border hover:shadow-sm"
                }`}
              >
                <div className="relative aspect-[4/3] overflow-hidden rounded-t-xl bg-card/30">
                  <img
                    src={asset.source.value}
                    alt={asset.altText || asset.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                  {currentAssetId === asset.id && (
                    <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white text-[10px] font-bold shadow-sm">
                      ✓
                    </div>
                  )}
                </div>
                <div className="px-3 py-2">
                  <p className="truncate text-xs font-medium text-text-primary">
                    {asset.name}
                  </p>
                </div>
              </button>
            ))}
          </AssetGrid>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-text-dim/60 transition-colors hover:text-text-dim"
          >
            Clear selection
          </button>
          <p className="text-xs text-text-dim/40">
            {project.assets.length} {project.assets.length === 1 ? "asset" : "assets"} total
          </p>
        </div>
      </div>
    </div>
  );
}
