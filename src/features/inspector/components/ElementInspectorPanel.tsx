"use client";

// ---------------------------------------------------------------------------
// ElementInspectorPanel (Phase P22-C) — the universal style & property
// inspector for the selected element of the selected section.
//
// Selection → element node → inspector schema → sections/controls →
// validated mutation → commitElementTree (one atomic history entry).
//
// Breakpoint context (Desktop/Tablet/Mobile) is the editor's shared viewport
// state: at tablet/mobile, responsive-capable fields write viewport overrides
// and show a reset badge; the base value is never touched.
//
// Phase P22-H — an "Ask AI" composer is shown when a valid renderable
// element in a custom-block section is selected; it routes into the existing
// AI plan pipeline (AiEditPlanReview) with an element-scoped plan.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { useMemo } from "react";
import { Loader2, MousePointerClick, Sparkles } from "lucide-react";
import { cn } from "@/utils/cn";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { InspectorBreakpoint } from "@/features/elements/inspector/types";
import { useElementInspector } from "@/features/inspector/hooks/useElementInspector";
import { useResponsiveSuggestions } from "@/features/inspector/hooks/useResponsiveSuggestions";
import { useAiPlanEdit } from "@/features/ai-editing/hooks/useAiPlanEdit";
import { useElementEditTarget } from "@/features/ai-editing/selected-element";
import { ResponsiveSuggestions } from "./ResponsiveSuggestions";
import { InspectorField } from "./InspectorField";
import { InspectorSection } from "./InspectorSection";

const BREAKPOINTS: Array<{ id: InspectorBreakpoint; label: string; viewport: "desktop" | "tablet" | "mobile" }> = [
  { id: "base", label: "Desktop", viewport: "desktop" },
  { id: "tablet", label: "Tablet", viewport: "tablet" },
  { id: "mobile", label: "Mobile", viewport: "mobile" },
];

const BREAKPOINT_NOTES: Record<InspectorBreakpoint, string> = {
  base: "Editing desktop values. Tablet & mobile inherit these unless overridden.",
  tablet: "Editing tablet values — desktop values are kept as-is.",
  mobile: "Editing mobile values — desktop & tablet values are kept as-is.",
};

// ---------------------------------------------------------------------------
// Phase P22-H — Element AI composer
//
// Shown only when exactly one valid RENDERABLE element is selected inside a
// CUSTOM-BLOCK section (the durable element-tree surface). Submits an
// element-scoped instruction through the EXISTING plan pipeline: the plan
// summary card appears in the AI Assistant and the existing AiEditPlanReview
// dialog opens on "Review Plan" — the same flow section/page/project plans
// use. No second review UI.
// ---------------------------------------------------------------------------

function ElementAiComposer({ sectionId }: { sectionId: string }) {
  const target = useElementEditTarget();
  const { createPlan, isBusy } = useAiPlanEdit();
  const [instruction, setInstruction] = useState("");

  // Only expose the entry for the section this panel inspects with a valid
  // single renderable element in a custom-block section.
  if (!target || target.sectionId !== sectionId) return null;

  const submit = () => {
    const text = instruction.trim();
    if (!text || !target) return;
    setInstruction("");
    void createPlan(text, {
      type: "element",
      pageId: target.pageId,
      sectionId: target.sectionId,
      elementId: target.elementId,
    });
  };

  return (
    <div
      data-testid="element-ai-composer"
      className="border-b border-border/60 px-5 py-3"
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-accent" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-dim">
          Ask AI to modify this element
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          data-testid="element-ai-instruction"
          type="text"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="e.g. make it bold, larger, fade in…"
          maxLength={5000}
          className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-card/40 px-2.5 text-xs text-text-primary outline-none transition-colors placeholder:text-text-dim/50 focus:border-accent/50"
        />
        <button
          type="button"
          data-testid="element-ai-submit"
          onClick={submit}
          disabled={isBusy || instruction.trim().length === 0}
          className="flex h-8 shrink-0 items-center gap-1 rounded-lg bg-accent px-3 text-xs font-medium text-white transition-all hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isBusy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          Ask AI
        </button>
      </div>
      {target && (
        <p className="mt-1.5 text-[10px] text-text-dim/70">
          Targeting:{target.node.type} · {target.elementId}
        </p>
      )}
    </div>
  );
}

/**
 * The universal element inspector for the selected section. The section is
 * derived from the editor store so the panel always reflects the freshest
 * committed state (inspector edits, canvas manipulation, undo/redo, remote
 * projection).
 */
export function ElementInspectorPanel({
  pageId,
  sectionId,
}: {
  pageId: string;
  sectionId: string;
}) {
  const section = useEditorStore((s) => {
    const page = s.project.pages.find((p) => p.id === pageId);
    return page?.sections.find((x) => x.id === sectionId) ?? null;
  });
  const inspector = useElementInspector(pageId, section);
  const theme = useEditorStore((s) => s.project.theme);
  const pages = useEditorStore((s) => s.project.pages);
  // Phase P22-J — durable collections for the data binding composite control.
  const collections = useEditorStore((s) => s.project.collections);
  const setViewport = useEditorStore((s) => s.setViewport);

  // Phase P22-F — rule-based responsive suggestions for this section's tree at
  // the current tablet/mobile viewport (empty at desktop). Hooks are called
  // unconditionally; the empty tree is inert when nothing is selected.
  const suggestions = useResponsiveSuggestions(
    pageId,
    sectionId,
    inspector?.tree ?? { rootIds: [], nodes: {} },
  );

  const palette = useMemo(() => Object.values(theme?.palette ?? {}), [theme]);

  if (!section || !inspector) {
    // Phase P22-K — polished empty state for the Design panel (UI-only).
    return (
      <div
        className="flex flex-col items-center gap-3 px-5 py-10 text-center"
        data-testid="element-inspector-empty"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-base">
          <MousePointerClick className="h-5 w-5 text-text-dim/50" />
        </div>
        <div>
          <p className="text-xs font-medium text-text-muted">No element selected</p>
          <p className="mt-1 text-[11px] leading-relaxed text-text-dim/60">
            Select an element on the canvas to edit its properties here.
          </p>
        </div>
      </div>
    );
  }

  const { model, node } = inspector;
  const breakpoint = inspector.breakpoint;

  return (
    <div className="flex flex-col" data-testid="element-inspector">
      {/* ---- Element header ---- */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="min-w-0">
          <h3 data-testid="element-inspector-title" className="truncate text-sm font-semibold text-text-primary">
            {model.schema.label}
          </h3>
          <p className="text-xs text-text-dim/60">{model.schema.elementType}</p>
        </div>
        {inspector.isNested && (
          <button
            type="button"
            data-testid="element-inspector-to-root"
            onClick={inspector.selectRoot}
            className="shrink-0 rounded-md border border-border bg-card/40 px-2 py-1 text-[11px] font-medium text-text-muted transition-colors hover:border-accent/40 hover:text-text-primary"
            title="Inspect the whole section"
          >
            Section ↑
          </button>
        )}
      </div>

      {/* ---- Phase P22-H — element AI entry ---- */}
      <ElementAiComposer sectionId={sectionId} />

      {/* ---- Breakpoint context ---- */}
      <div className="border-b border-border/60 px-5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div
            role="radiogroup"
            aria-label="Breakpoint"
            className="flex rounded-lg border border-border bg-card/40 p-0.5"
          >
            {BREAKPOINTS.map((bp) => {
              const active = breakpoint === bp.id;
              return (
                <button
                  key={bp.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={`inspector-breakpoint-${bp.id}`}
                  onClick={() => setViewport(bp.viewport)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                    active ? "bg-accent text-white" : "text-text-muted hover:text-text-primary",
                  )}
                >
                  {bp.label}
                </button>
              );
            })}
          </div>
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-accent-hover">
            {breakpoint === "base" ? "Base" : "Override"}
          </span>
        </div>
        <p className="mt-1.5 text-[11px] leading-tight text-text-dim">{BREAKPOINT_NOTES[breakpoint]}</p>
      </div>

      {/* ---- Responsive suggestions (Phase P22-F) — rule-based, explicit accept/dismiss ---- */}
      <ResponsiveSuggestions
        tree={inspector.tree}
        proposals={suggestions.proposals}
        onApply={suggestions.acceptProposal}
        onDismiss={suggestions.dismissProposal}
      />

      {/* ---- Sections ---- */}
      <div className="flex-1">
        {model.schema.sections.map((sectionDef, index) => (
          <InspectorSection key={sectionDef.id} section={sectionDef} defaultOpen={index === 0}>
            {sectionDef.fields.map((field) => (
              <InspectorField
                key={field.id}
                field={field}
                resolved={model.values[field.id]}
                palette={palette}
                disabled={node.locked === true}
                pages={pages}
                tree={inspector.tree}
                sectionId={sectionId}
                collections={collections}
                node={node}
                onCommit={(value) => inspector.commitField(field, value)}
                onResetOverride={() => inspector.resetField(field)}
                onCommitSpacingSide={(side, value) =>
                  inspector.commitSpacingSide(field, side, value ?? "")
                }
              />
            ))}
          </InspectorSection>
        ))}
      </div>
    </div>
  );
}
