"use client";

// ---------------------------------------------------------------------------
// AnimationField (Phase P22-G) — the whole ElementAnimation object editor
//
// Trigger / Preset / Duration / Delay / Easing / Repeat / Direction, all
// bounded by the shared ElementAnimationSchema. Every discrete interaction
// commits a COMPLETE validated animation object through the field path (one
// atomic history entry); choosing "None" clears the property (commits null).
//
// The schema-approved vocabulary only: no raw CSS, no arbitrary keyframes,
// no custom animation types.
// ---------------------------------------------------------------------------

import { cn } from "@/utils/cn";
import { useCommittedDraft } from "@/features/inspector/hooks/useCommittedDraft";
import type { InspectorFieldDef } from "@/features/elements/inspector/types";
import type { ElementAnimation } from "@/features/elements/types";
import { FieldShell } from "./primitives";

const TRIGGER_OPTIONS = [
  { value: "none", label: "None" },
  { value: "load", label: "On load" },
  { value: "scroll", label: "On scroll" },
  { value: "viewport", label: "When visible" },
  { value: "hover", label: "On hover" },
  { value: "click", label: "On click" },
] as const;

const PRESET_OPTIONS = [
  { value: "fade", label: "Fade" },
  { value: "slide", label: "Slide" },
  { value: "scale", label: "Scale" },
  { value: "bounce", label: "Bounce" },
  { value: "reveal", label: "Reveal" },
  { value: "blur", label: "Blur" },
  { value: "rotate", label: "Rotate" },
] as const;

const EASING_OPTIONS = [
  { value: "ease", label: "Ease" },
  { value: "linear", label: "Linear" },
  { value: "ease-in", label: "Ease in" },
  { value: "ease-out", label: "Ease out" },
  { value: "ease-in-out", label: "Ease in-out" },
] as const;

const REPEAT_OPTIONS = [
  { value: "none", label: "Once" },
  { value: "2", label: "Twice" },
  { value: "3", label: "3 times" },
  { value: "infinite", label: "Loop" },
] as const;

const DIRECTION_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "reverse", label: "Reverse" },
  { value: "alternate", label: "Alternate" },
] as const;

const DEFAULT_ANIMATION: ElementAnimation = { trigger: "load", type: "fade" };

const SELECT_CLASS =
  "h-7 w-full rounded-md border border-border bg-card/60 px-2 text-xs text-text-primary " +
  "transition-colors focus:border-accent/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

export function AnimationField({
  field,
  value,
  disabled,
  onCommit,
}: {
  field: InspectorFieldDef;
  value: unknown;
  disabled?: boolean;
  onCommit: (value: ElementAnimation | null) => boolean;
}) {
  const animation =
    value && typeof value === "object" ? (value as ElementAnimation) : null;
  const current = animation ?? DEFAULT_ANIMATION;

  const commit = (next: ElementAnimation) => onCommit(next);
  const commitPatch = (patch: Partial<ElementAnimation>) => {
    commit({ ...current, ...patch });
  };

  const handleTrigger = (raw: string) => {
    if (raw === "none") {
      onCommit(null);
      return;
    }
    commit({ ...current, trigger: raw as ElementAnimation["trigger"] });
  };

  const handlePreset = (raw: string) => {
    commit({ ...current, type: raw as ElementAnimation["type"] });
  };

  const handleRepeat = (raw: string) => {
    if (raw === "infinite") {
      commit({ ...current, repeat: "infinite" });
    } else if (raw === "none") {
      const next = { ...current };
      delete next.repeat;
      commit(next);
    } else {
      commit({ ...current, repeat: Number(raw) });
    }
  };

  // Duration / delay — local draft commits on blur / Enter (one entry each).
  const { draft: durationDraft, setDraft: setDurationDraft, resetDraft: resetDurationDraft, isDirtyRef: durationDirtyRef } =
    useCommittedDraft<string>(current.durationMs !== undefined ? String(current.durationMs) : "");
  const { draft: delayDraft, setDraft: setDelayDraft, resetDraft: resetDelayDraft, isDirtyRef: delayDirtyRef } =
    useCommittedDraft<string>(current.delayMs !== undefined ? String(current.delayMs) : "");

  const finishDuration = () => {
    durationDirtyRef.current = false;
    const trimmed = durationDraft.trim();
    if (trimmed === "") {
      const next = { ...current };
      delete next.durationMs;
      commit(next);
      return;
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      commit({ ...current, durationMs: Math.min(Math.max(Math.round(numeric), 0), 60000) });
    }
  };

  const finishDelay = () => {
    delayDirtyRef.current = false;
    const trimmed = delayDraft.trim();
    if (trimmed === "") {
      const next = { ...current };
      delete next.delayMs;
      commit(next);
      return;
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      commit({ ...current, delayMs: Math.min(Math.max(Math.round(numeric), 0), 60000) });
    }
  };

  const durationKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finishDuration();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      resetDurationDraft();
      (e.target as HTMLInputElement).blur();
    }
  };

  const delayKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finishDelay();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      resetDelayDraft();
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <FieldShell label={field.label} hint={field.hint}>
      {/* Trigger */}
      <div
        role="radiogroup"
        aria-label="Trigger"
        className="mb-2 flex flex-wrap gap-1"
        data-testid="inspector-animation-trigger"
      >
        {TRIGGER_OPTIONS.map((option) => {
          const active =
            option.value === "none" ? animation === null : current.trigger === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`inspector-animation-trigger-${option.value}`}
              disabled={disabled}
              onClick={() => handleTrigger(option.value)}
              className={cn(
                "h-7 rounded-md px-2 text-xs font-medium transition-colors",
                active
                  ? "bg-accent text-white"
                  : "border border-border bg-card/40 text-text-muted hover:border-accent/40 hover:text-text-primary",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {/* Preset */}
      <label className="mb-2 flex items-center gap-2 text-[11px] text-text-muted">
        <span className="w-14 shrink-0">Preset</span>
        <select
          value={current.type}
          disabled={disabled}
          data-testid="inspector-animation-preset"
          onChange={(e) => handlePreset(e.target.value)}
          className={SELECT_CLASS}
        >
          {PRESET_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div className="mb-2 grid grid-cols-2 gap-2">
        {/* Duration */}
        <label className="flex items-center gap-2 text-[11px] text-text-muted">
          <span className="w-10 shrink-0">Dur (ms)</span>
          <input
            type="number"
            min={0}
            max={60000}
            step={100}
            value={durationDraft}
            disabled={disabled}
            data-testid="inspector-animation-duration"
            onChange={(e) => setDurationDraft(e.target.value)}
            onKeyDown={durationKeyDown}
            onBlur={finishDuration}
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-card/60 px-2 text-xs text-text-primary transition-colors focus:border-accent/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
        </label>
        {/* Delay */}
        <label className="flex items-center gap-2 text-[11px] text-text-muted">
          <span className="w-10 shrink-0">Delay (ms)</span>
          <input
            type="number"
            min={0}
            max={60000}
            step={100}
            value={delayDraft}
            disabled={disabled}
            data-testid="inspector-animation-delay"
            onChange={(e) => setDelayDraft(e.target.value)}
            onKeyDown={delayKeyDown}
            onBlur={finishDelay}
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-card/60 px-2 text-xs text-text-primary transition-colors focus:border-accent/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
        </label>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-2">
        <label className="flex items-center gap-2 text-[11px] text-text-muted">
          <span className="w-10 shrink-0">Easing</span>
          <select
            value={current.easing ?? "ease"}
            disabled={disabled}
            data-testid="inspector-animation-easing"
            onChange={(e) => commitPatch({ easing: e.target.value })}
            className={SELECT_CLASS}
          >
            {EASING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[11px] text-text-muted">
          <span className="w-10 shrink-0">Repeat</span>
          <select
            value={
              current.repeat === "infinite"
                ? "infinite"
                : typeof current.repeat === "number"
                  ? String(current.repeat)
                  : "none"
            }
            disabled={disabled}
            data-testid="inspector-animation-repeat"
            onChange={(e) => handleRepeat(e.target.value)}
            className={SELECT_CLASS}
          >
            {REPEAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex items-center gap-2 text-[11px] text-text-muted">
        <span className="w-14 shrink-0">Direction</span>
        <select
          value={current.direction ?? "normal"}
          disabled={disabled}
          data-testid="inspector-animation-direction"
          onChange={(e) => commitPatch({ direction: e.target.value as ElementAnimation["direction"] })}
          className={SELECT_CLASS}
        >
          {DIRECTION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </FieldShell>
  );
}
