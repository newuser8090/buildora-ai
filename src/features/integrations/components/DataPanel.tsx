"use client";

// ---------------------------------------------------------------------------
// DataPanel (Phase P22-J) — data integrations + collection management
//
// Two responsibilities, kept minimal by design (D-J5):
//   1. Integration status + the guided "Add Supabase" flow (mock parity for
//      local dev/tests; Supabase uses the existing server-side env conventions
//      — secrets never enter the browser).
//   2. Collection management: create / rename / delete collections and
//      add / remove / rename / re-type fields. Every action routes through the
//      editor store's withHistory boundary (one undo entry each).
//
// Runtime records are refreshed from the provider whenever the durable
// collection definitions change, so bound elements resolve in the preview.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { Database, Plus, Trash2, Pencil, Check, X, Plug, ChevronDown, ChevronRight, Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/utils/cn";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { CollectionFieldType } from "@/features/elements/collections/types";
import { useDataIntegrationStore } from "../store/data-integration-store";
import { getDataIntegrationEnvironment } from "../environment";

const FIELD_TYPE_OPTIONS: Array<{ value: CollectionFieldType; label: string }> = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "image", label: "Image URL" },
  { value: "url", label: "URL" },
];

const INPUT_CLASS =
  "h-8 w-full rounded-lg border border-border bg-card/60 px-2.5 text-xs text-text-primary outline-none transition-colors placeholder:text-text-dim/50 focus:border-accent/50";
const BUTTON_CLASS =
  "flex h-8 shrink-0 items-center gap-1 rounded-lg border border-border bg-card/60 px-3 text-xs font-medium text-text-muted transition-colors hover:border-accent/40 hover:text-text-primary active:scale-95 disabled:cursor-not-allowed disabled:opacity-40";

export function DataPanel() {
  const project = useEditorStore((s) => s.project);
  const collections = useMemo(() => project.collections ?? [], [project.collections]);
  const addCollection = useEditorStore((s) => s.addCollection);
  const renameCollection = useEditorStore((s) => s.renameCollection);
  const deleteCollection = useEditorStore((s) => s.deleteCollection);
  const addCollectionField = useEditorStore((s) => s.addCollectionField);
  const removeCollectionField = useEditorStore((s) => s.removeCollectionField);
  const renameCollectionField = useEditorStore((s) => s.renameCollectionField);
  const setCollectionFieldType = useEditorStore((s) => s.setCollectionFieldType);

  const { status, kind, refreshing, connect, refreshRecords } = useDataIntegrationStore();

  // Connect once on mount (mock in dev; supabase when configured).
  useEffect(() => {
    void connect();
  }, [connect]);

  // Refresh runtime records whenever the durable collection set changes so
  // bound elements resolve immediately in the canvas preview.
  useEffect(() => {
    if (kind === "none") return;
    void refreshRecords(collections, { projectId: project.id });
  }, [kind, collections, refreshRecords, project.id]);

  const [newName, setNewName] = useState("");
  const [showSupabase, setShowSupabase] = useState(false);
  const env = useMemo(() => getDataIntegrationEnvironment(), []);

  const handleAddCollection = () => {
    const name = newName.trim();
    if (!name) return;
    const result = addCollection(name);
    if (result.ok) setNewName("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        {/* ---- Header ---- */}
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">Data</h2>
          <p className="mt-0.5 text-xs text-text-dim">
            Collections power dynamic content for your elements
          </p>
        </div>

        {/* ---- Integration status ---- */}
        <div data-testid="data-integration-status" className="border-b border-border/60 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    status.connected ? "bg-emerald-500" : "bg-text-dim/40",
                  )}
                />
                <span className="text-xs font-semibold text-text-primary">{status.label}</span>
              </div>
              {status.detail && (
                <p className="mt-1 text-[11px] leading-tight text-text-dim">{status.detail}</p>
              )}
            </div>
            {refreshing ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-text-dim" />
            ) : (
              <Plug className="h-4 w-4 shrink-0 text-text-dim/60" />
            )}
          </div>

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              data-testid="connect-mock-integration"
              onClick={() => void connect()}
              className={BUTTON_CLASS}
            >
              <Plug className="h-3.5 w-3.5" />
              Connect demo data
            </button>
            <button
              type="button"
              data-testid="add-supabase-button"
              onClick={() => setShowSupabase((v) => !v)}
              className={BUTTON_CLASS}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Add Supabase
            </button>
          </div>

          {/* ---- Minimal "Add Supabase" guided flow (D-J5) ---- */}
          {showSupabase && (
            <div data-testid="add-supabase-flow" className="mt-3 rounded-lg border border-border bg-card/40 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-dim">
                Connect Supabase
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-text-muted">
                <li>Set <code className="rounded bg-card px-1">NEXT_PUBLIC_SUPABASE_URL</code> and <code className="rounded bg-card px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in your environment.</li>
                <li>Apply the additive migration <code className="rounded bg-card px-1">supabase/migrations/20260814000001_data_records.sql</code>.</li>
                <li>Restart the app — runtime records are then stored in Supabase (secrets stay server-side).</li>
              </ol>
              <p className="mt-2 text-[11px] text-text-dim">
                {env.kind === "supabase"
                  ? "Supabase is configured and connected."
                  : env.kind === "mock"
                    ? "Currently using the local demo backend. Configure the env vars to switch to Supabase."
                    : "No data provider is configured. Static values render as authored."}
              </p>
            </div>
          )}
        </div>

        {/* ---- New collection ---- */}
        <div className="border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              data-testid="new-collection-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddCollection();
                }
              }}
              placeholder="Collection name, e.g. Products"
              maxLength={80}
              className={INPUT_CLASS}
            />
            <button
              type="button"
              data-testid="add-collection-button"
              onClick={handleAddCollection}
              disabled={newName.trim().length === 0}
              className={cn(BUTTON_CLASS, "border-accent/40 bg-accent/10 text-accent hover:border-accent/60")}
            >
              <Plus className="h-3.5 w-3.5" />
              Create
            </button>
          </div>
        </div>

        {/* ---- Collections ---- */}
        {collections.length === 0 ? (
          <div data-testid="collections-empty" className="px-4 py-10 text-center">
            <Database className="mx-auto h-6 w-6 text-text-dim/40" />
            <p className="mt-2 text-sm text-text-dim">No collections yet</p>
            <p className="mt-1 text-xs text-text-dim/60">
              Create a collection, then bind element fields to it in the inspector.
            </p>
          </div>
        ) : (
          <div className="space-y-2 p-3">
            {collections.map((collection) => (
              <CollectionCard
                key={collection.id}
                collectionId={collection.id}
                name={collection.name}
                fields={collection.fields}
                onRename={(name) => renameCollection(collection.id, name)}
                onDelete={() => deleteCollection(collection.id)}
                onAddField={(name, type) => addCollectionField(collection.id, name, type)}
                onRemoveField={(fieldId) => removeCollectionField(collection.id, fieldId)}
                onRenameField={(fieldId, name) => renameCollectionField(collection.id, fieldId, name)}
                onSetFieldType={(fieldId, type) => setCollectionFieldType(collection.id, fieldId, type)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collection card
// ---------------------------------------------------------------------------

function CollectionCard({
  collectionId,
  name,
  fields,
  onRename,
  onDelete,
  onAddField,
  onRemoveField,
  onRenameField,
  onSetFieldType,
}: {
  collectionId: string;
  name: string;
  fields: Array<{ id: string; name: string; type: CollectionFieldType }>;
  onRename: (name: string) => void;
  onDelete: () => void;
  onAddField: (name: string, type: CollectionFieldType) => void;
  onRemoveField: (fieldId: string) => void;
  onRenameField: (fieldId: string, name: string) => void;
  onSetFieldType: (fieldId: string, type: CollectionFieldType) => void;
}) {
  const [open, setOpen] = useState(true);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [draftName, setDraftName] = useState(name);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<CollectionFieldType>("text");

  const commitRename = () => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== name) onRename(trimmed);
    setEditingName(null);
    setDraftName(name);
  };

  const handleAddField = () => {
    const trimmed = newFieldName.trim();
    if (!trimmed) return;
    onAddField(trimmed, newFieldType);
    setNewFieldName("");
  };

  return (
    <div
      data-testid={`collection-card-${collectionId}`}
      className="rounded-xl border border-border bg-card/40"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "Collapse collection" : "Expand collection"}
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 rounded p-0.5 text-text-dim hover:text-text-primary"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        {editingName === collectionId ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <input
              type="text"
              data-testid={`collection-rename-input-${collectionId}`}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename();
                } else if (e.key === "Escape") {
                  setEditingName(null);
                  setDraftName(name);
                }
              }}
              autoFocus
              maxLength={80}
              className="h-7 min-w-0 flex-1 rounded-md border border-accent/40 bg-card px-2 text-xs text-text-primary outline-none"
            />
            <button type="button" data-testid={`collection-rename-ok-${collectionId}`} onClick={commitRename} className="rounded p-1 text-accent hover:bg-card">
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-testid={`collection-rename-cancel-${collectionId}`}
              onClick={() => {
                setEditingName(null);
                setDraftName(name);
              }}
              className="rounded p-1 text-text-dim hover:bg-card"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-text-primary">{name}</p>
            <p className="text-[10px] text-text-dim">{fields.length} fields</p>
          </div>
        )}

        <button
          type="button"
          data-testid={`collection-rename-${collectionId}`}
          title="Rename collection"
          onClick={() => {
            setEditingName(collectionId);
            setDraftName(name);
          }}
          className="rounded p-1.5 text-text-dim hover:bg-card hover:text-text-primary"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          data-testid={`collection-delete-${collectionId}`}
          title="Delete collection"
          onClick={onDelete}
          className="rounded p-1.5 text-text-dim hover:bg-card hover:text-red-500"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Fields */}
      {open && (
        <div className="border-t border-border/60 px-3 py-2">
          {fields.length === 0 ? (
            <p data-testid={`collection-fields-empty-${collectionId}`} className="py-1 text-[11px] text-text-dim/60">
              No fields yet — add one below.
            </p>
          ) : (
            <ul className="space-y-1">
              {fields.map((field) => (
                <FieldRow
                  key={field.id}
                  fieldId={field.id}
                  name={field.name}
                  type={field.type}
                  onRename={(n) => onRenameField(field.id, n)}
                  onRemove={() => onRemoveField(field.id)}
                  onSetType={(t) => onSetFieldType(field.id, t)}
                />
              ))}
            </ul>
          )}

          {/* Add field */}
          <div className="mt-2 flex items-center gap-1.5">
            <input
              type="text"
              data-testid={`collection-new-field-name-${collectionId}`}
              value={newFieldName}
              onChange={(e) => setNewFieldName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddField();
                }
              }}
              placeholder="Field name"
              maxLength={64}
              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-card/60 px-2 text-xs text-text-primary outline-none placeholder:text-text-dim/50 focus:border-accent/50"
            />
            <select
              data-testid={`collection-new-field-type-${collectionId}`}
              value={newFieldType}
              onChange={(e) => setNewFieldType(e.target.value as CollectionFieldType)}
              className="h-7 shrink-0 rounded-md border border-border bg-card/60 px-1.5 text-[11px] text-text-primary outline-none"
            >
              {FIELD_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              data-testid={`collection-add-field-${collectionId}`}
              onClick={handleAddField}
              disabled={newFieldName.trim().length === 0}
              className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-accent/10 px-2 text-[11px] font-medium text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="h-3 w-3" />
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field row
// ---------------------------------------------------------------------------

function FieldRow({
  fieldId,
  name,
  type,
  onRename,
  onRemove,
  onSetType,
}: {
  fieldId: string;
  name: string;
  type: CollectionFieldType;
  onRename: (name: string) => void;
  onRemove: () => void;
  onSetType: (type: CollectionFieldType) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) onRename(trimmed);
    setEditing(false);
    setDraft(name);
  };

  return (
    <li
      data-testid={`collection-field-${fieldId}`}
      className="flex items-center gap-1.5 rounded-md bg-card/30 px-2 py-1"
    >
      {editing ? (
        <input
          type="text"
          data-testid={`field-name-input-${fieldId}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              setEditing(false);
              setDraft(name);
            }
          }}
          autoFocus
          maxLength={64}
          className="h-6 min-w-0 flex-1 rounded border border-accent/40 bg-card px-1.5 text-[11px] text-text-primary outline-none"
        />
      ) : (
        <button
          type="button"
          data-testid={`field-rename-${fieldId}`}
          onClick={() => {
            setEditing(true);
            setDraft(name);
          }}
          className="min-w-0 flex-1 truncate text-left text-[11px] text-text-primary hover:text-accent"
          title="Rename field"
        >
          {name}
        </button>
      )}
      <select
        data-testid={`field-type-${fieldId}`}
        value={type}
        onChange={(e) => onSetType(e.target.value as CollectionFieldType)}
        aria-label={`Type of field ${name}`}
        className="h-6 shrink-0 rounded border border-border bg-card/60 px-1 text-[10px] text-text-muted outline-none"
      >
        {FIELD_TYPE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        data-testid={`field-remove-${fieldId}`}
        onClick={onRemove}
        title="Remove field"
        className="shrink-0 rounded p-0.5 text-text-dim hover:text-red-500"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </li>
  );
}
