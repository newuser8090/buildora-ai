"use client";

// ---------------------------------------------------------------------------
// Spacing / Radius / Shadow controls (Phase P22-C)
//
// SpacingField: 4-way (Top/Right/Bottom/Left) with an optional "all sides"
// shortcut. Per-side edits commit on blur/Enter (one history entry each) and
// write longhand tokens so sides never conflict with the shorthand.
// RadiusField: theme presets + free value. ShadowField: preset dropdown.
// ---------------------------------------------------------------------------

import { cn } from "@/utils/cn";
import { useCommittedDraft } from "@/features/inspector/hooks/useCommittedDraft";
import type { InspectorFieldDef } from "@/features/elements/inspector/types";
import { parseNumberInput } from "@/features/elements/inspector/validation";
import type { SpacingSidesDisplay } from "@/features/elements/inspector/resolver";
import { FIELD_INPUT_CLASS, FieldShell } from "./primitives";

// ---------------------------------------------------------------------------
// SpacingField
// ---------------------------------------------------------------------------

const SIDES = [
  { key: "top", label: "Top" },
  { key: "right", label: "Right" },
  { key: "bottom", label: "Bottom" },
  { key: "left", label: "Left" },
] as const;

export function SpacingField({
  field,
  value,
  error,
  overridden,
  onResetOverride,
  disabled,
  onCommitSide,
}: {
  field: InspectorFieldDef;
  value: SpacingSidesDisplay | null;
  error?: string | null;
  overridden?: boolean;
  onResetOverride?: () => void;
  disabled?: boolean;
  onCommitSide: (side: "top" | "right" | "bottom" | "left", value: string | undefined) => void;
}) {
  const sides = value ?? { top: "", right: "", bottom: "", left: "" };
  const allEqual =
    sides.top === sides.right && sides.right === sides.bottom && sides.bottom === sides.left;

  return (
    <FieldShell
      label={field.label}
      hint={field.hint}
      error={error}
      overridden={overridden}
      onResetOverride={onResetOverride}
    >
      {/* All-sides shortcut (commits the shorthand token). */}
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-text-dim">All</span>
        <div className="min-w-0 flex-1">
          <SideInput
            field={field}
            side="all"
            value={allEqual ? sides.top : ""}
            placeholder={allEqual ? sides.top || "0" : "…"}
            disabled={disabled}
            onCommit={(v) => {
              if (v === undefined) return;
              onCommitSide("top", v);
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {SIDES.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-1.5">
            <span className="w-9 shrink-0 text-[10px] uppercase tracking-wider text-text-dim">
              {label}
            </span>
            <div className="min-w-0 flex-1">
              <SideInput
                field={field}
                side={key}
                value={sides[key]}
                placeholder="0"
                disabled={disabled}
                onCommit={(v) => onCommitSide(key, v)}
              />
            </div>
          </label>
        ))}
      </div>
    </FieldShell>
  );
}

function SideInput({
  field,
  side,
  value,
  placeholder,
  disabled,
  onCommit,
}: {
  field: InspectorFieldDef;
  side: "top" | "right" | "bottom" | "left" | "all";
  value: string;
  placeholder: string;
  disabled?: boolean;
  onCommit: (value: string | undefined) => void;
}) {
  const { draft, setDraft, resetDraft, isDirtyRef } = useCommittedDraft<string>(value);

  const finish = () => {
    if (!isDirtyRef.current) return;
    isDirtyRef.current = false;
    const trimmed = draft.trim();
    onCommit(trimmed === "" || trimmed.toLowerCase() === "auto" ? undefined : trimmed);
  };

  return (
    <input
      data-testid={side === "all" ? `inspector-${field.id}-all` : `inspector-${field.id}-${side}`}
      className={cn(FIELD_INPUT_CLASS, "px-1.5 text-center")}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          resetDraft();
          (e.target as HTMLInputElement).blur();
        }
      }}
      onBlur={finish}
    />
  );
}

// ---------------------------------------------------------------------------
// RadiusField — presets + free value
// ---------------------------------------------------------------------------

export const RADIUS_PRESETS = [
  { label: "0", value: "0", key: "none" },
  { label: "S", value: "var(--radius-sm, 0.375rem)", key: "sm" },
  { label: "M", value: "var(--radius-md, 0.5rem)", key: "md" },
  { label: "L", value: "var(--radius-lg, 0.75rem)", key: "lg" },
  { label: "XL", value: "var(--radius-xl, 1rem)", key: "xl" },
  { label: "∞", value: "9999px", key: "full" },
];

export function RadiusField({
  field,
  value,
  error,
  overridden,
  onResetOverride,
  disabled,
  onCommit,
}: {
  field: InspectorFieldDef;
  value: unknown;
  error?: string | null;
  overridden?: boolean;
  onResetOverride?: () => void;
  disabled?: boolean;
  onCommit: (value: number | string | undefined) => void;
}) {
  const current = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  const activePreset = RADIUS_PRESETS.find((p) => p.value === current);

  return (
    <FieldShell
      label={field.label}
      hint={field.hint}
      error={error}
      overridden={overridden}
      onResetOverride={onResetOverride}
    >
      <div className="flex items-center gap-1.5">
        <div className="flex gap-1">
          {RADIUS_PRESETS.map((preset) => {
            const active = (activePreset?.key ?? "") === preset.key;
            return (
              <button
                key={preset.key}
                type="button"
                data-testid={`inspector-${field.id}-preset-${preset.key}`}
                title={`Radius ${preset.label}`}
                disabled={disabled}
                onClick={() => onCommit(preset.value === "0" ? 0 : preset.value)}
                className={cn(
                  "flex h-7 min-w-8 items-center justify-center rounded-md px-1.5 text-[10px] font-medium transition-colors",
                  active
                    ? "bg-accent text-white"
                    : "border border-border bg-card/40 text-text-muted hover:border-accent/40 hover:text-text-primary",
                  disabled && "cursor-not-allowed opacity-50",
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <div className="relative min-w-0 flex-1">
          <input
            data-testid={`inspector-${field.id}`}
            className={FIELD_INPUT_CLASS}
            value={current}
            placeholder="Custom"
            disabled={disabled}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              const trimmed = e.target.value.trim();
              if (trimmed === "" || trimmed.toLowerCase() === "auto") {
                onCommit(undefined);
                return;
              }
              const parsed = parseNumberInput(trimmed);
              onCommit(parsed !== null ? parsed : trimmed);
            }}
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-text-dim/70">
            px
          </span>
        </div>
      </div>
    </FieldShell>
  );
}

// ---------------------------------------------------------------------------
// ShadowField — preset dropdown
// ---------------------------------------------------------------------------

export function ShadowField({
  field,
  value,
  error,
  overridden,
  onResetOverride,
  disabled,
  onCommit,
}: {
  field: InspectorFieldDef;
  value: unknown;
  error?: string | null;
  overridden?: boolean;
  onResetOverride?: () => void;
  disabled?: boolean;
  onCommit: (value: string) => void;
}) {
  const current = typeof value === "string" ? value : "";
  const options = field.options ?? [];
  return (
    <FieldShell
      label={field.label}
      hint={field.hint}
      error={error}
      overridden={overridden}
      onResetOverride={onResetOverride}
      htmlFor={`inspector-${field.id}`}
    >
      <select
        id={`inspector-${field.id}`}
        data-testid={`inspector-${field.id}`}
        className={cn(FIELD_INPUT_CLASS, "cursor-pointer appearance-none")}
        value={current}
        disabled={disabled}
        onChange={(e) => onCommit(e.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}
