"use client";

// ---------------------------------------------------------------------------
// Inspector control primitives (Phase P22-C) — shared shells and atoms
// ---------------------------------------------------------------------------

import { cn } from "@/utils/cn";

export const FIELD_INPUT_CLASS =
  "h-7 w-full rounded-md border border-border bg-card/60 px-2 text-xs text-text-primary " +
  "placeholder:text-text-dim/50 transition-colors focus:border-accent/60 focus:outline-none " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export const FIELD_BUTTON_CLASS =
  "inline-flex h-7 items-center justify-center gap-1 rounded-md border border-border " +
  "bg-card/40 px-2.5 text-xs font-medium text-text-muted transition-colors " +
  "hover:border-accent/40 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40";

export interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string | null;
  /** Override badge (responsive-capable fields at tablet/mobile). */
  overridden?: boolean;
  onResetOverride?: () => void;
  children: React.ReactNode;
  htmlFor?: string;
}

/** Label row + control + hint/error + optional responsive override badge. */
export function FieldShell({
  label,
  hint,
  error,
  overridden,
  onResetOverride,
  children,
  htmlFor,
}: FieldShellProps) {
  return (
    <div className="px-5 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label
          htmlFor={htmlFor}
          className="truncate text-[11px] font-medium uppercase tracking-wider text-text-muted"
        >
          {label}
        </label>
        {overridden && onResetOverride && (
          <button
            type="button"
            data-testid="inspector-reset-override"
            onClick={onResetOverride}
            title="Reset override to the desktop value"
            className="inline-flex h-4 shrink-0 items-center gap-1 rounded-full bg-accent/20 px-1.5 text-[10px] font-medium text-accent-hover transition-colors hover:bg-accent/30"
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            override
          </button>
        )}
      </div>
      {children}
      {error ? (
        <p data-testid="inspector-field-error" className="mt-1 text-[11px] leading-tight text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-[11px] leading-tight text-text-dim/70">{hint}</p>
      ) : null}
    </div>
  );
}

/** Small icon button (steppers, resets). */
export function IconButton({
  label,
  onClick,
  disabled,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-card/40 text-text-muted transition-colors",
        "hover:border-accent/40 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Chevron icons used by steppers / accordions. */
export function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      className={className}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
