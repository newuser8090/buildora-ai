"use client";

// ---------------------------------------------------------------------------
// ColorField + SliderField (Phase P22-C)
//
// ColorField: theme palette swatches + a native color input. Dragging inside
// the native picker is transient (local draft); the value commits when the
// picker closes (onChange), so a color gesture produces ONE history entry.
// SliderField: draft-while-dragging, commit on pointer-up / blur (one entry).
// ---------------------------------------------------------------------------

import { cn } from "@/utils/cn";
import { useCommittedDraft } from "@/features/inspector/hooks/useCommittedDraft";
import type { InspectorFieldDef } from "@/features/elements/inspector/types";
import { parseNumberInput } from "@/features/elements/inspector/validation";
import { FieldShell } from "./primitives";

// ---------------------------------------------------------------------------
// ColorField
// ---------------------------------------------------------------------------

export interface ColorFieldProps {
  field: InspectorFieldDef;
  value: unknown;
  /** Theme palette swatches to offer. */
  palette: string[];
  error?: string | null;
  overridden?: boolean;
  onResetOverride?: () => void;
  disabled?: boolean;
  onCommit: (value: string | undefined) => void;
}

const FALLBACK_PALETTE = [
  "#ffffff",
  "#0a0a0a",
  "#737373",
  "#7c5cfc",
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
];

export function ColorField({
  field,
  value,
  palette,
  error,
  overridden,
  onResetOverride,
  disabled,
  onCommit,
}: ColorFieldProps) {
  const current = typeof value === "string" ? value : "";
  const swatches = palette.length >= 4 ? palette : FALLBACK_PALETTE;
  const isTransparent = current === "transparent" || current === "";

  // Transient preview while the native picker is open; the durable commit
  // happens when the picker closes (native `change` fires once on close).
  const { draft, setDraft } = useCommittedDraft<string>(current);

  const handlePickerChange = (hex: string) => {
    onCommit(hex);
  };

  return (
    <FieldShell
      label={field.label}
      hint={field.hint}
      error={error}
      overridden={overridden}
      onResetOverride={onResetOverride}
    >
      <div className="flex items-center gap-1.5">
        {/* Swatches */}
        <div className="flex flex-1 flex-wrap gap-1">
          {swatches.slice(0, 8).map((color, index) => {
            const active = current.toLowerCase() === color.toLowerCase();
            return (
              <button
                key={`${color}-${index}`}
                type="button"
                data-testid={`inspector-${field.id}-swatch-${color.replace("#", "")}`}
                aria-label={`Set ${field.label} to ${color}`}
                disabled={disabled}
                onClick={() => onCommit(color)}
                className={cn(
                  "h-5 w-5 rounded-md border transition-transform hover:scale-110",
                  active ? "border-accent ring-1 ring-accent" : "border-border",
                )}
                style={{ background: color }}
              />
            );
          })}
          {/* Clear / transparent */}
          <button
            type="button"
            data-testid={`inspector-${field.id}-clear`}
            title="Transparent"
            disabled={disabled}
            onClick={() => onCommit("transparent")}
            className={cn(
              "relative h-5 w-5 overflow-hidden rounded-md border transition-transform hover:scale-110",
              isTransparent ? "border-accent ring-1 ring-accent" : "border-border",
            )}
          >
            <span
              className="absolute inset-0"
              style={{
                background:
                  "repeating-conic-gradient(#2a3447 0 25%, transparent 0 50%) 50% / 6px 6px",
              }}
            />
          </button>
        </div>

        {/* Native picker */}
        <label
          className={cn(
            "relative h-7 w-10 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border",
            disabled && "cursor-not-allowed opacity-50",
          )}
          style={{
            background: isTransparent
              ? "repeating-conic-gradient(#2a3447 0 25%, transparent 0 50%) 50% / 6px 6px"
              : draft,
          }}
          title="Pick a custom color"
        >
          <span className="sr-only">{field.label}</span>
          <input
            type="color"
            data-testid={`inspector-${field.id}-picker`}
            disabled={disabled}
            value={toHexInput(current)}
            onChange={(e) => handlePickerChange(e.target.value)}
            onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
      </div>
    </FieldShell>
  );
}

/** Best-effort conversion of a stored color to a hex input value. */
function toHexInput(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [r, g, b] = trimmed.slice(1);
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^#[0-9a-fA-F]{8}$/.test(trimmed)) return trimmed.slice(0, 7).toLowerCase();
  return "#7c5cfc";
}

// ---------------------------------------------------------------------------
// SliderField — 0..100 style ranges (opacity, letter spacing)
// ---------------------------------------------------------------------------

export function SliderField({
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
  onCommit: (value: number | undefined) => void;
}) {
  const min = field.min ?? 0;
  const max = field.max ?? 100;
  const step = field.step ?? 1;

  const stored =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? (parseNumberInput(value) ?? Number(field.default ?? max))
        : Number(field.default ?? max);

  const { draft, setDraft, resetDraft, isDirtyRef } = useCommittedDraft<number>(stored);

  const commit = (next: number) => {
    isDirtyRef.current = false;
    onCommit(next);
  };

  return (
    <FieldShell
      label={field.label}
      hint={field.hint}
      error={error}
      overridden={overridden}
      onResetOverride={onResetOverride}
    >
      <div className="flex items-center gap-2">
        <input
          type="range"
          data-testid={`inspector-${field.id}`}
          min={min}
          max={max}
          step={step}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(Number(e.target.value))}
          onPointerUp={() => commit(draft)}
          onKeyUp={() => commit(draft)}
          onBlur={() => {
            if (isDirtyRef.current) commit(draft);
            else resetDraft();
          }}
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-[#7c5cfc] disabled:cursor-not-allowed disabled:opacity-50"
        />
        <span className="w-9 shrink-0 text-right font-mono text-[11px] text-text-muted">
          {Math.round(draft)}
          {field.unit ? ` ${field.unit}` : "%"}
        </span>
      </div>
    </FieldShell>
  );
}
