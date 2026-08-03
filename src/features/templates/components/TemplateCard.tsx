// ---------------------------------------------------------------------------
// TemplateCard — a template card with a lightweight, deterministic preview
//
// The preview is a pure CSS mock (browser frame, header strip, hero block,
// content blocks, CTA/footer strip) derived from the template's TemplatePreview
// model — never a rendered editor project. Cards are keyboard accessible and
// expose distinct Preview / Use actions.
// ---------------------------------------------------------------------------

"use client";

import { useId } from "react";
import type { BuildoraTemplate } from "../types";
import { TEMPLATE_CATEGORY_LABELS } from "../types";
import { cn } from "@/utils/cn";

export interface TemplateCardProps {
  template: BuildoraTemplate;
  selected?: boolean;
  onPreview?: (template: BuildoraTemplate) => void;
  onUse?: (template: BuildoraTemplate) => void;
  /** Expose the Use action on the card itself (used by the gallery). */
  showUse?: boolean;
}

function PreviewFrame({ template }: { template: BuildoraTemplate }) {
  const accent = template.preview.accent ?? "#7c5cfc";
  const background = template.preview.background ?? "#ffffff";
  const badge = template.preview.badge;
  const sections = template.preview.sections;

  return (
    <div
      aria-hidden="true"
      className="relative h-36 overflow-hidden rounded-t-xl border-b border-border bg-canvas"
      style={{ background }}
    >
      {/* Browser dots */}
      <div className="flex items-center gap-1 bg-black/20 px-2 py-1">
        <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
        <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
        <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
      </div>

      <div className="space-y-1 p-2">
        {sections.map((section, i) => (
          <div
            key={`${section.kind}-${i}`}
            className={cn(
              "rounded-sm",
              section.kind === "header" && "flex items-center gap-1 px-1 py-0.5",
              section.kind === "hero" && "flex flex-col items-center justify-center gap-1 py-2.5",
              section.kind === "content" && "grid grid-cols-3 gap-1 py-1",
              section.kind === "pricing" && "grid grid-cols-3 gap-1 py-1",
              section.kind === "cta" && "flex items-center justify-center py-1",
              section.kind === "footer" && "flex items-center justify-center py-0.5",
            )}
          >
            {section.kind === "header" && (
              <>
                <span className="h-1.5 w-8 rounded-sm bg-black/40" style={{ background: accent, opacity: 0.7 }} />
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-black/30" />
                <span className="h-1.5 w-1.5 rounded-full bg-black/30" />
              </>
            )}
            {section.kind === "hero" && (
              <>
                <span className="h-2 w-3/4 rounded-sm bg-black/60" style={{ background: accent }} />
                <span className="h-1 w-1/2 rounded-sm bg-black/25" />
                <span className="mt-0.5 h-1.5 w-1/4 rounded-sm" style={{ background: accent }} />
              </>
            )}
            {section.kind === "content" && (
              <>
                <span className="h-6 rounded-sm bg-black/10" />
                <span className="h-6 rounded-sm bg-black/10" />
                <span className="h-6 rounded-sm bg-black/10" />
              </>
            )}
            {section.kind === "pricing" && (
              <>
                <span className="h-7 rounded-sm border border-black/10" />
                <span className="h-7 rounded-sm border border-black/10" style={{ borderColor: accent, background: accent, opacity: 0.15 }} />
                <span className="h-7 rounded-sm border border-black/10" />
              </>
            )}
            {section.kind === "cta" && (
              <span className="h-2 w-1/3 rounded-sm" style={{ background: accent }} />
            )}
            {section.kind === "footer" && (
              <span className="h-1 w-2/5 rounded-sm bg-black/25" />
            )}
          </div>
        ))}
      </div>

      {badge && (
        <span
          className="absolute right-1.5 top-5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold text-white"
          style={{ background: accent }}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

export function TemplateCard({
  template,
  selected = false,
  onPreview,
  onUse,
  showUse = false,
}: TemplateCardProps) {
  const titleId = useId();

  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border bg-card transition-all duration-200",
        selected
          ? "border-accent ring-2 ring-accent/30"
          : "border-border hover:border-accent/40 hover:shadow-elevated",
      )}
    >
      {/* Preview + select target */}
      <button
        type="button"
        onClick={() => onPreview?.(template)}
        aria-labelledby={titleId}
        className="cursor-pointer text-left focus-visible:outline-none"
      >
        <PreviewFrame template={template} />
      </button>

      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3
              id={titleId}
              className={cn(
                "truncate text-sm font-semibold",
                selected ? "text-accent" : "text-text-primary",
              )}
            >
              {template.name}
            </h3>
            <span className="mt-0.5 inline-block rounded bg-base px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-dim">
              {TEMPLATE_CATEGORY_LABELS[template.category]}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onPreview?.(template)}
            className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-text-muted transition-colors hover:bg-base hover:text-text-primary focus-visible:outline-none"
            aria-label={`Preview ${template.name}`}
          >
            Preview
          </button>
        </div>

        <p className="line-clamp-2 text-xs text-text-muted">{template.description}</p>

        {showUse && onUse && (
          <button
            type="button"
            onClick={() => onUse(template)}
            className="mt-1 flex h-8 items-center justify-center rounded-lg bg-accent text-xs font-medium text-white transition-all hover:bg-accent-hover active:scale-95 focus-visible:outline-none"
            aria-label={`Use ${template.name}`}
          >
            Use Template
          </button>
        )}
      </div>
    </div>
  );
}
