"use client";

// ---------------------------------------------------------------------------
// CustomCodeField (Phase P23-D + P23-F) — the whole ElementCustomCode editor
//
// HTML/CSS/JS plain textareas (P23-D) plus a safe, explicit "Attributes"
// authoring section (P23-F). Authoring surface for the curated leaf content
// blocks only (the Custom Code inspector section is gated on
// elementSupportsCustomCode).
//
// Security/UX contract:
//   - Enabling custom code ALWAYS requires an explicit confirmation: the
//     enable action opens an inline confirmation panel carrying the persistent
//     warning — custom code runs ONLY inside a sandboxed frame (the P23-J
//     authoring preview and the published site) and never in the editor
//     canvas, visitor preview, or share.
//   - The warning stays visible (persistent banner) while custom code is
//     enabled, and inside the confirmation panel.
//   - `enabled` defaults false. Typing code never enables anything — the
//     payload stays inert data until the user explicitly opts in.
//   - Per-field caps (20,000) enforced via maxLength; the aggregate cap
//     (48,000 across html+css+js) is enforced at commit with a live counter.
//   - Attributes (P23-F): add/edit/remove safe HTML attributes (id, title,
//     class, aria-*, data-*, target, rel, …). Event handlers ("on*"),
//     reserved shell attributes (style/srcdoc), malformed names, and
//     javascript: URL values are rejected per-row before commit; the shared
//     ElementCustomCodeSchema re-validates at the mutation boundary (defense
//     in depth).
//   - Removing commits null (deletes customCode from the node entirely).
//   - The control itself is inert. The P23-J Preview section (opt-in, shown
//     only for enabled code) mounts the SAME sandboxed iframe the published
//     site uses — the editor document never executes custom code.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { Code2, Eye, Plus, ShieldAlert, Trash2, X } from "lucide-react";
import { cn } from "@/utils/cn";
import { useCommittedDraft } from "@/features/inspector/hooks/useCommittedDraft";
import type { InspectorFieldDef } from "@/features/elements/inspector/types";
import type { ElementCustomCode } from "@/features/elements/types";
import {
  ELEMENT_MAX_ATTRIBUTES,
  ELEMENT_MAX_CUSTOM_CODE_LENGTH,
  ELEMENT_MAX_CUSTOM_CODE_TOTAL,
} from "@/features/elements/schemas/element-schemas";
import {
  MAX_ATTRIBUTE_NAME_LENGTH,
  MAX_ATTRIBUTE_VALUE_LENGTH,
  attributeNameProblem,
  attributeValueProblem,
  normalizeAttributeName,
} from "@/features/elements/custom-code/attribute-validation";
import { ChevronIcon, FieldShell } from "./primitives";
import { CustomCodePreview } from "./CustomCodePreview";

// ---------------------------------------------------------------------------
// The persistent warning (P23-D D3)
// ---------------------------------------------------------------------------

export const CUSTOM_CODE_WARNING =
  "Custom code runs only inside a sandboxed frame — in this preview and the " +
  "published site. It never runs in the editor canvas, visitor preview, or share.";

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

// ---------------------------------------------------------------------------
// P23-F — custom attribute rows
//
// The attributes editor is a list of (name, value) rows committed through the
// same whole-object path as the code fields. Rows are local draft state; only
// blur commits (one history entry per row interaction). Each row maps to one
// key of code.attributes by its committed name.
// ---------------------------------------------------------------------------

interface AttributeRow {
  /** Stable client-side id (React keys — attribute names may be empty). */
  uid: string;
  /** Last committed attribute name (empty = pending, not yet saved). */
  committedName: string;
  /** Live draft name shown in the input. */
  name: string;
  /** Live draft value shown in the input. */
  value: string;
  error: string | null;
  /** True while the user is editing — blocks external re-sync. */
  dirty: boolean;
}

const EMPTY_ATTRIBUTES: Record<string, string> = {};

let attributeUidCounter = 0;
function nextAttributeUid(): string {
  attributeUidCounter += 1;
  return `attr-${Date.now().toString(36)}-${attributeUidCounter}`;
}

function rowsFromAttributes(attributes: Record<string, string>): AttributeRow[] {
  return Object.entries(attributes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => ({
      uid: nextAttributeUid(),
      committedName: name,
      name,
      value,
      error: null,
      dirty: false,
    }));
}

/**
 * Merge the current external attributes into the local rows. Rows the user is
 * actively editing (dirty) are never clobbered; attributes removed externally
 * (undo / collab) drop their rows; new external attributes append. Returns the
 * SAME array reference when nothing changed so React can bail out of re-renders.
 */
function mergeAttributeRows(
  prev: AttributeRow[],
  external: Record<string, string>,
): AttributeRow[] {
  const remaining = new Map(Object.entries(external));
  let changed = false;
  const merged: AttributeRow[] = [];

  for (const row of prev) {
    if (row.committedName === "") {
      merged.push(row); // pending local row — untouched
      continue;
    }
    const externalValue = remaining.get(row.committedName);
    if (externalValue === undefined) {
      // Attribute removed externally — drop the row unless mid-edit.
      if (!row.dirty) changed = true;
      else merged.push(row);
      continue;
    }
    remaining.delete(row.committedName);
    if (!row.dirty && (row.name !== row.committedName || row.value !== externalValue)) {
      changed = true;
      merged.push({ ...row, name: row.committedName, value: externalValue, error: null });
      continue;
    }
    merged.push(row);
  }

  for (const [name, value] of remaining) {
    changed = true;
    merged.push({
      uid: nextAttributeUid(),
      committedName: name,
      name,
      value,
      error: null,
      dirty: false,
    });
  }

  return changed ? merged : prev;
}

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
  // P23-J — opt-in sandboxed authoring preview (mounted only while expanded).
  const [previewOpen, setPreviewOpen] = useState(false);

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

  // ---- P23-F — attribute rows (local draft list committed on blur) ----
  const attributes = useMemo(
    () => (code?.attributes ? code.attributes : EMPTY_ATTRIBUTES),
    [code],
  );

  const [attributeRows, setAttributeRows] = useState<AttributeRow[]>(() =>
    rowsFromAttributes(attributes),
  );

  // Re-sync committed rows when the external attributes change (undo / collab).
  // The ref guard keeps the setState conditional — rows the user is mid-editing
  // (dirty) are never clobbered (mergeAttributeRows), and unchanged refs are
  // skipped entirely so no cascading render happens.
  const lastAttributesRef = useRef(attributes);
  useEffect(() => {
    if (lastAttributesRef.current === attributes) return;
    lastAttributesRef.current = attributes;
    setAttributeRows((prev) => mergeAttributeRows(prev, attributes));
  }, [attributes]);

  const patchAttributeRow = (uid: string, patch: Partial<AttributeRow>) => {
    setAttributeRows((prev) =>
      prev.map((row) => (row.uid === uid ? { ...row, ...patch } : row)),
    );
  };

  /** Commit a new attributes record through the whole-object field path. */
  const commitAttributes = (next: Record<string, string>): boolean => {
    const payload: ElementCustomCode = { ...(code ?? {}) };
    if (Object.keys(next).length === 0) delete payload.attributes;
    else payload.attributes = next;
    return commit(payload);
  };

  const addAttributeRow = () => {
    if (attributeRows.length >= ELEMENT_MAX_ATTRIBUTES) return;
    if (attributeRows.some((row) => row.committedName === "")) return; // one pending row at a time
    setAttributeRows((prev) => [
      ...prev,
      {
        uid: nextAttributeUid(),
        committedName: "",
        name: "",
        value: "",
        error: null,
        dirty: false,
      },
    ]);
  };

  const removeAttributeRow = (row: AttributeRow) => {
    if (row.committedName === "") {
      setAttributeRows((prev) => prev.filter((r) => r.uid !== row.uid));
      return;
    }
    const next = { ...attributes };
    delete next[row.committedName];
    const ok = commitAttributes(next);
    if (ok) {
      setAttributeRows((prev) => prev.filter((r) => r.uid !== row.uid));
    }
  };

  const finishAttributeName = (row: AttributeRow) => {
    const normalized = normalizeAttributeName(row.name);
    if (normalized === null) {
      patchAttributeRow(row.uid, {
        error: "Enter a valid attribute name (letters, digits, - _ :).",
      });
      return;
    }
    const nameProblem = attributeNameProblem(normalized);
    if (nameProblem) {
      patchAttributeRow(row.uid, { error: nameProblem });
      return;
    }
    if (normalized !== row.committedName) {
      const duplicate = attributeRows.some(
        (other) =>
          other.uid !== row.uid &&
          other.committedName !== "" &&
          other.committedName === normalized,
      );
      if (duplicate) {
        patchAttributeRow(row.uid, { error: "This attribute already exists." });
        return;
      }
    }
    const valueProblem = attributeValueProblem(normalized, row.value);
    if (valueProblem) {
      patchAttributeRow(row.uid, { error: valueProblem });
      return;
    }
    const next = { ...attributes };
    if (row.committedName !== "") delete next[row.committedName];
    next[normalized] = row.value;
    const ok = commitAttributes(next);
    if (ok) {
      patchAttributeRow(row.uid, {
        name: normalized,
        committedName: normalized,
        error: null,
        dirty: false,
      });
    }
  };

  const finishAttributeValue = (row: AttributeRow) => {
    const name =
      row.committedName !== ""
        ? row.committedName
        : normalizeAttributeName(row.name);
    if (name === null) {
      patchAttributeRow(row.uid, { error: "Enter an attribute name first." });
      return;
    }
    const valueProblem = attributeValueProblem(name, row.value);
    if (valueProblem) {
      patchAttributeRow(row.uid, { error: valueProblem });
      return;
    }
    const ok = commitAttributes({ ...attributes, [name]: row.value });
    if (ok) {
      patchAttributeRow(row.uid, { error: null, dirty: false });
    }
  };

  const resetAttributeRow = (row: AttributeRow) => {
    const committedValue =
      row.committedName !== "" ? (attributes[row.committedName] ?? "") : "";
    patchAttributeRow(row.uid, {
      name: row.committedName,
      value: committedValue,
      error: null,
      dirty: false,
    });
  };

  const handleAttributeKeyDown =
    (row: AttributeRow) =>
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        (e.target as HTMLInputElement).blur();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        resetAttributeRow(row);
        (e.target as HTMLInputElement).blur();
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

      {/* P23-F — Attributes authoring (safe names/values only) */}
      <div data-testid="custom-code-attributes" className="border-t border-border/60 pt-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
            Attributes
          </span>
          <span
            data-testid="custom-code-attr-count"
            className="font-mono text-[10px] text-text-dim/60"
          >
            {Object.keys(attributes).length} / {ELEMENT_MAX_ATTRIBUTES}
          </span>
        </div>
        <p className="mb-2 text-[10px] leading-snug text-text-dim/70">
          Safe HTML attributes (id, class, aria-*, data-*, …). Event handlers
          and javascript: URLs are not allowed.
        </p>
        {attributeRows.length === 0 ? (
          <p
            data-testid="custom-code-attributes-empty"
            className="mb-2 rounded-md border border-dashed border-border/70 px-2 py-1.5 text-[11px] text-text-dim/70"
          >
            No attributes yet.
          </p>
        ) : (
          <div className="space-y-1.5">
            {attributeRows.map((row, index) => (
              <div
                key={row.uid}
                data-testid="custom-code-attr-row"
                className="flex items-start gap-1.5"
              >
                <div className="min-w-0 flex-1">
                  <input
                    type="text"
                    data-testid={`custom-code-attr-name-${index}`}
                    value={row.name}
                    placeholder="name"
                    disabled={disabled}
                    maxLength={MAX_ATTRIBUTE_NAME_LENGTH}
                    spellCheck={false}
                    onChange={(e) =>
                      patchAttributeRow(row.uid, { name: e.target.value, dirty: true })
                    }
                    onBlur={() => finishAttributeName(row)}
                    onKeyDown={handleAttributeKeyDown(row)}
                    className={cn(
                      "h-7 w-full rounded-md border border-border bg-card/60 px-2 font-mono text-xs text-text-primary placeholder:text-text-dim/50 transition-colors focus:border-accent/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50",
                      row.error && "border-red-400/60",
                    )}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <input
                    type="text"
                    data-testid={`custom-code-attr-value-${index}`}
                    value={row.value}
                    placeholder="value"
                    disabled={disabled}
                    maxLength={MAX_ATTRIBUTE_VALUE_LENGTH}
                    spellCheck={false}
                    onChange={(e) =>
                      patchAttributeRow(row.uid, { value: e.target.value, dirty: true })
                    }
                    onBlur={() => finishAttributeValue(row)}
                    onKeyDown={handleAttributeKeyDown(row)}
                    className={cn(
                      "h-7 w-full rounded-md border border-border bg-card/60 px-2 font-mono text-xs text-text-primary placeholder:text-text-dim/50 transition-colors focus:border-accent/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50",
                      row.error && "border-red-400/60",
                    )}
                  />
                </div>
                <button
                  type="button"
                  data-testid={`custom-code-attr-remove-${index}`}
                  disabled={disabled}
                  onClick={() => removeAttributeRow(row)}
                  aria-label={`Remove attribute ${row.committedName || "pending"}`}
                  title="Remove attribute"
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-card/40 text-text-muted transition-colors hover:border-red-400/40 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {attributeRows.some((row) => row.error) && (
          <p
            data-testid="custom-code-attr-error"
            className="mt-1 text-[11px] leading-tight text-red-400"
          >
            {attributeRows.find((row) => row.error)?.error}
          </p>
        )}
        <button
          type="button"
          data-testid="custom-code-attr-add"
          disabled={
            disabled ||
            attributeRows.length >= ELEMENT_MAX_ATTRIBUTES ||
            attributeRows.some((row) => row.committedName === "")
          }
          onClick={addAttributeRow}
          className="mt-1.5 flex h-7 items-center justify-center gap-1 rounded-md border border-dashed border-border bg-card/40 px-2 text-[11px] font-medium text-text-muted transition-colors hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3 w-3" />
          Add attribute
        </button>
      </div>

      {/* P23-J — safe authoring preview (sandboxed frame, opt-in, enabled only) */}
      {enabled && (
        <div className="border-t border-border/60 pt-2">
          <button
            type="button"
            data-testid="custom-code-preview-toggle"
            aria-expanded={previewOpen}
            aria-controls="custom-code-preview-panel"
            onClick={() => setPreviewOpen((open) => !open)}
            className="flex h-7 w-full items-center justify-between gap-2 rounded-md border border-border bg-card/40 px-2 text-[11px] font-medium text-text-muted transition-colors hover:border-accent/50 hover:text-text-primary"
          >
            <span className="flex items-center gap-1.5">
              <Eye className="h-3 w-3" />
              Preview
            </span>
            <ChevronIcon
              className={cn(
                "h-3 w-3 transition-transform",
                previewOpen && "rotate-180",
              )}
            />
          </button>
          {previewOpen && (
            <div id="custom-code-preview-panel" className="mt-2">
              <CustomCodePreview code={code} />
            </div>
          )}
        </div>
      )}

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
        sandboxed, but you are responsible for what it does. The editor canvas,
        visitor preview, and share views always show a placeholder; the Preview
        toggle here runs your code inside the same sandboxed frame the
        published site uses.
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
