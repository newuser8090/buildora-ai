"use client";

import { useCallback, useEffect, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";
import { AssetUsageList } from "./AssetUsageList";
import type { AssetUsageReference } from "@/features/assets/services/reference-analyzer";

export interface DeleteConfirmDialogProps {
  assetName: string;
  references: AssetUsageReference[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmDialog({
  assetName,
  references,
  onConfirm,
  onCancel,
}: DeleteConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onCancel]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onCancel();
    },
    [onCancel],
  );

  const hasReferences = references.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
    >
      <div className="mx-4 w-full max-w-md rounded-2xl border border-border bg-secondary p-6 shadow-elevated">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/15">
              <AlertTriangle className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <h3 id="delete-dialog-title" className="text-sm font-semibold text-text-primary">
                Delete asset
              </h3>
              <p className="text-xs text-text-dim/70 mt-0.5">{assetName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary"
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Warning */}
        {hasReferences ? (
          <div className="mb-5 rounded-xl border border-red-500/20 bg-red-500/5 p-4">
            <p className="mb-3 text-sm text-red-400">
              This asset is currently used in your sections.
              Deleting it will also remove all references to it.
            </p>
            <AssetUsageList references={references} />
          </div>
        ) : (
          <p className="mb-5 text-sm text-text-muted">
            Are you sure you want to delete this asset? This action cannot be undone.
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-9 flex-1 items-center justify-center rounded-lg border border-border text-sm font-medium text-text-muted transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-[0.98]"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="flex h-9 flex-1 items-center justify-center rounded-lg bg-red-500 text-sm font-medium text-white transition-all duration-200 hover:bg-red-400 active:scale-[0.98]"
          >
            {hasReferences ? "Delete anyway" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
