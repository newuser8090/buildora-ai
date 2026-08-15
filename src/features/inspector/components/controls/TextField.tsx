"use client";

// ---------------------------------------------------------------------------
// TextField (Phase P22-C) — single-line and multi-line string input.
// Typing is transient; the value commits on blur (one history entry).
// ---------------------------------------------------------------------------

import { useCommittedDraft } from "@/features/inspector/hooks/useCommittedDraft";
import type { InspectorFieldDef } from "@/features/elements/inspector/types";
import { FIELD_INPUT_CLASS, FieldShell } from "./primitives";

function displayText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export interface TextFieldProps {
  field: InspectorFieldDef;
  value: unknown;
  error?: string | null;
  overridden?: boolean;
  onResetOverride?: () => void;
  disabled?: boolean;
  onCommit: (value: string | undefined) => void;
}

export function TextField({
  field,
  value,
  error,
  overridden,
  onResetOverride,
  disabled,
  onCommit,
}: TextFieldProps) {
  const { draft, setDraft, resetDraft, isDirtyRef } = useCommittedDraft<string>(displayText(value));
  const inputId = `inspector-${field.id}`;
  const multiline = field.kind === "textarea";

  const finish = () => {
    if (!isDirtyRef.current) return;
    isDirtyRef.current = false;
    onCommit(draft);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      resetDraft();
      (e.target as HTMLInputElement).blur();
    }
  };

  const shared = {
    id: inputId,
    "data-testid": `inspector-${field.id}`,
    value: draft,
    placeholder: field.placeholder,
    disabled,
    maxLength: field.maxLength ?? 4000,
    spellCheck: false as const,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onKeyDown: handleKeyDown,
    onBlur: finish,
  };

  return (
    <FieldShell
      label={field.label}
      hint={field.hint}
      error={error}
      overridden={overridden}
      onResetOverride={onResetOverride}
      htmlFor={inputId}
    >
      {multiline ? (
        <textarea
          {...shared}
          className={`${FIELD_INPUT_CLASS} min-h-16 resize-y py-1.5 leading-relaxed`}
          rows={3}
        />
      ) : (
        <input {...shared} className={FIELD_INPUT_CLASS} autoComplete="off" />
      )}
    </FieldShell>
  );
}
