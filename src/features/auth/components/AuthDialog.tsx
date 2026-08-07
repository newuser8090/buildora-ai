"use client";

// ---------------------------------------------------------------------------
// Auth (Phase P6) — sign up / sign in dialog
//
// Beginner-friendly, keyboard-accessible, provider-independent. Repeated
// submissions are blocked (busy flag). Errors are user-safe; account
// existence is never revealed. Focus is trapped and restored.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, X, Mail, Lock } from "lucide-react";
import { useAuth } from "../useAuth";
import { PasswordResetDialog } from "./PasswordResetDialog";
import { useFocusTrap } from "./useFocusTrap";

type Mode = "sign-in" | "sign-up";

export interface AuthDialogProps {
  open: boolean;
  onClose: () => void;
  initialMode?: Mode;
  onSuccess?: () => void;
}

export function AuthDialog({ open, onClose, initialMode = "sign-in", onSuccess }: AuthDialogProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showReset, setShowReset] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const { busy, error, signIn, signUp, clearError } = useAuth();

  useFocusTrap(open, dialogRef);

  // Reset local state each time the dialog opens. The reset runs as a
  // render-phase adjustment (never synchronously inside an effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setFieldError(null);
      setMode(initialMode);
      setShowReset(false);
    }
  }

  // Store-level errors are cleared once the dialog is open (external store).
  useEffect(() => {
    if (open) clearError();
  }, [open, clearError]);

  const validate = useCallback((): boolean => {
    const trimmed = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      setFieldError("Please enter a valid email address.");
      return false;
    }
    if (password.length < 6) {
      setFieldError("Your password needs to be at least 6 characters.");
      return false;
    }
    setFieldError(null);
    return true;
  }, [email, password]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (busy) return; // block repeated submissions
      if (!validate()) return;
      const ok =
        mode === "sign-in"
          ? await signIn(email, password)
          : await signUp(email, password);
      if (ok) {
        onClose();
        onSuccess?.();
      }
    },
    [busy, validate, mode, signIn, signUp, email, password, onClose, onSuccess],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-dialog-title"
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-elevated"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 id="auth-dialog-title" className="text-lg font-semibold text-text-primary">
              {mode === "sign-in" ? "Welcome back" : "Create your account"}
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              {mode === "sign-in"
                ? "Back up your saved pieces and use them anywhere."
                : "Back them up and use them anywhere."}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-base hover:text-text-primary"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
          <div>
            <label htmlFor="auth-email" className="mb-1.5 block text-sm font-medium text-text-primary">
              Email
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-dim" />
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="h-10 w-full rounded-lg border border-border bg-base pl-9 pr-3 text-sm text-text-primary placeholder:text-text-dim/50 transition-all focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20"
                aria-invalid={!!fieldError}
              />
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="auth-password" className="text-sm font-medium text-text-primary">
                Password
              </label>
              {mode === "sign-in" && (
                <button
                  onClick={() => setShowReset(true)}
                  className="text-xs font-medium text-accent hover:text-accent-hover"
                  type="button"
                >
                  Forgot password?
                </button>
              )}
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-dim" />
              <input
                id="auth-password"
                type="password"
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="h-10 w-full rounded-lg border border-border bg-base pl-9 pr-3 text-sm text-text-primary placeholder:text-text-dim/50 transition-all focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20"
                aria-invalid={!!fieldError}
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
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "sign-in" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-text-muted">
          {mode === "sign-in" ? "New to Buildora?" : "Already have an account?"}{" "}
          <button
            onClick={() => {
              setMode(mode === "sign-in" ? "sign-up" : "sign-in");
              setFieldError(null);
              clearError();
            }}
            className="font-medium text-accent hover:text-accent-hover"
            type="button"
          >
            {mode === "sign-in" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </div>

      <PasswordResetDialog open={showReset} onClose={() => setShowReset(false)} />
    </div>
  );
}
