"use client";

// ---------------------------------------------------------------------------
// BindingField (Phase P22-J) — the whole ElementBinding object editor
//
// Source / Collection / Field / Path, all bounded by the shared
// ElementBindingSchema. Every discrete interaction commits a COMPLETE
// validated binding through the field path (one atomic history entry);
// choosing "Not bound" clears the property (commits null).
//
// Only the "collection" source is authorable today (D-J6: form writes and the
// other binding sources remain future capabilities).
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Database, Link2, Trash2 } from "lucide-react";
import { cn } from "@/utils/cn";
import type { InspectorFieldDef } from "@/features/elements/inspector/types";
import type { Collection } from "@/features/elements/collections/types";
import type { ElementBinding } from "@/features/elements/binding/types";
import type { ElementNode } from "@/features/elements/types";
import { FieldShell } from "./primitives";

const SELECT_CLASS =
  "h-7 w-full rounded-md border border-border bg-card/60 px-2 text-xs text-text-primary " +
  "transition-colors focus:border-accent/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

/** Fallback candidate element props when the node has none yet. */
const FALLBACK_FIELD_OPTIONS = [
  "text",
  "src",
  "alt",
  "href",
  "price",
  "label",
  "logoText",
  "name",
];

function candidateFields(node: ElementNode | undefined): string[] {
  const fromProps = node?.props ? Object.keys(node.props) : [];
  const merged = [...fromProps, ...FALLBACK_FIELD_OPTIONS];
  return Array.from(new Set(merged)).sort();
}

export function BindingField({
  field,
  value,
  node,
  collections,
  disabled,
  onCommit,
}: {
  field: InspectorFieldDef;
  value: unknown;
  node?: ElementNode;
  collections: Collection[];
  disabled?: boolean;
  onCommit: (value: ElementBinding | null) => boolean;
}) {
  const binding =
    value && typeof value === "object" ? (value as ElementBinding) : null;
  const [pathDraft, setPathDraft] = useState(binding?.path ?? "");
  const [pathFocused, setPathFocused] = useState(false);

  const fields = candidateFields(node);
  const collectionMissing =
    !!binding?.collectionId && !collections.some((c) => c.id === binding.collectionId);

  const commit = (next: ElementBinding | null) => {
    const ok = onCommit(next);
    if (ok && next) setPathDraft(next.path ?? "");
    return ok;
  };

  const finishPath = () => {
    if (!binding) return;
    const trimmed = pathDraft.trim();
    const next = { ...binding, path: trimmed };
    commit(next);
    setPathDraft(trimmed);
  };

  const statusText = !binding
    ? null
    : collections.length === 0
      ? "Create a collection in the Data tab first."
      : collectionMissing
        ? "This collection no longer exists."
        : !binding.path
          ? "Add a path to resolve values (e.g. price or product.name)."
          : !binding.field
            ? "Choose which element field receives the value."
            : `Bound to ${collections.find((c) => c.id === binding.collectionId)?.name ?? binding.collectionId}.`;

  const statusBroken =
    !!binding && (collections.length === 0 || collectionMissing || !binding.path || !binding.field);

  return (
    <FieldShell label={field.label} hint={field.hint}>
      {!binding ? (
        <button
          type="button"
          data-testid="binding-add"
          disabled={disabled || collections.length === 0}
          onClick={() => {
            const first = collections[0];
            if (!first) return;
            commit({
              source: "collection",
              collectionId: first.id,
              path: "",
              field: fields[0] ?? "text",
            });
          }}
          className={cn(
            "flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-card/40 text-xs font-medium text-text-muted transition-colors",
            "hover:border-accent/50 hover:text-accent",
            (disabled || collections.length === 0) && "cursor-not-allowed opacity-50",
          )}
        >
          <Link2 className="h-3.5 w-3.5" />
          Bind to a collection
        </button>
      ) : (
        <div data-testid="binding-editor" className="space-y-2">
          {/* Source (fixed to collection in this scope) */}
          <label className="flex items-center gap-2 text-[11px] text-text-muted">
            <span className="w-14 shrink-0">Source</span>
            <select
              value="collection"
              disabled
              data-testid="binding-source"
              className={SELECT_CLASS}
            >
              <option value="collection">Collection</option>
            </select>
          </label>

          {/* Collection */}
          <label className="flex items-center gap-2 text-[11px] text-text-muted">
            <span className="w-14 shrink-0">Collection</span>
            <select
              value={binding.collectionId ?? ""}
              disabled={disabled || collections.length === 0}
              data-testid="binding-collection"
              onChange={(e) =>
                commit({ ...binding, collectionId: e.target.value || undefined })
              }
              className={cn(SELECT_CLASS, collectionMissing && "border-red-400/60 text-red-500")}
            >
              {collections.length === 0 && (
                <option value="">No collections</option>
              )}
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name}
                </option>
              ))}
            </select>
          </label>

          {/* Element field */}
          <label className="flex items-center gap-2 text-[11px] text-text-muted">
            <span className="w-14 shrink-0">Field</span>
            <select
              value={binding.field ?? ""}
              disabled={disabled}
              data-testid="binding-field"
              onChange={(e) => commit({ ...binding, field: e.target.value || undefined })}
              className={SELECT_CLASS}
            >
              <option value="">— choose —</option>
              {fields.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>

          {/* Record path */}
          <label className="flex items-center gap-2 text-[11px] text-text-muted">
            <span className="w-14 shrink-0">Path</span>
            <input
              type="text"
              value={pathFocused ? pathDraft : (binding.path ?? "")}
              data-testid="binding-path"
              disabled={disabled}
              maxLength={512}
              placeholder="e.g. price"
              onChange={(e) => setPathDraft(e.target.value)}
              onFocus={() => {
                setPathFocused(true);
                setPathDraft(binding.path ?? "");
              }}
              onBlur={() => {
                setPathFocused(false);
                finishPath();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  finishPath();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className={cn(
                "h-7 min-w-0 flex-1 rounded-md border border-border bg-card/60 px-2 text-xs text-text-primary outline-none transition-colors focus:border-accent/60",
              )}
            />
          </label>
          <p className="text-[10px] text-text-dim/70">
            Nested paths supported: <code className="rounded bg-card px-1">product.name</code> or{" "}
            <code className="rounded bg-card px-1">images[0].src</code>
          </p>

          {/* Status */}
          {statusText && (
            <p
              data-testid="binding-status"
              className={cn(
                "flex items-center gap-1 text-[11px] leading-tight",
                statusBroken ? "text-red-400" : "text-text-dim",
              )}
            >
              <Database className="h-3 w-3 shrink-0" />
              {statusText}
            </p>
          )}

          {/* Remove */}
          <button
            type="button"
            data-testid="binding-remove"
            disabled={disabled}
            onClick={() => {
              setPathDraft("");
              commit(null);
            }}
            className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-text-muted transition-colors hover:bg-card hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-3 w-3" />
            Remove binding
          </button>
        </div>
      )}
    </FieldShell>
  );
}
