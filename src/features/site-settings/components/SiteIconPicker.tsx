"use client";

// ---------------------------------------------------------------------------
// SiteIconPicker — Site icon tab
//
// Uploads reuse the existing asset system (processImageFile + addAsset). The
// favicon validator gates MIME/size. Square guidance comes from the asset
// dimensions. No new media persistence is introduced.
// ---------------------------------------------------------------------------

import { useRef, useState } from "react";
import { Upload, RefreshCw } from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { AssetPickerDialog } from "./AssetPickerDialog";
import { validateFaviconFile } from "../services/favicon-validator";
import { validateFile } from "@/features/assets/services/file-validator";
import { processImageFile } from "@/features/assets/services/image-processor";
import { deriveFaviconGuidance } from "../engine/seo-preview";
import type { SiteSettings } from "../types";

export interface SiteIconPickerProps {
  draft: SiteSettings;
  onChange: (patch: Partial<SiteSettings>) => void;
}

export function SiteIconPicker({ draft, onChange }: SiteIconPickerProps) {
  const project = useEditorStore((s) => s.project);
  const addAsset = useEditorStore((s) => s.addAsset);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const guidance = deriveFaviconGuidance(draft, project.assets);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const faviconCheck = validateFaviconFile(file);
        if (!faviconCheck.valid) {
          setError(faviconCheck.error ?? "That image can't be a site icon.");
          continue;
        }
        const uploadCheck = validateFile(file);
        if (!uploadCheck.valid) {
          setError(uploadCheck.error ?? "That image can't be uploaded.");
          continue;
        }
        const processed = await processImageFile(file);
        addAsset(processed);
        onChange({ favicon: { assetId: processed.id } });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-text-dim">
        A small square image shown in browser tabs and bookmarks. It makes
        your site look finished.
      </p>

      <AssetPickerDialog
        assetId={draft.favicon?.assetId}
        title="Choose a site icon"
        allowedTypes={["image", "logo"]}
        onSelect={(assetId) => onChange({ favicon: { assetId } })}
        onClear={() => onChange({ favicon: undefined })}
      />

      <div className="flex items-center gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          data-testid="site-icon-upload"
          className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium text-text-muted transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95 disabled:opacity-50"
          type="button"
        >
          {uploading ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          {uploading ? "Uploading…" : "Upload a new image"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
          data-testid="site-icon-file"
        />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {guidance.coaching.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          {guidance.coaching.map((tip) => (
            <li key={tip} className="text-[11px] text-amber-600 dark:text-amber-400">
              {tip}
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] text-text-dim/70">
        Icons must be PNG, JPG, WebP, or SVG and under 5 MB.
      </p>
    </div>
  );
}
