"use client";

import { useState } from "react";
import { SlidersHorizontal, Save } from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useBlockForest } from "@/features/blocks/hooks/useBlockForest";
import { useBlockOperations } from "@/features/blocks/hooks/useBlockOperations";
import { useBlockEditorStore } from "@/features/blocks/store/block-editor-store";
import { blockRegistry } from "@/features/blocks/registry/block-registry";
import { allPresets } from "@/features/blocks/engine/block-operations";
import { BlockIcon } from "./BlockIcon";
import {
  bindingOf,
  blockDisplayLabel,
  MAX_BOUND_TEXT,
} from "@/features/blocks/adapters/section-block-adapter";
import type { BlockPreset, BlockType } from "../types";

// Which preset kind applies to a block type.
function presetKindFor(type: BlockType): "button" | "image" | "card" | null {
  if (type === "button") return "button";
  if (type === "image") return "image";
  if (["card", "pricing-card", "feature-card", "review-card", "team-member"].includes(type)) {
    return "card";
  }
  return null;
}

export function BlockInspector() {
  const selectedPageId = useEditorStore((s) => s.selectedPageId);
  const forest = useBlockForest(selectedPageId);
  const ops = useBlockOperations(selectedPageId);
  const selectedBlockId = useBlockEditorStore((s) => s.selectedBlockId);
  const lastError = useBlockEditorStore((s) => s.lastError);
  const lastWarnings = useBlockEditorStore((s) => s.lastWarnings);

  const node = selectedBlockId ? forest.nodes[selectedBlockId] : undefined;
  if (!node) {
    return (
      <div data-testid="block-inspector-empty" className="px-4 py-6 text-center">
        <p className="text-xs text-text-dim/60">
          Select a block in the build tree above to edit its content.
        </p>
      </div>
    );
  }

  const definition = blockRegistry.get(node.type);
  const binding = bindingOf(node);
  const isRoot = node.parentId === null;
  const valueKey = binding?.valueKey ?? "text";
  const currentValue =
    typeof node.props[valueKey] === "string" ? (node.props[valueKey] as string) : "";

  const presetKind = isRoot ? null : presetKindFor(node.type);
  const presets = presetKind ? allPresets().filter((p) => p.kind === presetKind) : [];

  return (
    <div className="border-t border-border" data-testid="block-inspector">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5">
        <SlidersHorizontal className="h-3.5 w-3.5 text-accent" />
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-xs font-semibold text-text-primary">
            {isRoot ? "Section" : blockDisplayLabel(node)}
          </h4>
          <p className="text-[10px] text-text-dim/70">{definition?.label ?? node.type}</p>
        </div>
        {binding && (
          <span
            data-testid="block-bound-badge"
            className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-300"
          >
            Saved field
          </span>
        )}
      </div>

      {lastError && (
        <div data-testid="inspector-error" className="mx-4 mb-2 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-[11px] text-red-300">
          {lastError.message}
        </div>
      )}
      {!lastError && lastWarnings.length > 0 && (
        <div className="mx-4 mb-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200">
          {lastWarnings[0]}
        </div>
      )}

      {isRoot ? (
        <div className="px-4 pb-4">
          <p className="rounded-lg bg-card/60 px-3 py-2.5 text-[11px] leading-relaxed text-text-dim">
            Sections are containers that group blocks. Expand the section in the
            build tree to edit its individual blocks.
          </p>
        </div>
      ) : (
        <BlockTextField
          key={node.id}
          label={binding?.label ?? definition?.label ?? "Text"}
          value={currentValue}
          multiline={node.type === "paragraph" || node.type === "textarea"}
          onSave={(value) => ops.updateBlockText(node.id, value)}
        />
      )}

      {!isRoot && presets.length > 0 && (
        <div className="px-4 pb-4">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-dim/70">
            Style preset
          </p>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((preset) => (
              <PresetChip
                key={preset.id}
                preset={preset}
                active={presetMatchesStyle(preset, node.style)}
                onApply={() => ops.applyPreset(node.id, preset.id)}
              />
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-text-dim/60">
            Presets are previewed in-session (Phase P persistence).
          </p>
        </div>
      )}
    </div>
  );
}

function presetMatchesStyle(preset: BlockPreset, style: Record<string, unknown>): boolean {
  return Object.entries(preset.applyStyles).every(
    ([key, value]) => style[key] === value,
  );
}

function BlockTextField({
  label,
  value,
  multiline,
  onSave,
}: {
  label: string;
  value: string;
  multiline: boolean;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  // Render-phase adjustment (no setState-in-effect): resync the draft when
  // the bound value changes externally (save commit, undo/redo). The parent
  // remounts this field via key={node.id} when the selection changes.
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setDraft(value);
  }

  const commit = () => {
    if (draft.trim() === value) return;
    onSave(draft);
  };

  return (
    <div className="px-4 pb-4">
      <label
        htmlFor="block-text-field"
        className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-text-dim/70"
      >
        {label}
      </label>
      <textarea
        id="block-text-field"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !multiline) {
            e.preventDefault();
            commit();
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            setDraft(value);
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        rows={multiline ? 3 : 1}
        // Match the adapter's bound-value cap so oversized edits never
        // silently no-op on commit.
        maxLength={MAX_BOUND_TEXT}
        aria-label={label}
        data-testid="block-inspector-text"
        className="w-full resize-none rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-dim/50 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/10"
      />
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[10px] text-text-dim/50">
          {multiline ? "Ctrl/⌘ + Enter to save" : "Enter to save"} · Esc to cancel
        </span>
        <button
          type="button"
          data-testid="block-inspector-save"
          onClick={commit}
          disabled={draft.trim() === value}
          className="flex items-center gap-1 rounded-lg bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Save className="h-3 w-3" />
          Save
        </button>
      </div>
    </div>
  );
}

function PresetChip({
  preset,
  active,
  onApply,
}: {
  preset: BlockPreset;
  active: boolean;
  onApply: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`preset-${preset.id}`}
      onClick={onApply}
      aria-pressed={active}
      title={preset.description}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all duration-150 active:scale-95 ${
        active
          ? "border-accent/50 bg-accent/15 text-accent"
          : "border-border bg-card text-text-muted hover:border-accent/30 hover:text-text-primary"
      }`}
    >
      <BlockIcon iconKey="sparkles" className="h-3 w-3 opacity-60" />
      {preset.label}
    </button>
  );
}
