"use client";

// ---------------------------------------------------------------------------
// CodeImportDialog — the Import Studio (Phase P3)
//
// A single canonical staged dialog used by every entry point:
//   Paste → Analyse → Review → Place → Done
//
// Accessibility:
//   - focus trap + focus restoration on close
//   - stepper uses aria-current for the active step
//   - Escape closes ONLY when idle (never mid-analysis / mid-insert)
//   - analysis completion announced via live region
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef } from "react";
import { X, Code2 } from "lucide-react";
import { cn } from "@/utils/cn";
import { useCodeImportStore, type ImportStep } from "../store/code-import-store";
import { CodePasteStep } from "./CodePasteStep";
import { CodeAnalysisStep } from "./CodeAnalysisStep";
import { CodeReviewStep } from "./CodeReviewStep";
import { CodePlacementStep } from "./CodePlacementStep";
import { CodeImportSuccess } from "./CodeImportSuccess";

const STEPS: { id: ImportStep; label: string }[] = [
  { id: "paste", label: "Paste" },
  { id: "analyse", label: "Analyse" },
  { id: "review", label: "Review" },
  { id: "place", label: "Place" },
  { id: "success", label: "Done" },
];

export function CodeImportDialog() {
  const open = useCodeImportStore((s) => s.open);
  const step = useCodeImportStore((s) => s.step);
  const status = useCodeImportStore((s) => s.status);
  const closeDialog = useCodeImportStore((s) => s.closeDialog);
  const setStep = useCodeImportStore((s) => s.setStep);

  const dialogRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  const busy = status === "analysing" || status === "inserting";
  const canClose = !busy;

  // Focus trap + restoration.
  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    const raf = window.setTimeout(() => {
      dialogRef.current?.focus();
    }, 20);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(raf);
      document.removeEventListener("keydown", handleKeyDown);
      prevFocusRef.current?.focus?.();
      prevFocusRef.current = null;
    };
  }, [open]);

  // Escape closes only when idle.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && canClose) {
        e.preventDefault();
        closeDialog();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, canClose, closeDialog]);

  const goTo = useCallback(
    (target: ImportStep) => setStep(target),
    [setStep],
  );

  if (!open) return null;

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Import code"
      data-testid="code-import-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget && canClose) closeDialog();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        data-testid="import-studio"
        className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-base shadow-2xl outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10">
              <Code2 className="h-4 w-4 text-accent" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Import code</h2>
              <p className="text-[11px] text-text-dim">
                Turn pasted code into editable building blocks
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            data-testid="import-dialog-close"
            disabled={!canClose}
            onClick={closeDialog}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Stepper */}
        <nav aria-label="Import steps" className="border-b border-border px-4 py-2.5 sm:px-5">
          <ol className="flex items-center gap-1" data-testid="import-stepper">
            {STEPS.map((item, index) => {
              const current = item.id === step;
              const done = index < stepIndex;
              return (
                <li key={item.id} className="flex min-w-0 flex-1 items-center gap-1">
                  <span
                    aria-current={current ? "step" : undefined}
                    data-testid={`import-step-${item.id}`}
                    className={cn(
                      "flex h-6 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium transition-colors",
                      current
                        ? "bg-accent/15 text-accent ring-1 ring-accent/30"
                        : done
                          ? "text-text-muted"
                          : "text-text-dim/60",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 flex-none items-center justify-center rounded-full text-[9px] font-bold",
                        current
                          ? "bg-accent text-white"
                          : done
                            ? "bg-emerald-500/20 text-emerald-400"
                            : "bg-card text-text-dim",
                      )}
                    >
                      {done ? "✓" : index + 1}
                    </span>
                    <span className="hidden truncate sm:inline">{item.label}</span>
                  </span>
                  {index < STEPS.length - 1 && (
                    <span className="h-px flex-1 bg-border/60" aria-hidden="true" />
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          <div
            role="status"
            aria-live="polite"
            className="sr-only"
            data-testid="import-live-region"
          >
            {status === "analysing"
              ? "Analysing your code"
              : status === "ready"
                ? "Analysis complete"
                : status === "inserting"
                  ? "Adding your design"
                  : status === "success"
                    ? "Your design was added"
                    : ""}
          </div>

          {step === "paste" && <CodePasteStep />}
          {step === "analyse" && (
            <CodeAnalysisStep
              onContinue={() => goTo("review")}
              onBack={() => goTo("paste")}
            />
          )}
          {step === "review" && (
            <CodeReviewStep
              onContinue={() => goTo("place")}
              onBack={() => goTo("analyse")}
            />
          )}
          {step === "place" && <CodePlacementStep onBack={() => goTo("review")} />}
          {step === "success" && <CodeImportSuccess />}
        </div>
      </div>
    </div>
  );
}
