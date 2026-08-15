"use client";

// ---------------------------------------------------------------------------
// InspectorSection (Phase P22-C) — collapsible, progressive-disclosure group
// ---------------------------------------------------------------------------

import { useState } from "react";
import { cn } from "@/utils/cn";
import { ChevronIcon } from "./controls/primitives";
import type { InspectorSectionDef } from "@/features/elements/inspector/types";

export interface InspectorSectionProps {
  section: InspectorSectionDef;
  defaultOpen?: boolean;
  children: React.ReactNode;
  /** Rendered when the section is expanded (e.g. a summary line). */
  summary?: string;
}

export function InspectorSection({
  section,
  defaultOpen = false,
  children,
  summary,
}: InspectorSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      data-testid={`inspector-section-${section.id}`}
      className="border-b border-border/60 last:border-b-0"
    >
      <button
        type="button"
        aria-expanded={open}
        data-testid={`inspector-section-${section.id}-toggle`}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-2.5 text-left transition-colors hover:bg-card/40"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-text-primary">
          {section.label}
        </span>
        <span className="flex items-center gap-2">
          {summary && <span className="text-[11px] text-text-dim">{summary}</span>}
          <ChevronIcon className={cn("transition-transform duration-200", open && "rotate-180")} />
        </span>
      </button>
      <div
        className={cn(
          "grid transition-all duration-200 ease-in-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="pb-3 pt-0.5">{children}</div>
        </div>
      </div>
    </section>
  );
}
