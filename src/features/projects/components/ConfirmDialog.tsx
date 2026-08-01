// ---------------------------------------------------------------------------
// ConfirmDialog — accessible confirmation dialog for destructive actions
// ---------------------------------------------------------------------------

"use client";

import { useEffect, useRef, useCallback } from "react";
import { cn } from "@/utils/cn";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Name of the project being acted on (for display in the message area) */
  projectName?: string;
  isLoading?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
  isLoading = false,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Trap focus and handle Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isLoading) {
        onCancel();
      }
      // Trap Tab focus inside dialog
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    },
    [onCancel, isLoading],
  );

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      // Focus the confirm button after a frame
      requestAnimationFrame(() => {
        confirmRef.current?.focus();
      });
      window.addEventListener("keydown", handleKeyDown);
    } else {
      previousFocusRef.current?.focus();
    }

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-message"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-elevated animate-in fade-in zoom-in-95 duration-200"
      >
        <h3
          id="confirm-dialog-title"
          className="text-lg font-semibold text-text-primary"
        >
          {title}
        </h3>
        <p
          id="confirm-dialog-message"
          className="mt-2 text-sm text-text-muted leading-relaxed"
        >
          {message}
        </p>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            disabled={isLoading}
            className={cn(
              "flex h-9 items-center rounded-lg px-4 text-sm font-medium transition-all duration-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50",
              destructive
                ? "bg-red-600 text-white hover:bg-red-500"
                : "bg-accent text-white hover:bg-accent-hover",
            )}
            type="button"
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <svg
                  className="h-4 w-4 animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
                {confirmLabel}
              </span>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
