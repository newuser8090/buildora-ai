"use client";

// ---------------------------------------------------------------------------
// CustomCodeField (Phase P23-D) — the whole ElementCustomCode object editor
//
// HTML/CSS/JS plain textareas only (the attributes editor is DEFERRED — it is
// intentionally absent in P23-D). Authoring surface for the curated leaf
// content blocks only (the Custom Code inspector section is gated on
// elementSupportsCustomCode).
//
// Security/UX contract:
//   - Enabling custom code ALWAYS requires an explicit confirmation: the
//     enable action opens an inline confirmation panel carrying the persistent
//     warning — custom code runs ONLY in the published site inside a sandboxed
//     frame and never in the editor, preview, or share.
//   - The warning stays visible (persistent banner) while custom code is
//     enabled, and inside the confirmation panel.
//   - `enabled` defaults false. Typing code never enables anything — the
//     payload stays inert data until the user explicitly opts in.
//   - Per-field caps (20,000) enforced via maxLength; the aggregate cap
//     (48,000 across html+css+js) is enforced at commit with a live counter.
//   - Removing commits null (deletes customCode from the node entirely).
//   - No iframe, no srcDoc, no execution surface anywhere in this control.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Code2, ShieldAlert, Trash2 } from "lucide-react";
import { cn } from "@/utils/cn";
import { useCommittedDraft } from "@/features/inspector/hooks/useCommittedDraft";
import type { InspectorFieldDef } from "@/features/elements/inspector/types";
import type { ElementCustomCode } from "@/features/elements/types";
import {
  ELEMENT_MAX_CUSTOM_CODE_LENGTH,
  ELEMENT_MAX_CUSTOM_CODE_TOTAL,
} from "@/features/elements/schemas/element-schemas";
import { FieldShell } from "./primitives";

// ---------------------------------------------------------------------------
// The persistent warning (P23-D D3)
// ---------------------------------------------------------------------------

export const CUSTOM_CODE_WARNING =
  "Custom code runs only in the published site, inside a sandboxed frame. " +
  "It never runs in the editor, preview, or share.";

const CODE_FIELDS = [
  { key: "html", label: "HTML", placeholder: "<div>…</div>" },
  { key: "css", label: "CSS", placeholder: ".my-class { … }" },
  { key: "js", label: "JS", placeholder: "// Runs in the sandboxed frame only" },
] as const;

type CodeFieldKey = (typeof CODE_FIELDS)[number]["key"];

const TEXTAREA_CLASS =
  "w-full rounded-md border border-border bg-card/60 px-2 py-1.5 font-mono text-xs " +
  "leading-relaxed text-text-primary placeholder:text-text-dim/50 transition-colors " +
  "focus:border-accent/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

export interface CustomCodeFieldProps {
  field: InspectorFieldDef;
  value: unknown;
  disabled?: boolean;
  onCommit: (value: ElementCustomCode | null) => boolean;
}

export function CustomCodeField({
  field,
  value,
  disabled,
  onCommit,
}: CustomCodeFieldProps) {
  const code =
    value && typeof value === "object" ? (value as ElementCustomCode) : null;
  const enabled = code?.enabled === true;
  const [confirming, setConfirming] = useState(false);
  const [aggregateError, setAggregateError] = useState<string | null>(null);

  const htmlDraft = useCommittedDraft<string>(code?.html ?? "");
  const cssDraft = useCommittedDraft<string>(code?.css ?? "");
  const jsDraft = useCommittedDraft<string>(code?.js ?? "");

  const drafts: Record<CodeFieldKey, string> = {
    html: htmlDraft.draft,
    css: cssDraft.draft,
    js: jsDraft.draft,
  };

  // Live counters — the aggregate reflects the CURRENT drafts (what the user
  // is looking at), so an over-limit state is visible before commit.
  const draftTotal =
    drafts.html.length + drafts.css.length + drafts.js.length;
  const totalOver = draftTotal > ELEMENT_MAX_CUSTOM_CODE_TOTAL;

  const commit = (next: ElementCustomCode | null): boolean => {
    const ok = onCommit(next);
    if (ok) setAggregateError(null);
    return ok;
  };

  // ---- Enable flow (explicit confirmation) ----
  const requestEnable = () => {
    setAggregateError(null);
    setConfirming(true);
  };

  const confirmEnable = () => {
    const ok = commit({ ...(code ?? {}), enabled: true });
    if (ok) setConfirming(false);
  };

  const cancelEnable = () => setConfirming(false);

  // ---- Field edits (blur commit, one history entry per field) ----
  const finishField = (key: CodeFieldKey) => {
    const draft = drafts[key];
    const otherTotal = (CODE_FIELDS as readonly { key: CodeFieldKey }[])
      .filter((f) => f.key !== key)
      .reduce((sum, f) => sum + (code?.[f.key]?.length ?? 0), 0);
    if (otherTotal + draft.length > ELEMENT_MAX_CUSTOM_CODE_TOTAL) {
      setAggregateError(
        `Total code exceeds the ${ELEMENT_MAX_CUSTOM_CODE_TOTAL.toLocaleString()} character limit.`,
      );
      return;
    }
    commit({ ...(code ?? {}), [key]: draft });
  };

  const resetField = (key: CodeFieldKey) => {
    if (key === "html") htmlDraft.resetDraft();
    if (key === "css") cssDraft.resetDraft();
    if (key === "js") jsDraft.resetDraft();
  };

  const handleKeyDown =
    (key: CodeFieldKey) =>
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        resetField(key);
        (e.target as HTMLTextAreaElement).blur();
      }
    };

  // ---- Shared warning banner ----
  const warning = (
    <div
      data-testid="custom-code-warning"
      className="mb-2 flex items-start gap-1.5 rounded-md border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-[11px] leading-snug text-amber-300"
    >
      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{CUSTOM_CODE_WARNING}</span>
    </div>
  );

  const codeAreas = code !== null && (
    <div data-testid="custom-code-editor" className="space-y-2">
      {enabled && warning}
      {CODE_FIELDS.map(({ key, label, placeholder }) => {
        const draft = drafts[key];
        return (
          <div key={key}>
            <label className="mb-1 flex items-center justify-between gap-2 text-[11px] text-text-muted">
              <span className="font-medium uppercase tracking-wider">{label}</span>
              <span
                data-testid={`custom-code-count-${key}`}
                className={cn(
                  "font-mono text-[10px]",
                  draft.length > ELEMENT_MAX_CUSTOM_CODE_LENGTH
                    ? "text-red-400"
                    : "text-text-dim/60",
                )}
              >
                {draft.length.toLocaleString()} /{" "}
                {ELEMENT_MAX_CUSTOM_CODE_LENGTH.toLocaleString()}
              </span>
            </label>
            <textarea
              data-testid={`custom-code-${key}`}
              value={draft}
              placeholder={placeholder}
              disabled={disabled}
              spellCheck={false}
              maxLength={ELEMENT_MAX_CUSTOM_CODE_LENGTH}
              rows={key === "html" ? 3 : 4}
              onChange={(e) => {
                if (key === "html") htmlDraft.setDraft(e.target.value);
                if (key === "css") cssDraft.setDraft(e.target.value);
                if (key === "js") jsDraft.setDraft(e.target.value);
                setAggregateError(null);
              }}
              onKeyDown={handleKeyDown(key)}
              onBlur={() => finishField(key)}
              className={TEXTAREA_CLASS}
            />
          </div>
        );
      })}

      <div className="flex items-center justify-between gap-2">
        <span
          data-testid="custom-code-total"
          className={cn(
            "font-mono text-[10px]",
            totalOver ? "text-red-400" : "text-text-dim/60",
          )}
        >
          Total {draftTotal.toLocaleString()} / {ELEMENT_MAX_CUSTOM_CODE_TOTAL.toLocaleString()}
        </span>
        <div className="flex items-center gap-1.5">
          {enabled ? (
            <button
              type="button"
              data-testid="custom-code-disable"
              disabled={disabled}
              onClick={() => commit({ ...code, enabled: false })}
              className="flex h-7 items-center gap-1 rounded-md border border-border bg-card/40 px-2 text-[11px] font-medium text-text-muted transition-colors hover:border-amber-400/40 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Disable
            </button>
          ) : (
            <button
              type="button"
              data-testid="custom-code-enable"
              disabled={disabled}
              onClick={requestEnable}
              className="flex h-7 items-center gap-1 rounded-md border border-border bg-card/40 px-2 text-[11px] font-medium text-text-muted transition-colors hover:border-accent/40 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Code2 className="h-3 w-3" />
              Enable custom code
            </button>
          )}
          <button
            type="button"
            data-testid="custom-code-remove"
            disabled={disabled}
            onClick={() => commit(null)}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-text-muted transition-colors hover:bg-card hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-3 w-3" />
            Remove
          </button>
        </div>
      </div>

      {aggregateError && (
        <p
          data-testid="custom-code-error"
          className="text-[11px] leading-tight text-red-400"
        >
          {aggregateError}
        </p>
      )}
    </div>
  );

  // ---- Confirmation panel (first enable / any disabled → enabled transition) ----
  const confirmPanel = confirming && (
    <div data-testid="custom-code-confirm" className="space-y-2">
      {warning}
      <p className="text-[11px] leading-snug text-text-dim">
        Code you write here will run for visitors of the published site. It is
        sandboxed, but you are responsible for what it does. Editor, preview,
        and share views always show a placeholder instead.
      </p>
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          data-testid="custom-code-confirm-cancel"
          onClick={cancelEnable}
          className="flex h-7 items-center rounded-md border border-border bg-card/40 px-2 text-[11px] font-medium text-text-muted transition-colors hover:border-accent/40 hover:text-text-primary"
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="custom-code-confirm-enable"
          onClick={confirmEnable}
          className="flex h-7 items-center rounded-md bg-accent px-2 text-[11px] font-medium text-white transition-colors hover:bg-accent-hover"
        >
          I understand — enable
        </button>
      </div>
    </div>
  );

  return (
    <FieldShell label={field.label} hint={field.hint}>
      {codeAreas}
      {confirmPanel}
      {code === null && !confirming && (
        <button
          type="button"
          data-testid="custom-code-add"
          disabled={disabled}
          onClick={requestEnable}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-card/40 text-xs font-medium text-text-muted transition-colors hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Code2 className="h-3.5 w-3.5" />
          Add custom code
        </button>
      )}
    </FieldShell>
  );
}
