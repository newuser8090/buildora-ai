"use client";

import { useState, useCallback } from "react";
import { ImageIcon, X, Pencil } from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { AssetPicker } from "./AssetPicker";
import { Field } from "@/components/ui/Field";
import type { AssetRef } from "@/features/assets/types";
import type { AssetTypeFilter } from "./AssetPicker";

// ---------------------------------------------------------------------------
// InspectorAssetField — reusable field for selecting/replacing/clearing assets
// ---------------------------------------------------------------------------

export interface InspectorAssetFieldProps {
  label: string;
  value?: AssetRef;
  allowedTypes?: AssetTypeFilter[];
  onChange: (value: AssetRef | undefined) => void;
  description?: string;
  recommendedDimensions?: string;
  allowAltText?: boolean;
  /** Called when alt-text input or other editable field gains focus (for edit sessions). */
  onFocus?: () => void;
  /** Called when alt-text input or other editable field loses focus (for edit sessions). */
  onBlur?: () => void;
}

export function InspectorAssetField({
  label,
  value,
  allowedTypes,
  onChange,
  description,
  recommendedDimensions,
  allowAltText = false,
  onFocus,
  onBlur,
}: InspectorAssetFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const getAsset = useEditorStore((s) => s.getAsset);
  const [altText, setAltText] = useState(value?.altText ?? "");

  // Resolve the asset from the store
  const asset = value?.assetId ? getAsset(value.assetId) : undefined;
  const isMissing = !!value?.assetId && !asset;

  const openPicker = useCallback(() => setPickerOpen(true), []);
  const closePicker = useCallback(() => setPickerOpen(false), []);

  const handleSelect = useCallback(
    (assetId: string) => {
      onChange({ assetId });
      setPickerOpen(false);
    },
    [onChange],
  );

  const handleClear = useCallback(() => {
    onChange(undefined);
    setAltText("");
  }, [onChange]);

  const handleAltTextChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newAlt = e.target.value;
      setAltText(newAlt);
      if (value) {
        onChange({ ...value, altText: newAlt });
      }
    },
    [value, onChange],
  );

  const handleAltBlur = useCallback(() => {
    if (value) {
      onChange({ ...value, altText });
    }
  }, [value, altText, onChange]);

  return (
    <Field label={label}>
      <div className="flex flex-col gap-2">
        {/* Description + dimensions hint */}
        {description && (
          <p className="text-[11px] text-text-dim/60">{description}</p>
        )}

        {/* Asset preview / placeholder */}
        <div
          className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/20 p-2.5 transition-colors hover:bg-card/40"
        >
          {/* Thumbnail */}
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-card/50">
            {isMissing ? (
              <div className="flex h-full w-full items-center justify-center bg-red-500/10">
                <span className="text-[10px] text-red-400">Missing</span>
              </div>
            ) : asset ? (
              <img
                src={asset.source.value}
                alt={altText || asset.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <ImageIcon className="h-5 w-5 text-text-dim/40" />
            )}
          </div>

          {/* Name / actions */}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {isMissing ? (
              <span className="truncate text-xs text-red-400">
                Asset not found — select a replacement
              </span>
            ) : asset ? (
              <span className="truncate text-xs font-medium text-text-primary" title={asset.name}>
                {asset.name}
              </span>
            ) : (
              <span className="text-xs text-text-dim/50">None selected</span>
            )}

            {recommendedDimensions && !asset && (
              <span className="text-[10px] text-text-dim/40">{recommendedDimensions}</span>
            )}

            {asset && recommendedDimensions && (
              <span className="text-[10px] text-text-dim/40">
                {asset.width && asset.height
                  ? `${asset.width}×${asset.height}px`
                  : recommendedDimensions}
              </span>
            )}

            {/* Actions */}
            <div className="mt-0.5 flex gap-2">
              <button
                type="button"
                onClick={openPicker}
                className="text-[11px] font-medium text-accent/80 transition-colors hover:text-accent"
              >
                {asset ? "Change" : "Select"}
              </button>
              {asset && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="flex items-center gap-0.5 text-[11px] text-text-dim/50 transition-colors hover:text-red-400"
                >
                  <X className="h-2.5 w-2.5" />
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Alt text */}
        {allowAltText && value && (
          <div className="flex items-center gap-1.5">
            <Pencil className="h-3 w-3 shrink-0 text-text-dim/40" />
            <input
              value={altText}
              onFocus={onFocus}
              onChange={handleAltTextChange}
              onBlur={() => {
                handleAltBlur();
                onBlur?.();
              }}
              placeholder="Alt text (optional)"
              className="h-7 w-full rounded border border-border/30 bg-base/50 px-2 text-[11px] text-text-muted placeholder:text-text-dim/40 transition-all duration-200 focus:border-accent/30 focus:outline-none"
              aria-label={`Alt text for ${label}`}
            />
          </div>
        )}

        {/* AssetPicker modal */}
        {pickerOpen && (
          <AssetPicker
            currentAssetId={value?.assetId}
            allowedTypes={allowedTypes}
            title={`Select ${label}`}
            onSelect={handleSelect}
            onClear={handleClear}
            onClose={closePicker}
          />
        )}
      </div>
    </Field>
  );
}
