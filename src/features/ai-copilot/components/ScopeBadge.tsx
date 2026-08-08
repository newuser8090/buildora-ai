"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Globe, MousePointer2, LayoutPanelTop, Type } from "lucide-react";
import type { FieldPathSegment } from "@/features/inline-editing/types";
import type { Project } from "@/types/project";
import { cn } from "@/utils/cn";
import type { CopilotScope } from "../types";

// ---------------------------------------------------------------------------
// Scope options derived from live selection — the Copilot NEVER pretends it
// is editing a selection that does not exist.
// ---------------------------------------------------------------------------

export interface ScopeOption {
  value: CopilotScope;
  label: string;
  sublabel?: string;
  icon: "project" | "page" | "section" | "element";
}

export function buildScopeOptions(options: {
  project: Project;
  selectedPageId: string | null;
  selectedSectionId: string | null;
  selectedField: {
    label: string;
    pageId: string;
    sectionId: string;
    fieldPath: FieldPathSegment[];
  } | null;
}): ScopeOption[] {
  const { project, selectedPageId, selectedSectionId, selectedField } = options;
  const pages = project.pages ?? [];
  const activePage = pages.find((p) => p.id === selectedPageId) ?? pages[0];

  const opts: ScopeOption[] = [
    { value: { type: "project" }, label: "Whole website", icon: "project" },
  ];

  if (activePage) {
    opts.push({
      value: { type: "page", pageId: activePage.id },
      label: activePage.title || "This page",
      sublabel: "page",
      icon: "page",
    });
  }

  if (selectedField) {
    opts.push({
      value: {
        type: "element",
        pageId: selectedField.pageId,
        sectionId: selectedField.sectionId,
        fieldPath: selectedField.fieldPath,
      },
      label: selectedField.label,
      sublabel: "selected text",
      icon: "element",
    });
  } else if (selectedSectionId) {
    const section = pages
      .flatMap((p) => p.sections)
      .find((s) => s.id === selectedSectionId);
    if (section) {
      const pageId = pages.find((p) => p.sections.some((s) => s.id === selectedSectionId))?.id ?? "";
      opts.push({
        value: { type: "section", pageId, sectionId: section.id },
        label: `${section.type.charAt(0).toUpperCase() + section.type.slice(1)} section`,
        sublabel: "section",
        icon: "section",
      });
    }
  }

  return opts;
}

const ICONS = {
  project: Globe,
  page: LayoutPanelTop,
  section: MousePointer2,
  element: Type,
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ScopeBadgeProps {
  value: CopilotScope;
  options: ScopeOption[];
  onChange: (scope: CopilotScope) => void;
}

export function ScopeBadge({ value, options, onChange }: ScopeBadgeProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const current =
    options.find((o) => JSON.stringify(o.value) === JSON.stringify(value)) ?? options[0];
  const CurrentIcon = ICONS[current?.icon ?? "project"];

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Close only the dropdown — never let this bubble to the panel's own
        // Escape handler (which would close the whole Copilot).
        e.stopPropagation();
        setOpen(false);
      }
    };
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        data-testid="copilot-scope-badge"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-full items-center gap-2 rounded-xl border border-border bg-base px-3 text-left text-xs transition-all duration-200 hover:border-accent/30 hover:bg-card active:scale-[0.99]"
      >
        <CurrentIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-text-primary">
          {current?.label ?? "Whole website"}
        </span>
        {current?.sublabel && (
          <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-dim">
            {current.sublabel}
          </span>
        )}
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 text-text-dim transition-transform duration-200", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Choose what the AI acts on"
          data-testid="copilot-scope-options"
          className="absolute inset-x-0 top-full z-20 mt-1.5 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-elevated"
        >
          {options.map((option) => {
            const OptionIcon = ICONS[option.icon];
            const selected = JSON.stringify(option.value) === JSON.stringify(value);
            return (
              <button
                key={JSON.stringify(option.value)}
                type="button"
                role="option"
                aria-selected={selected}
                data-testid={`copilot-scope-option-${option.icon}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors",
                  selected ? "bg-accent/[0.06] text-accent" : "text-text-muted hover:bg-base hover:text-text-primary",
                )}
              >
                <OptionIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.sublabel && (
                  <span className="shrink-0 text-[9px] uppercase tracking-wide text-text-dim/70">
                    {option.sublabel}
                  </span>
                )}
                {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
