"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { cn } from "@/utils/cn";
import {
  ChevronRight,
  Code2,
  Copy,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Plus,
  Trash2,
  Layers,
} from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { blockRegistry } from "@/features/blocks/registry/block-registry";
import { useBlockForest } from "@/features/blocks/hooks/useBlockForest";
import { useBlockOperations } from "@/features/blocks/hooks/useBlockOperations";
import { useBlockEditorStore } from "@/features/blocks/store/block-editor-store";
import { BlockIcon } from "./BlockIcon";
import {
  blockDisplayLabel,
  isBoundBlock,
  propsFingerprint,
} from "@/features/blocks/adapters/section-block-adapter";
import { rootIdOf } from "../engine/tree-traversal";
import { useEditorUiStore } from "@/features/editor/ui/editor-ui-store";
import type { BlockNode, BlockTree } from "../types";
import { getGuidedSectionLabel } from "@/features/guided-builder/registry/guided-section-language";
import type { BlockOperations } from "../hooks/useBlockOperations";

// ---------------------------------------------------------------------------
// Flattened visible rows for keyboard navigation
// ---------------------------------------------------------------------------

function flattenVisible(tree: BlockTree, expanded: Set<string>): BlockNode[] {
  const result: BlockNode[] = [];
  const visit = (node: BlockNode): void => {
    result.push(node);
    if (expanded.has(node.id)) {
      for (const childId of node.children) {
        const child = tree.nodes[childId];
        if (child) visit(child);
      }
    }
  };
  for (const rootId of tree.rootIds) {
    const root = tree.nodes[rootId];
    if (root) visit(root);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function TreeRow({
  node,
  depth,
  forest,
  expanded,
  expandedSet,
  selected,
  selectedBlockId,
  sessionActive,
  onSelect,
  onToggleExpand,
  ops,
}: {
  node: BlockNode;
  depth: number;
  forest: BlockTree;
  expanded: boolean;
  expandedSet: Set<string>;
  selected: boolean;
  selectedBlockId: string | null;
  sessionActive: boolean;
  onSelect: (node: BlockNode) => void;
  onToggleExpand: (id: string) => void;
  ops: BlockOperations;
}) {
  const definition = blockRegistry.get(node.type);
  const hasChildren = node.children.length > 0;
  const isRoot = node.parentId === null;

  const label = isRoot
    ? getGuidedSectionLabel(node.props._sectionType as string)
    : blockDisplayLabel(node);

  return (
    <div>
      <div
        role="treeitem"
        aria-selected={selected}
        aria-expanded={hasChildren ? expanded : undefined}
        aria-level={depth + 1}
        data-testid={`block-row-${node.id}`}
        data-selected={selected || undefined}
        data-block-type={node.type}
        data-bound={isBoundBlock(node) ? "true" : undefined}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(node);
        }}
        tabIndex={selected ? 0 : -1}
        className={cn(
          "group flex h-7 cursor-pointer select-none items-center gap-1 rounded-lg pr-1 text-xs transition-colors",
          depth > 0 && "mr-1",
          selected
            ? "bg-accent/15 text-text-primary ring-1 ring-accent/30"
            : "text-text-muted hover:bg-card/60 hover:text-text-primary",
          node.hidden && "opacity-40",
        )}
        style={{ paddingLeft: `${6 + depth * 14}px` }}
      >
        {/* Disclosure */}
        {hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={expanded ? "Collapse" : "Expand"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.id);
            }}
            className="flex h-4 w-4 items-center justify-center rounded text-text-dim/70 hover:text-text-primary"
          >
            <ChevronRight
              className={cn("h-3 w-3 transition-transform duration-150", expanded && "rotate-90")}
            />
          </button>
        ) : (
          <span className="w-4 flex-none" />
        )}

        {/* Icon */}
        <span className="flex-none">
          <BlockIcon iconKey={definition?.iconKey ?? "box"} className="h-3.5 w-3.5 text-text-dim" />
        </span>

        {/* Label */}
        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>

        {isBoundBlock(node) && (
          <span className="hidden flex-none rounded bg-emerald-500/10 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-emerald-300 group-hover:inline">
            saved
          </span>
        )}

        {node.locked && <Lock className="h-3 w-3 flex-none text-amber-300" aria-label="Locked" />}

        {/* Row actions */}
        <div className="flex flex-none items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {!node.locked && (
            <button
              type="button"
              data-testid={`block-dup-${node.id}`}
              aria-label={`Duplicate ${label}`}
              title="Duplicate"
              onClick={(e) => {
                e.stopPropagation();
                ops.duplicateBlock(node.id);
              }}
              className="flex h-5 w-5 items-center justify-center rounded text-text-dim hover:bg-card hover:text-text-primary"
            >
              <Copy className="h-3 w-3" />
            </button>
          )}
          {!node.locked && (
            <button
              type="button"
              data-testid={`block-del-${node.id}`}
              aria-label={`Delete ${label}`}
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                ops.deleteBlock(node.id);
              }}
              className="flex h-5 w-5 items-center justify-center rounded text-text-dim hover:bg-red-500/10 hover:text-red-300"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            data-testid={`block-lock-${node.id}`}
            aria-label={node.locked ? `Unlock ${label}` : `Lock ${label}`}
            title={node.locked ? "Unlock" : "Lock"}
            onClick={(e) => {
              e.stopPropagation();
              ops.setLocked(node.id, !node.locked);
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-text-dim hover:bg-card hover:text-text-primary"
          >
            {node.locked ? <LockOpen className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
          </button>
          <button
            type="button"
            data-testid={`block-hide-${node.id}`}
            aria-label={node.hidden ? `Show ${label}` : `Hide ${label}`}
            title={node.hidden ? "Show" : "Hide"}
            onClick={(e) => {
              e.stopPropagation();
              ops.setHidden(node.id, !node.hidden);
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-text-dim hover:bg-card hover:text-text-primary"
          >
            {node.hidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          </button>
        </div>

        {sessionActive && isRoot && (
          <span
            data-testid="session-preview-badge"
            className="flex-none rounded bg-amber-500/10 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-amber-300"
            title="Structural changes are previewed in-session only"
          >
            Preview
          </span>
        )}
      </div>

      {/* Children */}
      {expanded &&
        node.children.map((childId) => {
          const child = forest.nodes[childId];
          if (!child) return null;
          return (
            <TreeRow
              key={childId}
              node={child}
              depth={depth + 1}
              forest={forest}
              expanded={expandedSet.has(childId)}
              expandedSet={expandedSet}
              selected={selectedBlockId === child.id}
              selectedBlockId={selectedBlockId}
              sessionActive={false}
              onSelect={onSelect}
              onToggleExpand={onToggleExpand}
              ops={ops}
            />
          );
        })}
    </div>
  );
}

function useExpandedIds(): Set<string> {
  const ids = useBlockEditorStore((s) => s.expandedIds);
  return useMemo(() => new Set(ids), [ids]);
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function BuildTreePanel() {
  const selectedPageId = useEditorStore((s) => s.selectedPageId);
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);
  const selectSection = useEditorStore((s) => s.selectSection);
  const project = useEditorStore((s) => s.project);

  const forest = useBlockForest(selectedPageId);
  const ops = useBlockOperations(selectedPageId);
  const selectedBlockId = useBlockEditorStore((s) => s.selectedBlockId);
  const selectBlock = useBlockEditorStore((s) => s.selectBlock);
  const toggleExpand = useBlockEditorStore((s) => s.toggleExpand);
  const openBrowser = useBlockEditorStore((s) => s.openBrowser);
  const sessionTrees = useBlockEditorStore((s) => s.sessionTrees);
  const lastError = useBlockEditorStore((s) => s.lastError);
  const lastWarnings = useBlockEditorStore((s) => s.lastWarnings);
  const expanded = useExpandedIds();

  const visible = useMemo(() => flattenVisible(forest, expanded), [forest, expanded]);

  // A selected block that no longer exists clears itself.
  useEffect(() => {
    if (selectedBlockId && !forest.nodes[selectedBlockId]) {
      selectBlock(null);
    }
  }, [selectedBlockId, forest.nodes, selectBlock]);

  // Selection sync: external section changes (structure panel/canvas) select
  // that section's root block in the build tree. When the build tree itself
  // selected a block inside the newly-selected section (a bound child), its
  // selection is preserved instead of being clobbered back to the root.
  const prevSectionRef = useRef(selectedSectionId);
  useEffect(() => {
    const prev = prevSectionRef.current;
    prevSectionRef.current = selectedSectionId;
    if (prev !== selectedSectionId && selectedSectionId) {
      const selectedRoot =
        selectedBlockId !== null ? rootIdOf(forest, selectedBlockId) : null;
      if (selectedRoot !== selectedSectionId) {
        selectBlock(selectedSectionId);
      }
    }
  }, [selectedSectionId, selectBlock, selectedBlockId, forest]);

  const handleSelect = useCallback(
    (node: BlockNode) => {
      selectBlock(node.id);
      const rootId = rootIdOf(forest, node.id);
      if (rootId) selectSection(rootId);
    },
    [selectBlock, selectSection, forest],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (visible.length === 0) return;
      const index = visible.findIndex((n) => n.id === selectedBlockId);
      if (e.key === "ArrowDown" && index < visible.length - 1) {
        e.preventDefault();
        handleSelect(visible[index + 1]);
      } else if (e.key === "ArrowUp" && index > 0) {
        e.preventDefault();
        handleSelect(visible[index - 1]);
      } else if (e.key === "ArrowLeft" && index >= 0) {
        const node = visible[index];
        if (node.children.length > 0 && expanded.has(node.id)) {
          e.preventDefault();
          toggleExpand(node.id);
        }
      } else if (e.key === "ArrowRight" && index >= 0) {
        const node = visible[index];
        if (node.children.length > 0 && !expanded.has(node.id)) {
          e.preventDefault();
          toggleExpand(node.id);
        }
      } else if (e.key === "Escape") {
        selectBlock(null);
      }
    },
    [visible, selectedBlockId, handleSelect, expanded, toggleExpand, selectBlock],
  );

  const sessionCount = Object.keys(sessionTrees).length;

  return (
    <div className="flex flex-col" data-testid="build-tree-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 text-accent" />
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-dim">
            Build Tree
          </h3>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="build-tree-import-code"
            onClick={() => {
              const root = selectedBlockId && rootIdOf(forest, selectedBlockId)
                ? rootIdOf(forest, selectedBlockId)
                : forest.rootIds[0];
              if (!root) return;
              useEditorUiStore.getState().openCodeImportDialog({
                pageId: selectedPageId ?? "",
                sectionId: root,
                // When a block inside the tree is selected, prefer it as the
                // placement target ("import into selected block").
                parentBlockId: selectedBlockId && selectedBlockId !== root ? selectedBlockId : undefined,
              });
            }}
            className="flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-[11px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary active:scale-95"
          >
            <Code2 className="h-3 w-3" />
            Import code
          </button>
          <button
            type="button"
            data-testid="open-block-browser"
            onClick={() => {
              const root = forest.rootIds[0];
              if (root) {
                openBrowser({ pageId: selectedPageId ?? "", sectionId: root });
              }
            }}
            className="flex items-center gap-1 rounded-lg bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20 active:scale-95"
          >
            <Plus className="h-3 w-3" />
            Add block
          </button>
        </div>
      </div>

      {sessionCount > 0 && (
        <div
          data-testid="session-preview-note"
          className="mx-4 mb-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-200"
        >
          Block structure changes are previewed in-session only. They save once
          the free-form block engine is enabled (Phase P).
        </div>
      )}

      {lastError && (
        <div
          data-testid="block-error"
          className="mx-4 mb-2 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-[11px] text-red-300"
        >
          {lastError.message}
        </div>
      )}

      {lastWarnings.length > 0 && (
        <div
          data-testid="block-warning"
          className="mx-4 mb-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200"
        >
          {lastWarnings[0]}
        </div>
      )}

      {/* Tree */}
      {visible.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="text-xs text-text-dim/60">No sections on this page yet.</p>
        </div>
      ) : (
        <div
          role="tree"
          aria-label="Page blocks"
          data-testid="block-tree"
          className="px-2 pb-3"
          onKeyDown={handleKeyDown}
        >
          {forest.rootIds.map((rootId) => {
            const root = forest.nodes[rootId];
            if (!root) return null;
            const section = project.pages
              .flatMap((p) => p.sections)
              .find((s) => s.id === rootId);
            const session = section ? sessionTrees[rootId] : undefined;
            const sessionActive =
              !!session && !!section && session.fingerprint === propsFingerprint(section);
            return (
              <TreeRow
                key={rootId}
                node={root}
                depth={0}
                forest={forest}
                expanded={expanded.has(rootId)}
                expandedSet={expanded}
                selected={selectedBlockId === rootId}
                selectedBlockId={selectedBlockId}
                sessionActive={sessionActive}
                onSelect={handleSelect}
                onToggleExpand={toggleExpand}
                ops={ops}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
