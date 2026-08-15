"use client";

// ---------------------------------------------------------------------------
// InteractionField (Phase P22-G) — the whole ElementInteraction object editor
//
// Click (Navigate / Scroll to), Hover, Focus and Scroll (Reveal). Every change
// commits a COMPLETE validated interaction object through the field path (one
// atomic history entry); clearing a group sets that group to null. Unsupported
// actions (toggle / open-modal / submit-form / custom / start-animation) are
// deliberately NOT exposed — they have no P22-G runtime path.
//
// Navigation authoring reuses NavTargetPicker (typed NavTarget model), and all
// URL safety flows through the existing resolveNavTarget / isSafeNavUrl
// boundaries.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { cn } from "@/utils/cn";
import type { Page } from "@/types/project";
import type { InspectorFieldDef } from "@/features/elements/inspector/types";
import type {
  ElementHoverEffect,
  ElementInteraction,
  ElementTree,
} from "@/features/elements/types";
import { isSafeColorValue } from "@/features/elements/inspector/validation";
import { NavTargetPicker } from "@/features/editor/components/NavigateToPicker";
import { FieldShell } from "./primitives";

const CLICK_KINDS = [
  { value: "none", label: "None" },
  { value: "navigate", label: "Navigate" },
  { value: "scroll-to", label: "Scroll to" },
] as const;

const SHADOW_OPTIONS = [
  { value: "none", label: "None" },
  { value: "sm", label: "Small" },
  { value: "md", label: "Medium" },
  { value: "lg", label: "Large" },
] as const;

const REVEAL_PRESETS = [
  { value: "fade", label: "Fade" },
  { value: "slide", label: "Slide" },
  { value: "scale", label: "Scale" },
  { value: "reveal", label: "Reveal" },
  { value: "blur", label: "Blur" },
] as const;

const SEGMENTED_CLASS =
  "h-7 rounded-md px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const SELECT_CLASS =
  "h-7 w-full rounded-md border border-border bg-card/60 px-2 text-xs text-text-primary " +
  "transition-colors focus:border-accent/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

// ---------------------------------------------------------------------------
// Shared hover/focus effect editor (scale + color + background + shadow)
// ---------------------------------------------------------------------------

function EffectEditor({
  effect,
  onChange,
  disabled,
  dataTestPrefix,
}: {
  effect: ElementHoverEffect | null;
  onChange: (next: ElementHoverEffect) => void;
  disabled?: boolean;
  dataTestPrefix: string;
}) {
  const current = effect ?? {};
  const set = (patch: Partial<ElementHoverEffect>) => onChange({ ...current, ...patch });

  const [scaleDraft, setScaleDraft] = useState<string>(
    current.scale !== undefined ? String(current.scale) : "",
  );
  const [colorDraft, setColorDraft] = useState<string>(current.color ?? "");
  const [bgDraft, setBgDraft] = useState<string>(current.backgroundColor ?? "");

  const commitScale = () => {
    const trimmed = scaleDraft.trim();
    if (trimmed === "") {
      const next = { ...current };
      delete next.scale;
      onChange(next);
      return;
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      onChange({ ...current, scale: Math.min(Math.max(numeric, 0), 10) });
    }
  };

  const commitColor = () => {
    if (isSafeColorValue(colorDraft)) set({ color: colorDraft.trim() });
  };

  const commitBg = () => {
    if (isSafeColorValue(bgDraft)) set({ backgroundColor: bgDraft.trim() });
  };

  return (
    <div className="space-y-1.5 rounded-md border border-border/60 bg-card/20 p-2">
      <label className="flex items-center gap-2 text-[11px] text-text-muted">
        <span className="w-14 shrink-0">Scale</span>
        <input
          type="number"
          min={0}
          max={10}
          step={0.05}
          value={scaleDraft}
          disabled={disabled}
          data-testid={`${dataTestPrefix}-scale`}
          onChange={(e) => setScaleDraft(e.target.value)}
          onBlur={commitScale}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitScale();
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-card/60 px-2 text-xs text-text-primary transition-colors focus:border-accent/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="1.05"
        />
      </label>

      <label className="flex items-center gap-2 text-[11px] text-text-muted">
        <span className="w-14 shrink-0">Text</span>
        <input
          type="text"
          value={colorDraft}
          disabled={disabled}
          data-testid={`${dataTestPrefix}-color`}
          onChange={(e) => setColorDraft(e.target.value)}
          onBlur={commitColor}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitColor();
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-card/60 px-2 text-xs text-text-primary transition-colors focus:border-accent/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="#0a0a0a"
        />
      </label>

      <label className="flex items-center gap-2 text-[11px] text-text-muted">
        <span className="w-14 shrink-0">Fill</span>
        <input
          type="text"
          value={bgDraft}
          disabled={disabled}
          data-testid={`${dataTestPrefix}-bg`}
          onChange={(e) => setBgDraft(e.target.value)}
          onBlur={commitBg}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitBg();
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-card/60 px-2 text-xs text-text-primary transition-colors focus:border-accent/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="#7c5cfc"
        />
      </label>

      <label className="flex items-center gap-2 text-[11px] text-text-muted">
        <span className="w-14 shrink-0">Shadow</span>
        <select
          value={current.shadow ?? "none"}
          disabled={disabled}
          data-testid={`${dataTestPrefix}-shadow`}
          onChange={(e) => set({ shadow: e.target.value as ElementHoverEffect["shadow"] })}
          className={SELECT_CLASS}
        >
          {SHADOW_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InteractionField
// ---------------------------------------------------------------------------

export function InteractionField({
  field,
  value,
  pages,
  tree,
  sectionId,
  disabled,
  onCommit,
}: {
  field: InspectorFieldDef;
  value: unknown;
  pages: Page[];
  tree: ElementTree;
  sectionId: string;
  disabled?: boolean;
  onCommit: (value: ElementInteraction | null) => boolean;
}) {
  const interaction =
    value && typeof value === "object" ? (value as ElementInteraction) : null;
  const current = interaction ?? {};
  const commit = (next: ElementInteraction) => onCommit(next);
  const commitPatch = (patch: Partial<ElementInteraction>) =>
    commit({ ...current, ...patch });

  const click = current.click ?? null;
  const hover = current.hover ?? null;
  const focus = current.focus ?? null;
  const scroll = current.scroll ?? null;
  const clickKind = click ? click.kind : "none";

  const scrollTargets = useMemo(() => {
    return Object.values(tree.nodes)
      .filter((node): node is ElementTree["nodes"][string] => !!node && node.id !== sectionId)
      .map((node) => ({ value: node.id, label: `${node.type}: ${node.id}` }));
  }, [tree, sectionId]);

  const handleClickKind = (kind: string) => {
    if (kind === "none") {
      commitPatch({ click: null });
      return;
    }
    if (kind === "navigate") {
      const first = pages[0];
      if (first) {
        commitPatch({
          click: { kind: "navigate", target: { kind: "page", pageId: first.id } },
        });
      }
      return;
    }
    if (kind === "scroll-to") {
      const first = scrollTargets[0];
      if (first) {
        commitPatch({ click: { kind: "scroll-to", elementId: first.value } });
      }
    }
  };

  const handleScrollReveal = (enabled: boolean) => {
    if (!enabled) {
      commitPatch({ scroll: null });
      return;
    }
    const animation =
      scroll?.kind === "reveal"
        ? scroll.animation
        : { trigger: "scroll" as const, type: "fade" as const, durationMs: 600 };
    commitPatch({ scroll: { kind: "reveal", animation } });
  };

  return (
    <FieldShell label={field.label} hint={field.hint}>
      {/* ---- Click ---- */}
      <div className="mb-2">
        <div
          role="radiogroup"
          aria-label="Click behavior"
          className="mb-1.5 flex flex-wrap gap-1"
          data-testid="inspector-interaction-click-kind"
        >
          {CLICK_KINDS.map((option) => {
            const active = clickKind === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                data-testid={`inspector-interaction-click-${option.value}`}
                disabled={disabled}
                onClick={() => handleClickKind(option.value)}
                className={cn(
                  SEGMENTED_CLASS,
                  active
                    ? "bg-accent text-white"
                    : "border border-border bg-card/40 text-text-muted hover:border-accent/40 hover:text-text-primary",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {clickKind === "navigate" && (
          <NavTargetPicker
            pages={pages}
            value={click?.kind === "navigate" ? click.target : null}
            onChange={(target) => commitPatch({ click: { kind: "navigate", target } })}
            onClear={() => commitPatch({ click: null })}
            disabled={disabled}
          />
        )}

        {clickKind === "scroll-to" && (
          <label className="flex items-center gap-2 text-[11px] text-text-muted">
            <span className="w-14 shrink-0">Target</span>
            <select
              value={click?.kind === "scroll-to" ? click.elementId : ""}
              disabled={disabled}
              data-testid="inspector-interaction-scroll-target"
              onChange={(e) => commitPatch({ click: { kind: "scroll-to", elementId: e.target.value } })}
              className={SELECT_CLASS}
            >
              {scrollTargets.map((target) => (
                <option key={target.value} value={target.value}>
                  {target.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* ---- Hover ---- */}
      <div className="mb-2">
        <ToggleRow
          label="Hover"
          checked={hover !== null}
          disabled={disabled}
          dataTestId="inspector-interaction-hover"
          onChange={(enabled) =>
            commitPatch({ hover: enabled ? { scale: 1.05 } : null })
          }
        />
        {hover !== null && (
          <EffectEditor
            effect={hover}
            onChange={(next) => commitPatch({ hover: next })}
            disabled={disabled}
            dataTestPrefix="inspector-interaction-hover"
          />
        )}
      </div>

      {/* ---- Focus ---- */}
      <div className="mb-2">
        <ToggleRow
          label="Focus"
          checked={focus !== null}
          disabled={disabled}
          dataTestId="inspector-interaction-focus"
          onChange={(enabled) =>
            commitPatch({ focus: enabled ? { scale: 1.05 } : null })
          }
        />
        {focus !== null && (
          <EffectEditor
            effect={focus}
            onChange={(next) => commitPatch({ focus: next })}
            disabled={disabled}
            dataTestPrefix="inspector-interaction-focus"
          />
        )}
      </div>

      {/* ---- Scroll → Reveal ---- */}
      <div>
        <ToggleRow
          label="Scroll reveal"
          checked={scroll?.kind === "reveal"}
          disabled={disabled}
          dataTestId="inspector-interaction-scroll"
          onChange={handleScrollReveal}
        />
        {scroll?.kind === "reveal" && (
          <label className="mt-1.5 flex items-center gap-2 text-[11px] text-text-muted">
            <span className="w-14 shrink-0">Preset</span>
            <select
              value={scroll.animation.type}
              disabled={disabled}
              data-testid="inspector-interaction-scroll-preset"
              onChange={(e) =>
                commitPatch({
                  scroll: {
                    kind: "reveal",
                    animation: { ...scroll.animation, type: e.target.value as typeof scroll.animation.type },
                  },
                })
              }
              className={SELECT_CLASS}
            >
              {REVEAL_PRESETS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </FieldShell>
  );
}

function ToggleRow({
  label,
  checked,
  disabled,
  dataTestId,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  dataTestId: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="mb-1.5 flex items-center justify-between">
      <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        data-testid={dataTestId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 rounded-full transition-colors",
          checked ? "bg-accent" : "bg-border",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
