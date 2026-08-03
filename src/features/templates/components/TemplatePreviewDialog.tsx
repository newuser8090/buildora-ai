// ---------------------------------------------------------------------------
// TemplatePreviewDialog — larger preview of a single template
//
// Accessible dialog with a focus trap, Escape-to-close, focus restoration,
// and a "Use this template" action that returns the selection to the caller.
// Previewing never creates or persists a project.
// ---------------------------------------------------------------------------

"use client";

import { useEffect, useRef, useId } from "react";
import type { BuildoraTemplate } from "../types";
import { TEMPLATE_CATEGORY_LABELS } from "../types";

export interface TemplatePreviewDialogProps {
  template: BuildoraTemplate | null;
  onClose: () => void;
  onUse: (template: BuildoraTemplate) => void;
}

export function TemplatePreviewDialog({
  template,
  onClose,
  onUse,
}: TemplatePreviewDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const open = template !== null;

  // Focus management: initial focus, trap, restoration.
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
        onClose();
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
      if (!panelRef.current) return;
      if (!panelRef.current.contains(e.target as Node)) {
        getFocusable()[0]?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);

    const raf = window.setTimeout(() => getFocusable()[0]?.focus(), 30);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      window.clearTimeout(raf);
      prevFocusRef.current?.focus();
      prevFocusRef.current = null;
    };
  }, [open, onClose]);

  if (!template) return null;

  const accent = template.preview.accent ?? "#7c5cfc";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={panelRef}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-elevated"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} tabIndex={-1} className="text-base font-semibold text-text-primary">
              {template.name}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="rounded bg-base px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-dim">
                {TEMPLATE_CATEGORY_LABELS[template.category]}
              </span>
              {template.tags.map((tag) => (
                <span key={tag} className="text-[11px] text-text-dim">
                  #{tag}
                </span>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-base hover:text-text-primary"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-sm text-text-muted">{template.description}</p>

          {/* Larger preview mock */}
          <div
            className="mt-4 overflow-hidden rounded-lg border border-border"
            style={{ background: template.preview.background ?? "#ffffff" }}
          >
            <div className="flex items-center gap-1 bg-black/20 px-3 py-1.5">
              <span className="h-2 w-2 rounded-full bg-white/40" />
              <span className="h-2 w-2 rounded-full bg-white/40" />
              <span className="h-2 w-2 rounded-full bg-white/40" />
            </div>
            <div className="space-y-2 p-4">
              <div className="flex items-center justify-between">
                <span className="h-2 w-20 rounded-sm" style={{ background: accent }} />
                <span className="h-2 w-2 rounded-full bg-black/25" />
                <span className="h-2 w-2 rounded-full bg-black/25" />
              </div>
              <div className="flex flex-col items-center gap-1.5 py-4">
                <span className="h-3 w-3/5 rounded-sm" style={{ background: accent }} />
                <span className="h-1.5 w-2/5 rounded-sm bg-black/20" />
                <span className="mt-1 h-2.5 w-1/5 rounded-sm" style={{ background: accent }} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <span className="h-12 rounded-sm bg-black/10" />
                <span className="h-12 rounded-sm bg-black/10" />
                <span className="h-12 rounded-sm bg-black/10" />
              </div>
              <div className="flex justify-center py-1">
                <span className="h-2.5 w-1/3 rounded-sm" style={{ background: accent }} />
              </div>
            </div>
          </div>

          {/* Section list */}
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-dim">
              Sections
            </h3>
            <ul className="mt-2 space-y-1">
              {template.preview.sections.map((section, i) => (
                <li
                  key={`${section.kind}-${i}`}
                  className="flex items-center gap-2 text-sm text-text-muted"
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
                  {section.label}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-base hover:text-text-primary active:scale-95"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onUse(template)}
            className="flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95"
            aria-label={`Use ${template.name} template`}
          >
            Use this template
          </button>
        </div>
      </div>
    </div>
  );
}
