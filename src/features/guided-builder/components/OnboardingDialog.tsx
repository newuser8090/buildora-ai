// ---------------------------------------------------------------------------
// OnboardingDialog — first-run onboarding (Phase N, spec §4)
//
// Steps:
//   1. Welcome
//   2. What are you creating?        (category)
//   3. How would you like to begin?  (guided / template / ai / blank)
//   4. Choose your comfort level     (new / experienced / expert)
//   5. Create project
//
// Guarantees:
//   - user can skip at any time (Escape or Skip)
//   - fully keyboard accessible, focus trapped, focus restored on close
//   - progress indicator, choices preserved while moving between steps
//   - no project created until final confirmation; repeated confirmation
//     blocked while creating
//   - project creation is delegated to the caller (existing template/controller)
//   - selected experience mode is derived from the comfort choice
// ---------------------------------------------------------------------------

"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react";
import type {
  OnboardingBeginChoice,
  OnboardingComfortLevel,
  OnboardingProjectCategory,
  OnboardingSelections,
} from "../types";
import { ONBOARDING_CATEGORY_LABELS } from "../types";

const CATEGORY_OPTIONS: OnboardingProjectCategory[] = [
  "business",
  "portfolio",
  "store",
  "restaurant",
  "personal",
  "event",
  "other",
];

const BEGIN_OPTIONS: {
  value: OnboardingBeginChoice;
  label: string;
  hint: string;
}[] = [
  {
    value: "guided",
    label: "Guide me step by step",
    hint: "I pick blocks and you tell me what to add next.",
  },
  {
    value: "template",
    label: "Start from a template",
    hint: "A ready-made starting point I can change.",
  },
  {
    value: "ai",
    label: "Describe it to AI",
    hint: "Tell the assistant what you want in plain words.",
  },
  {
    value: "blank",
    label: "Begin with a blank page",
    hint: "An empty page and full freedom.",
  },
];

const COMFORT_OPTIONS: {
  value: OnboardingComfortLevel;
  label: string;
  hint: string;
}[] = [
  {
    value: "new",
    label: "I’m completely new",
    hint: "I want simple words and helpful suggestions.",
  },
  {
    value: "experienced",
    label: "I’ve edited websites before",
    hint: "I know my way around editors.",
  },
  {
    value: "expert",
    label: "I want full control",
    hint: "Show me every detailed control.",
  },
];

export interface OnboardingDialogProps {
  open: boolean;
  /** Skip / close without creating. */
  onClose: () => void;
  /** Create the project (caller uses the existing template/controller flow). */
  onComplete: (
    selections: OnboardingSelections,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** Called when the user picks "Start from a template". */
  onStartFromTemplate: (selections: OnboardingSelections) => void;
}

const TOTAL_STEPS = 4;

export function OnboardingDialog({
  open,
  onClose,
  onComplete,
  onStartFromTemplate,
}: OnboardingDialogProps) {
  const [step, setStep] = useState(0);
  const [category, setCategory] = useState<OnboardingProjectCategory | null>(null);
  const [begin, setBegin] = useState<OnboardingBeginChoice | null>(null);
  const [comfort, setComfort] = useState<OnboardingComfortLevel | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const creatingRef = useRef(creating);
  const openRef = useRef(open);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    creatingRef.current = creating;
    openRef.current = open;
    onCloseRef.current = onClose;
  }, [creating, open, onClose]);

  // Reset when the dialog opens.
  const prevOpenRef = useRef(open);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setStep(0);
      setError(null);
      setCreating(false);
    }
    prevOpenRef.current = open;
  }, [open]);

  // Focus trap + Escape + focus restoration.
  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = document.activeElement as HTMLElement | null;

    const getFocusable = (): HTMLElement[] => {
      if (!panelRef.current) return [];
      return Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (creatingRef.current) return;
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = active && panelRef.current?.contains(active);
      if (e.shiftKey) {
        if (!inside || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    const handleFocusIn = (e: FocusEvent) => {
      if (!openRef.current) return;
      if (!panelRef.current) return;
      if (!panelRef.current.contains(e.target as Node)) {
        getFocusable()[0]?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);

    const raf = window.setTimeout(() => {
      getFocusable()[0]?.focus();
    }, 30);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      window.clearTimeout(raf);
      prevFocusRef.current?.focus();
      prevFocusRef.current = null;
    };
  }, [open]);

  const canContinue =
    (step === 0) ||
    (step === 1 && category !== null) ||
    (step === 2 && begin !== null) ||
    (step === 3 && comfort !== null);

  const handleCreate = useCallback(async () => {
    if (creating) return;
    if (!category || !begin || !comfort) return;

    const selections: OnboardingSelections = { category, begin, comfort };

    // "Start from a template" hands off to the existing gallery flow.
    if (begin === "template") {
      onStartFromTemplate(selections);
      return;
    }

    setCreating(true);
    setError(null);
    const result = await onComplete(selections);
    setCreating(false);
    if (!result.ok) {
      setError(result.error ?? "Could not create the project. Please try again.");
    }
  }, [creating, category, begin, comfort, onComplete, onStartFromTemplate]);

  const handleNext = useCallback(() => {
    if (step === 0) {
      setStep(1);
      return;
    }
    if (step === 1 && category !== null) {
      setStep(2);
      return;
    }
    if (step === 2 && begin !== null) {
      setStep(3);
      return;
    }
    if (step === 3 && comfort !== null) {
      // Final step: create the project (or hand off to the template gallery).
      void handleCreate();
    }
  }, [step, category, begin, comfort, handleCreate]);

  const handleBack = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
    setError(null);
  }, []);

  if (!open) return null;

  const progressPct = Math.round(((step + 1) / TOTAL_STEPS) * 100);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-busy={creating}
    >
      <div
        ref={panelRef}
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-card shadow-elevated"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent">
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </div>
            <h2 id={titleId} tabIndex={-1} className="text-sm font-semibold text-text-primary">
              Let’s get you building
            </h2>
          </div>
          <button
            type="button"
            onClick={() => !creating && onClose()}
            disabled={creating}
            aria-label="Skip onboarding"
            data-testid="onboarding-close"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-base hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Progress */}
        <div className="border-b border-border px-5 py-2">
          <div
            className="h-1 w-full overflow-hidden rounded-full bg-base"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPct}
            aria-label={`Step ${step + 1} of ${TOTAL_STEPS}`}
          >
            <div
              className="h-full rounded-full bg-accent transition-all duration-300 motion-reduce:transition-none"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-text-dim">
            Step {step + 1} of {TOTAL_STEPS}
          </p>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {step === 0 && (
            <div className="flex flex-col gap-2 text-center">
              <h3 className="text-lg font-semibold text-text-primary">
                Let’s turn your idea into a website
              </h3>
              <p className="text-sm leading-relaxed text-text-muted">
                Answer three quick questions and we’ll set up the right
                starting point for you. No experience needed.
              </p>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-text-primary">
                What are you creating?
              </h3>
              <div className="grid grid-cols-1 gap-2">
                {CATEGORY_OPTIONS.map((value) => {
                  const active = category === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={active}
                      data-testid={`onboarding-category-${value}`}
                      onClick={() => setCategory(value)}
                      className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-all duration-200 active:scale-[0.98] ${
                        active
                          ? "border-accent/50 bg-accent/10 text-text-primary"
                          : "border-border/50 text-text-primary hover:border-accent/30 hover:bg-base"
                      }`}
                    >
                      {ONBOARDING_CATEGORY_LABELS[value]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-text-primary">
                How would you like to begin?
              </h3>
              <div className="flex flex-col gap-2">
                {BEGIN_OPTIONS.map((option) => {
                  const active = begin === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={active}
                      data-testid={`onboarding-begin-${option.value}`}
                      onClick={() => setBegin(option.value)}
                      className={`rounded-lg border px-3 py-2.5 text-left transition-all duration-200 active:scale-[0.98] ${
                        active
                          ? "border-accent/50 bg-accent/10"
                          : "border-border/50 hover:border-accent/30 hover:bg-base"
                      }`}
                    >
                      <span className="block text-sm font-medium text-text-primary">
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-text-muted">
                        {option.hint}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-text-primary">
                Choose your comfort level
              </h3>
              <div className="flex flex-col gap-2">
                {COMFORT_OPTIONS.map((option) => {
                  const active = comfort === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={active}
                      data-testid={`onboarding-comfort-${option.value}`}
                      onClick={() => setComfort(option.value)}
                      className={`rounded-lg border px-3 py-2.5 text-left transition-all duration-200 active:scale-[0.98] ${
                        active
                          ? "border-accent/50 bg-accent/10"
                          : "border-border/50 hover:border-accent/30 hover:bg-base"
                      }`}
                    >
                      <span className="block text-sm font-medium text-text-primary">
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-text-muted">
                        {option.hint}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <div
              role="alert"
              data-testid="onboarding-error"
              className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          {step > 0 ? (
            <button
              type="button"
              onClick={handleBack}
              disabled={creating}
              className="flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-base hover:text-text-primary active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>
          ) : (
            <button
              type="button"
              onClick={() => !creating && onClose()}
              disabled={creating}
              data-testid="onboarding-skip"
              className="text-xs font-medium text-text-dim transition-colors hover:text-text-primary"
            >
              Skip for now
            </button>
          )}

          <button
            type="button"
            onClick={handleNext}
            disabled={!canContinue || creating}
            data-testid="onboarding-next"
            className="flex h-9 items-center gap-1 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {step < 3 ? (
              <>
                Continue
                <ChevronRight className="h-4 w-4" />
              </>
            ) : creating ? (
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                aria-hidden="true"
              />
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Create my project
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
