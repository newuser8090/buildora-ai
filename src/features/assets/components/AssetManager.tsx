"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  X, Search, Loader2, AlertTriangle,
} from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { DragDropZone } from "./DragDropZone";
import { AssetCard } from "./AssetCard";
import { AssetGrid } from "./AssetGrid";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { RenameAssetDialog } from "./RenameAssetDialog";
import { ReplaceAssetInput } from "./ReplaceAssetInput";
import { findAssetReferences } from "@/features/assets/services/reference-analyzer";
import { validateFile } from "@/features/assets/services/file-validator";
import { processImageFile } from "@/features/assets/services/image-processor";
import type { Asset } from "@/features/assets/types";
import type { AssetTypeFilter } from "./AssetPicker";

export interface AssetManagerProps {
  onClose: () => void;
}

interface ProcessingFile {
  name: string;
  status: "processing" | "success" | "error";
  error?: string;
}

export function AssetManager({ onClose }: AssetManagerProps) {
  const project = useEditorStore((s) => s.project);
  const addAsset = useEditorStore((s) => s.addAsset);
  const removeAsset = useEditorStore((s) => s.removeAsset);
  const renameAssetAction = useEditorStore((s) => s.renameAsset);
  const replaceAssetAction = useEditorStore((s) => s.replaceAsset);
  const getAsset = useEditorStore((s) => s.getAsset);

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<AssetTypeFilter>("all");
  const [isUploading, setIsUploading] = useState(false);
  const [processingFiles, setProcessingFiles] = useState<ProcessingFile[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);
  const [deleteRefs, setDeleteRefs] = useState<ReturnType<typeof findAssetReferences>>([]);

  // Rename dialog state
  const [renameTarget, setRenameTarget] = useState<Asset | null>(null);

  // Replace dialog state
  const [replaceTarget, setReplaceTarget] = useState<Asset | null>(null);

  // Close on Escape
  useEffect(() => {
    searchRef.current?.focus();
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deleteTarget && !renameTarget && !replaceTarget) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose, deleteTarget, renameTarget, replaceTarget]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !deleteTarget && !renameTarget && !replaceTarget) {
        onClose();
      }
    },
    [onClose, deleteTarget, renameTarget, replaceTarget],
  );

  // ---- Upload ----
  const handleFiles = useCallback(
    async (files: File[]) => {
      setIsUploading(true);

      const fileStates: ProcessingFile[] = files.map((f) => ({
        name: f.name,
        status: "processing" as const,
      }));
      setProcessingFiles(fileStates);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const validation = validateFile(file);
        if (!validation.valid) {
          setProcessingFiles((prev) => {
            const next = [...prev];
            next[i] = { ...next[i], status: "error", error: validation.error };
            return next;
          });
          continue;
        }

        try {
          const processed = await processImageFile(file);
          addAsset(processed);
          setProcessingFiles((prev) => {
            const next = [...prev];
            next[i] = { ...next[i], status: "success" };
            return next;
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Processing failed.";
          setProcessingFiles((prev) => {
            const next = [...prev];
            next[i] = { ...next[i], status: "error", error: msg };
            return next;
          });
        }
      }

      setIsUploading(false);
    },
    [addAsset],
  );

  // ---- Delete ----
  const handleDeleteClick = useCallback(
    (assetId: string) => {
      const asset = getAsset(assetId);
      if (!asset) return;
      const refs = findAssetReferences(project, assetId);
      setDeleteTarget(asset);
      setDeleteRefs(refs);
    },
    [getAsset, project],
  );

  const handleDeleteConfirm = useCallback(() => {
    if (!deleteTarget) return;
    removeAsset(deleteTarget.id, { clearReferences: true });
    setDeleteTarget(null);
    setDeleteRefs([]);
  }, [deleteTarget, removeAsset]);

  const handleDeleteCancel = useCallback(() => {
    setDeleteTarget(null);
    setDeleteRefs([]);
  }, []);

  // ---- Rename ----
  const handleRenameClick = useCallback(
    (assetId: string) => {
      const asset = getAsset(assetId);
      if (asset) setRenameTarget(asset);
    },
    [getAsset],
  );

  const handleRenameSave = useCallback(
    (newName: string) => {
      if (!renameTarget) return { success: false, error: "No asset selected." };
      return renameAssetAction(renameTarget.id, newName);
    },
    [renameTarget, renameAssetAction],
  );

  const handleRenameCancel = useCallback(() => {
    setRenameTarget(null);
  }, []);

  // ---- Replace ----
  const handleReplaceClick = useCallback(
    (assetId: string) => {
      const asset = getAsset(assetId);
      if (asset) setReplaceTarget(asset);
    },
    [getAsset],
  );

  const handleReplaceFile = useCallback(
    async (file: File) => {
      if (!replaceTarget) return;
      const validation = validateFile(file);
      if (!validation.valid) throw new Error(validation.error);
      const processed = await processImageFile(file);
      replaceAssetAction(replaceTarget.id, processed);
      setReplaceTarget(null);
    },
    [replaceTarget, replaceAssetAction],
  );

  // ---- Filtering ----
  const filtered = project.assets.filter((asset) => {
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
      aria-labelledby="asset-manager-title"
    >
      <div className="mx-4 flex h-[85vh] w-full max-w-5xl flex-col rounded-2xl border border-border bg-secondary shadow-elevated">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 id="asset-manager-title" className="text-sm font-semibold text-text-primary">
              Asset Manager
            </h2>
            <p className="text-xs text-text-dim/60 mt-0.5">
              {project.assets.length} {project.assets.length === 1 ? "asset" : "assets"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary"
            aria-label="Close asset manager"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search + filter bar */}
        <div className="flex items-center gap-3 border-b border-border px-6 py-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-dim/40" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name..."
              className="h-9 w-full rounded-lg border border-border bg-base pl-9 pr-3 text-sm text-text-primary placeholder:text-text-dim/40 transition-all duration-200 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/10"
              aria-label="Search assets"
            />
          </div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as AssetTypeFilter)}
            className="h-9 rounded-lg border border-border bg-base px-3 text-sm text-text-muted focus:border-accent/40 focus:outline-none"
            aria-label="Filter by asset type"
          >
            <option value="all">All types</option>
            <option value="image">Images</option>
            <option value="logo">Logos</option>
            <option value="background">Backgrounds</option>
          </select>
        </div>

        {/* Upload zone */}
        <div className="border-b border-border px-6 py-3">
          <DragDropZone onFilesSelected={handleFiles} disabled={isUploading} />
          {isUploading && processingFiles.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {processingFiles.map((pf, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-text-muted">
                  {pf.status === "processing" && (
                    <Loader2 className="h-3 w-3 animate-spin text-accent" />
                  )}
                  {pf.status === "success" && (
                    <span className="text-accent">✓</span>
                  )}
                  {pf.status === "error" && (
                    <AlertTriangle className="h-3 w-3 text-red-400" />
                  )}
                  <span>{pf.name}</span>
                  {pf.error && <span className="text-red-400">— {pf.error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {filtered.length > 0 ? (
            <AssetGrid>
              {filtered.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  usageCount={findAssetReferences(project, asset.id).length}
                  onRename={handleRenameClick}
                  onReplace={handleReplaceClick}
                  onDelete={handleDeleteClick}
                />
              ))}
            </AssetGrid>
          ) : (
            <AssetGrid isEmpty emptyMessage={search || filterType !== "all" ? "No matching assets." : undefined} />
          )}
        </div>
      </div>

      {/* Dialogs */}
      {deleteTarget && (
        <DeleteConfirmDialog
          assetName={deleteTarget.name}
          references={deleteRefs}
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
        />
      )}

      {renameTarget && (
        <RenameAssetDialog
          currentName={renameTarget.name}
          onSave={handleRenameSave}
          onCancel={handleRenameCancel}
        />
      )}

      {replaceTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-border bg-secondary p-5 shadow-elevated">
            <ReplaceAssetInput
              assetName={replaceTarget.name}
              onReplace={handleReplaceFile}
              onCancel={() => setReplaceTarget(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
