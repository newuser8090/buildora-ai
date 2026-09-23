// ---------------------------------------------------------------------------
// StarterChooserDialog — Stage 2 onboarding chooser
//
// Presented when a user clicks "Build Your Website" on the dashboard. Two
// distinct starting paths:
//   1. Start from Scratch — creates the blank-canvas project (single clean
//      starter section) through the existing template flow.
//   2. Choose a Template — hands off to the full template gallery, with
//      curated one-click quick-picks (Local Grocery Store, Design Portfolio,
//      Modern Bakery) surfaced inline.
//
// Creation always goes through the caller's onCreate handler (the canonical
// controller flow) — this component never touches persistence itself.
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { LayoutTemplate, PenLine, Sparkles } from "lucide-react";
import { templateRegistry } from "../registry/template-registry";
import { registerDefaultTemplates } from "../registry/register-default-templates";
import { TEMPLATE_CATEGORY_LABELS } from "../types";
import type { BuildoraTemplate } from "../types";
import { cn } from "@/utils/cn";

export const STARTER_TEMPLATE_IDS = [
  "template-grocery",
  "template-portfolio",
  "template-bakery",
] as const;

/** Display labels for curated quick-picks (may differ from template.name). */
const CURATED_LABELS: Record<string, string> = {
  "template-grocery": "Local Grocery Store",
  "template-portfolio": "Design Portfolio",
  "template-bakery": "Modern Bakery",
};

export interface StarterChooserDialogProps {
  open: boolean;
  onClose: () => void;
  /** Create the blank-canvas project (canonical controller flow). */
  onCreateBlank: () => void | Promise<void>;
  /** Open the full template gallery. */
  onBrowseTemplates: () => void;
  /** Create a curated template by id (canonical controller flow). */
  onCreateTemplate: (templateId: string, projectName: string) => void | Promise<void>;
  /** Disables actions while a project is being created. */
  isBusy?: boolean;
}

/** Small deterministic preview chip for a curated quick-pick card. */
function CuratedPreviewChip({ template }: { template: BuildoraTemplate }) {
  const accent = template.preview.accent ?? "#7c5cfc";
  const background = template.preview.background ?? "#ffffff";
  const kinds = template.preview.sections.slice(0, 4);
  return (
    <div
      aria-hidden="true"
      className="flex h-16 flex-col justify-end gap-1 overflow-hidden rounded-lg border border-black/5 p-2"
      style={{ background }}
    >
      {kinds.map((section, i) => (
        <span
          key={`${section.kind}-${i}`}
          className={cn(
            "block rounded-[3px]",
            section.kind === "hero" ? "h-4" : "h-1.5",
          )}
          style={{
            background: accent,
            opacity: section.kind === "hero" ? 0.85 : 0.35,
            width: section.kind === "hero" ? "75%" : `${85 - i * 12}%`,
          }}
        />
      ))}
    </div>
  );
}

function CuratedCard({
  template,
  label,
  disabled,
  onUse,
}: {
  template: BuildoraTemplate;
  label: string;
  disabled?: boolean;
  onUse: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`starter-quickpick-${template.id}`}
      onClick={onUse}
      disabled={disabled}
      className="group flex flex-col gap-2 rounded-xl border border-black/10 bg-white p-2.5 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-[#7D2AE8]/40 hover:shadow-[0_6px_16px_rgba(0,0,0,0.08)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <CuratedPreviewChip template={template} />
      <span className="block truncate text-sm font-medium text-[#0d0f14]">
        {label}
      </span>
      <span className="block truncate text-xs text-[#8a8f9c]">
        {TEMPLATE_CATEGORY_LABELS[template.category]} · {template.defaultName}
      </span>
    </button>
  );
}

export function StarterChooserDialog({
  open,
  onClose,
  onCreateBlank,
  onBrowseTemplates,
  onCreateTemplate,
  isBusy = false,
}: StarterChooserDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Idempotent + Strict-Mode safe: guarantees the curated set exists for
  // registry lookups even on a fresh dashboard mount.
  registerDefaultTemplates();

  const curated = useMemo(
    () =>
      STARTER_TEMPLATE_IDS.map(
        (id): { id: string; template: BuildoraTemplate; label: string } | null => {
          const template = templateRegistry.get(id);
          return template
            ? { id, template, label: CURATED_LABELS[id] ?? id }
            : null;
        },
      ).filter((entry): entry is { id: string; template: BuildoraTemplate; label: string } =>
        entry !== null,
      ),
    [],
  );

  // Escape closes + focus trap (same discipline as ConfirmDialog).
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isBusy) {
        onClose();
      }
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
    [onClose, isBusy],
  );

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="starter-chooser-title"
      data-testid="starter-chooser"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-xl rounded-2xl border border-black/5 bg-white p-6 shadow-[0_16px_48px_rgba(0,0,0,0.18)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="starter-chooser-title"
              className="text-lg font-semibold text-[#0d0f14]"
            >
              What kind of website do you want to build?
            </h2>
            <p className="mt-1 text-sm text-[#8a8f9c]">
              Pick a starting point — you can change everything later.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            aria-label="Close dialog"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-[#8a8f9c] transition-colors hover:bg-[#F2F3F5] hover:text-[#0d0f14] disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Path A — Start from Scratch */}
          <button
            type="button"
            data-testid="starter-path-blank"
            onClick={onCreateBlank}
            disabled={isBusy}
            className="group flex flex-col items-start gap-2 rounded-xl border border-black/10 bg-white p-4 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-[#7D2AE8]/40 hover:shadow-[0_6px_16px_rgba(0,0,0,0.08)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#F0E7FD] text-[#7D2AE8]">
              <PenLine className="h-4.5 w-4.5" />
            </span>
            <span className="text-sm font-semibold text-[#0d0f14]">
              Start from Scratch
            </span>
            <span className="text-xs leading-relaxed text-[#8a8f9c]">
              A clean, blank canvas ready for freeform drag-and-drop.
            </span>
          </button>

          {/* Path B — Choose a Template */}
          <button
            type="button"
            data-testid="starter-path-gallery"
            onClick={onBrowseTemplates}
            disabled={isBusy}
            className="group flex flex-col items-start gap-2 rounded-xl border border-black/10 bg-white p-4 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-[#7D2AE8]/40 hover:shadow-[0_6px_16px_rgba(0,0,0,0.08)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#F0E7FD] text-[#7D2AE8]">
              <LayoutTemplate className="h-4.5 w-4.5" />
            </span>
            <span className="text-sm font-semibold text-[#0d0f14]">
              Choose a Template
            </span>
            <span className="text-xs leading-relaxed text-[#8a8f9c]">
              Browse the full gallery of curated business starters.
            </span>
          </button>
        </div>

        {/* Curated quick-picks */}
        {curated.length > 0 && (
          <div className="mt-5">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#8a8f9c]">
              <Sparkles className="h-3.5 w-3.5 text-[#7D2AE8]" />
              Popular starters
            </h3>
            <div className="mt-2 grid grid-cols-3 gap-2.5">
              {curated.map((entry) => (
                <CuratedCard
                  key={entry.id}
                  template={entry.template}
                  label={entry.label}
                  disabled={isBusy}
                  onUse={() =>
                    void onCreateTemplate(
                      entry.template.id,
                      entry.template.defaultName,
                    )
                  }
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
