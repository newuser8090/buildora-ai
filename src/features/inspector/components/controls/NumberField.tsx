"use client";

// ---------------------------------------------------------------------------
// NumberField (Phase P22-C) — keyboard entry + steppers + bounds + unit
//
// Typing is transient (local draft); the value commits on blur or Enter so a
// focused edit produces exactly ONE history entry. Steppers commit per click.
// An empty / "auto" input restores the default (deletes the value).
// ---------------------------------------------------------------------------

import { useCommittedDraft } from "@/features/inspector/hooks/useCommittedDraft";
import type { InspectorFieldDef } from "@/features/elements/inspector/types";
import { parseNumberInput } from "@/features/elements/inspector/validation";
import { FIELD_INPUT_CLASS, FieldShell, IconButton } from "./primitives";

/** Render a stored value as the initial input text. */
function displayText(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "number") return String(Math.round(value * 100) / 100);
  if (typeof value === "string") return value;
  return "";
}

export interface NumberFieldProps {
  field: InspectorFieldDef;
  value: unknown;
  error?: string | null;
  overridden?: boolean;
  onResetOverride?: () => void;
  disabled?: boolean;
  onCommit: (value: string | number | undefined) => void;
}

export function NumberField({
  field,
  value,
  error,
  overridden,
  onResetOverride,
  disabled,
  onCommit,
}: NumberFieldProps) {
  const { draft, setDraft, resetDraft, isDirtyRef } = useCommittedDraft<string>(displayText(value));
  const step = field.step ?? 1;
  const min = field.min;
  const max = field.max;
  const unit = field.unit;

  const currentNumber = parseNumberInput(draft);
  const canStep = currentNumber !== null;

  const finish = (next: string) => {
    isDirtyRef.current = false;
    const trimmed = next.trim();
    if (trimmed === "" || trimmed.toLowerCase() === "auto") {
      onCommit(undefined); // restore auto / default
      return;
    }
    const parsed = parseNumberInput(trimmed);
    onCommit(parsed !== null ? parsed : trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(draft);
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      resetDraft();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "ArrowUp" && canStep) {
      e.preventDefault();
      stepBy(+step);
    } else if (e.key === "ArrowDown" && canStep) {
      e.preventDefault();
      stepBy(-step);
    }
  };

  const stepBy = (delta: number) => {
    const current = currentNumber ?? Number(field.default ?? 0);
    const next = Math.round((current + delta) * 100) / 100;
    const clamped =
      typeof min === "number" && next < min ? min : typeof max === "number" && next > max ? max : next;
    isDirtyRef.current = false;
    onCommit(clamped);
  };

  const inputId = `inspector-${field.id}`;

  return (
    <FieldShell
      label={field.label}
      hint={field.hint}
      error={error}
      overridden={overridden}
      onResetOverride={onResetOverride}
      htmlFor={inputId}
    >
      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <input
            id={inputId}
            data-testid={`inspector-${field.id}`}
            className={FIELD_INPUT_CLASS}
            value={draft}
            placeholder={field.placeholder ?? (unit ? `Auto` : "0")}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => finish(draft)}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
          />
          {unit && (
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-text-dim/70">
              {unit}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          <IconButton label="Increase" disabled={disabled || !canStep} onClick={() => stepBy(+step)}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="m18 15-6-6-6 6" />
            </svg>
          </IconButton>
          <IconButton label="Decrease" disabled={disabled || !canStep} onClick={() => stepBy(-step)}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </IconButton>
        </div>
      </div>
    </FieldShell>
  );
}
