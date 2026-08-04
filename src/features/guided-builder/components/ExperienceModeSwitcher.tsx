// ---------------------------------------------------------------------------
// ExperienceModeSwitcher — Guided / Standard / Advanced (Phase N, spec §3)
//
// UI preference only: switching modes never creates project history and never
// marks the project dirty. The choice is persisted locally.
// ---------------------------------------------------------------------------

"use client";

import { useRef, useState, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { useGuidedBuilderStore } from "../store/guided-builder-store";
import type { EditorExperienceMode } from "../types";

const OPTIONS: { value: EditorExperienceMode; label: string; hint: string }[] = [
  {
    value: "guided",
    label: "Guided",
    hint: "Simple language and helpful suggestions",
  },
  {
    value: "standard",
    label: "Standard",
    hint: "The regular editor controls",
  },
  {
    value: "advanced",
    label: "Advanced",
    hint: "Every detailed control",
  },
];

export function ExperienceModeSwitcher() {
  const mode = useGuidedBuilderStore((s) => s.experienceMode);
  const hydrated = useGuidedBuilderStore((s) => s.hydrated);
  const setMode = useGuidedBuilderStore((s) => s.setExperienceMode);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const current = OPTIONS.find((o) => o.value === mode) ?? OPTIONS[1];
  // Gate the rendered label on hydration: prefs are only known post-mount, so
  // SSR and the first client paint both safely show the default label until
  // the persisted mode is read (prevents hydration mismatch for returning
  // users who saved guided/advanced).
  const displayLabel = hydrated ? current.label : OPTIONS[1].label;

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        data-testid="experience-mode-switcher"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-text-dim transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95"
      >
        <span data-testid="experience-mode-current">{displayLabel}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-text-dim/60 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Experience mode"
          data-testid="experience-mode-menu"
          className="absolute right-0 top-9 z-50 w-56 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-elevated"
        >
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={mode === option.value}
              onClick={() => {
                setMode(option.value);
                setOpen(false);
              }}
              data-testid={`experience-mode-${option.value}`}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-base ${
                mode === option.value ? "text-accent" : "text-text-primary"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium">{option.label}</span>
                <span className="block text-[10px] text-text-muted">
                  {option.hint}
                </span>
              </span>
              {mode === option.value && <Check className="h-3.5 w-3.5 flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
