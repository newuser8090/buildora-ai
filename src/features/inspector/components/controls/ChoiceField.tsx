"use client";

// ---------------------------------------------------------------------------
// Choice controls (Phase P22-C) — select / segmented / toggle / alignment /
// font-family. Discrete interactions commit immediately (one entry each).
// ---------------------------------------------------------------------------

import { cn } from "@/utils/cn";
import type { InspectorFieldDef } from "@/features/elements/inspector/types";
import { FONT_FAMILY_OPTIONS } from "@/features/elements/inspector/fields";
import { FieldShell, FIELD_INPUT_CLASS } from "./primitives";

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

export function SelectField({
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
        className={`${FIELD_INPUT_CLASS} cursor-pointer appearance-none`}
        value={current}
        disabled={disabled}
        onChange={(e) => onCommit(e.target.value)}
      >
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

// ---------------------------------------------------------------------------
// Segmented
// ---------------------------------------------------------------------------

export function SegmentedField({
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
  const current = String(value ?? field.default ?? "");
  return (
    <FieldShell
      label={field.label}
      hint={field.hint}
      error={error}
      overridden={overridden}
      onResetOverride={onResetOverride}
    >
      <div role="radiogroup" aria-label={field.label} className="flex flex-wrap gap-1">
        {(field.options ?? []).map((option) => {
          const active = current === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`inspector-${field.id}-${option.value}`}
              disabled={disabled}
              onClick={() => !active && onCommit(option.value)}
              className={cn(
                "h-7 rounded-md px-2.5 text-xs font-medium transition-colors",
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
    </FieldShell>
  );
}

// ---------------------------------------------------------------------------
// Toggle (switch)
// ---------------------------------------------------------------------------

export function ToggleField({
  field,
  checked,
  error,
  disabled,
  onCommit,
}: {
  field: InspectorFieldDef;
  checked: boolean;
  error?: string | null;
  disabled?: boolean;
  onCommit: (checked: boolean) => void;
}) {
  const inputId = `inspector-${field.id}`;
  return (
    <FieldShell label={field.label} hint={field.hint} error={error} htmlFor={inputId}>
      <button
        type="button"
        id={inputId}
        role="switch"
        aria-checked={checked}
        data-testid={`inspector-${field.id}`}
        disabled={disabled}
        onClick={() => onCommit(!checked)}
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
    </FieldShell>
  );
}

// ---------------------------------------------------------------------------
// Alignment buttons
// ---------------------------------------------------------------------------

const ALIGN_ICONS: Record<string, React.ReactNode> = {
  left: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M3 6h18M3 12h12M3 18h18" />
    </svg>
  ),
  center: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M3 6h18M6 12h12M3 18h18" />
    </svg>
  ),
  right: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M3 6h18M9 12h12M3 18h18" />
    </svg>
  ),
  justify: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  ),
};

export function AlignmentField({
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
  const current = String(value ?? field.default ?? "left");
  return (
    <FieldShell
      label={field.label}
      hint={field.hint}
      error={error}
      overridden={overridden}
      onResetOverride={onResetOverride}
    >
      <div role="radiogroup" aria-label={field.label} className="flex gap-1">
        {(field.options ?? []).map((option) => {
          const active = current === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              title={option.label}
              data-testid={`inspector-${field.id}-${option.value}`}
              disabled={disabled}
              onClick={() => !active && onCommit(option.value)}
              className={cn(
                "flex h-7 w-8 items-center justify-center rounded-md transition-colors",
                active
                  ? "bg-accent text-white"
                  : "border border-border bg-card/40 text-text-muted hover:border-accent/40 hover:text-text-primary",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              {ALIGN_ICONS[option.value] ?? option.label}
            </button>
          );
        })}
      </div>
    </FieldShell>
  );
}

// ---------------------------------------------------------------------------
// Font family (curated list, styled preview)
// ---------------------------------------------------------------------------

export function FontFamilyField({
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
  const options = field.options?.length ? field.options : [...FONT_FAMILY_OPTIONS];
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
