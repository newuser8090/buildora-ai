"use client";

// ---------------------------------------------------------------------------
// Auth (Phase P6) — password reset dialog
//
// Email → provider password reset. Always reports the same outcome whether
// or not the account exists (no account-existence leakage). Repeated
// submissions are blocked; focus is trapped and restored.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, X, Mail } from "lucide-react";
import { useAuth } from "../useAuth";
import { useFocusTrap } from "./useFocusTrap";

export interface PasswordResetDialogProps {
  open: boolean;
  onClose: () => void;
}

export function PasswordResetDialog({ open, onClose }: PasswordResetDialogProps) {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const { busy, error, resetPassword, clearError } = useAuth();

  useFocusTrap(open, dialogRef);

  // Reset local state when the dialog opens (render-phase adjustment).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setFieldError(null);
      setSent(false);
    }
  }

  useEffect(() => {
    if (open) clearError();
  }, [open, clearError]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (busy) return;
      const trimmed = email.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
        setFieldError("Please enter a valid email address.");
        return;
      }
      setFieldError(null);
      const ok = await resetPassword(trimmed);
      if (ok) setSent(true);
    },
    [busy, email, resetPassword],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-title"
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-elevated"
      >
        <div className="flex items-start justify-between">
          <h2 id="reset-title" className="text-lg font-semibold text-text-primary">
            Reset your password
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-base hover:text-text-primary"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {sent ? (
          <div className="mt-5">
            <p className="text-sm text-text-muted">
              If an account exists for that email, Buildora has sent a reset link. Check your inbox.
            </p>
            <button
              onClick={onClose}
              className="mt-5 flex h-10 w-full items-center justify-center rounded-lg bg-accent text-sm font-medium text-white transition-all hover:bg-accent-hover"
              type="button"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
            <p className="text-sm text-text-muted">
              Enter the email you used to sign up and we&apos;ll send you a reset link.
            </p>
            <div>
              <label htmlFor="reset-email" className="mb-1.5 block text-sm font-medium text-text-primary">
                Email
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-dim" />
                <input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="h-10 w-full rounded-lg border border-border bg-base pl-9 pr-3 text-sm text-text-primary placeholder:text-text-dim/50 transition-all focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20"
                />
              </div>
            </div>
            {(fieldError || error) && (
              <p className="text-sm text-red-400" role="alert">
                {fieldError ?? error?.message}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-white transition-all hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Send reset link
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
