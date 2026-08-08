// ---------------------------------------------------------------------------
// Help (Phase P9) — KeyboardShortcutsDialog
//
// Accessible dialog (focus trap, Escape, focus restoration) showing the real
// keyboard shortcuts grouped by surface. Reuses the shared dialog patterns.
// ---------------------------------------------------------------------------

"use client";

import { useEffect, useRef, useId } from "react";
import { X } from "lucide-react";
import { SHORTCUT_GROUPS } from "../keyboard-shortcuts";
import { cn } from "@/utils/cn";

export interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsDialog({
  open,
  onClose,
}: KeyboardShortcutsDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = document.activeElement as HTMLElement | null;

    const getFocusable = (): HTMLElement[] => {
      if (!panelRef.current) return [];
      return Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={panelRef}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-elevated"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id={titleId} tabIndex={-1} className="text-base font-semibold text-text-primary">
              Keyboard shortcuts
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              Work faster — every shortcut that actually exists.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-base hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-5">
            {SHORTCUT_GROUPS.map((group) => (
              <section key={group.id}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-dim">
                  {group.title}
                </h3>
                <ul className="mt-2 flex flex-col gap-1">
                  {group.entries.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-start justify-between gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-base"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-text-primary">{entry.label}</p>
                        {entry.hint && (
                          <p className="mt-0.5 text-[11px] text-text-muted">
                            {entry.hint}
                          </p>
                        )}
                      </div>
                      {entry.keys ? (
                        <kbd
                          className={cn(
                            "flex-shrink-0 rounded-md border border-border bg-base px-2 py-1 text-[11px] font-medium text-text-dim",
                          )}
                        >
                          {entry.keys}
                        </kbd>
                      ) : (
                        <span className="flex-shrink-0 text-[11px] text-text-dim/60">
                          in palette
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-base hover:text-text-primary active:scale-95"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
