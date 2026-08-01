"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Pencil, X, Check } from "lucide-react";

export interface RenameAssetDialogProps {
  currentName: string;
  onSave: (newName: string) => { success: boolean; error?: string };
  onCancel: () => void;
}

export function RenameAssetDialog({ currentName, onSave, onCancel }: RenameAssetDialogProps) {
  const [value, setValue] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onCancel]);

  const handleSave = useCallback(() => {
    setError(null);
    if (!value.trim()) {
      setError("Name cannot be empty.");
      return;
    }
    const result = onSave(value.trim());
    if (!result.success) {
      setError(result.error || "Rename failed.");
    }
  }, [value, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSave();
      }
    },
    [handleSave],
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onCancel();
    },
    [onCancel],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-dialog-title"
    >
      <div className="mx-4 w-full max-w-sm rounded-2xl border border-border bg-secondary p-5 shadow-elevated">
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-text-dim" />
            <h3 id="rename-dialog-title" className="text-sm font-semibold text-text-primary">
              Rename asset
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-6 w-6 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary"
            aria-label="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(null); }}
            onKeyDown={handleKeyDown}
            className="h-9 flex-1 rounded-lg border border-border bg-base px-3 text-sm text-text-primary placeholder:text-text-dim/50 transition-all duration-200 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/10"
            aria-label="New asset name"
          />
          <button
            type="button"
            onClick={handleSave}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-white transition-all duration-200 hover:bg-accent-hover active:scale-95"
            aria-label="Save rename"
          >
            <Check className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <p className="mt-2 text-xs text-red-400">{error}</p>
        )}
      </div>
    </div>
  );
}
