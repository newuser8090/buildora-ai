"use client";

// ---------------------------------------------------------------------------
// AssetPickerDialog — small trigger that opens the existing AssetPicker
// (reused by social share image and site icon selection).
// ---------------------------------------------------------------------------

import { useState } from "react";
import { ImagePlus } from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { AssetPicker } from "@/features/assets/components/AssetPicker";
import { AssetThumbnail } from "@/features/assets/components/AssetThumbnail";

export interface AssetPickerDialogProps {
  assetId?: string;
  title?: string;
  allowedTypes?: ("image" | "logo" | "background")[];
  onSelect: (assetId: string) => void;
  onClear: () => void;
}

export function AssetPickerDialog({
  assetId,
  title = "Choose an image",
  allowedTypes,
  onSelect,
  onClear,
}: AssetPickerDialogProps) {
  const [open, setOpen] = useState(false);
  const getAsset = useEditorStore((s) => s.getAsset);
  const selected = assetId ? getAsset(assetId) : undefined;

  return (
    <>
      <div className="flex items-center gap-2">
        {selected ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-base p-1.5 pr-2">
            <AssetThumbnail
              src={selected.source.value}
              alt={selected.name}
              className="h-10 w-10 rounded-md"
            />
            <div className="min-w-0">
              <p className="truncate text-xs text-text-primary">{selected.name}</p>
              <button
                onClick={onClear}
                className="text-[11px] text-text-dim underline hover:no-underline"
                type="button"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setOpen(true)}
            data-testid="asset-picker-trigger"
            className="flex h-10 items-center gap-2 rounded-lg border border-dashed border-border px-3 text-xs text-text-dim transition-colors hover:border-accent/40 hover:text-text-primary"
            type="button"
          >
            <ImagePlus className="h-4 w-4" />
            Choose an image
          </button>
        )}
      </div>

      {open && (
        <AssetPicker
          currentAssetId={assetId}
          title={title}
          allowedTypes={allowedTypes}
          onSelect={(id) => {
            onSelect(id);
            setOpen(false);
          }}
          onClear={() => {
            onClear();
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
