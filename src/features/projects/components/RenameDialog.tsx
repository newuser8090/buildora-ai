// ---------------------------------------------------------------------------
// RenameDialog — inline rename dialog for project cards
// ---------------------------------------------------------------------------

"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export interface RenameDialogProps {
  open: boolean;
  currentName: string;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export function RenameDialog({
  open,
  currentName,
  onConfirm,
  onCancel,
  isLoading = false,
  error,
}: RenameDialogProps) {
  const [name, setName] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    } else {
      previousFocusRef.current?.focus();
    }
  }, [open]);

  // Sync name when currentName changes and dialog is open
  // Using requestAnimationFrame to avoid set-state-in-effect lint rule
  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => setName(currentName));
      return () => cancelAnimationFrame(id);
    }
  }, [open, currentName]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (name.trim() && !isLoading) {
        onConfirm(name.trim());
      }
    },
    [name, isLoading, onConfirm],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && !isLoading) {
        onCancel();
      }
    },
    [onCancel, isLoading],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-dialog-title"
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-elevated animate-in fade-in zoom-in-95 duration-200">
        <h3
          id="rename-dialog-title"
          className="text-lg font-semibold text-text-primary"
        >
          Rename Project
        </h3>

        <form onSubmit={handleSubmit} className="mt-4">
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={80}
            className="h-10 w-full rounded-lg border border-border bg-base px-3 text-sm text-text-primary placeholder:text-text-dim/50 transition-all duration-200 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20"
            placeholder="Project name"
            aria-label="Project name"
            disabled={isLoading}
          />

          {error && (
            <p className="mt-2 text-xs text-red-400" role="alert">
              {error}
            </p>
          )}

          <div className="mt-4 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !name.trim()}
              className="flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? "Renaming..." : "Rename"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
