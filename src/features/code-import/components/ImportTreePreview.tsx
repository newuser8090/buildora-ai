"use client";

// ---------------------------------------------------------------------------
// ImportTreePreview — the native Buildora block tree shown in the Review step.
// Expandable, keyboard navigable, deterministic labels. Warning markers show
// on the root when the conversion reported issues.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/utils/cn";
import type { BlockNode, BlockTree } from "@/features/blocks/types";
import { blockRegistry } from "@/features/blocks/registry/block-registry";
import { blockDisplayLabel } from "@/features/blocks/adapters/section-block-adapter";
import { BlockIcon } from "@/features/blocks/components/BlockIcon";
import { friendlyBlockLabel } from "../presentation/import-summary-builder";

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

export function ImportTreePreview({
  tree,
  warningCount,
  selectedBlockId,
  onSelectBlock,
}: {
  tree: BlockTree;
  warningCount: number;
  selectedBlockId?: string | null;
  onSelectBlock?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(tree.rootIds),
  );

  const visible = useMemo(
    () => flattenVisible(tree, expanded),
    [tree, expanded],
  );

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div
      data-testid="import-tree-preview"
      className="overflow-hidden rounded-xl border border-border bg-secondary"
    >
      <div className="border-b border-border px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-dim">
          Build Tree
        </h3>
      </div>
      <div
        role="tree"
        aria-label="Imported blocks"
        className="max-h-72 overflow-y-auto p-2"
        data-testid="import-tree"
      >
        {visible.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-text-dim">
            No blocks to show.
          </p>
        ) : (
          visible.map((node, index) => {
            const definition = blockRegistry.get(node.type);
            const hasChildren = node.children.length > 0;
            const depth = depthOf(tree, node);
            const selected = selectedBlockId === node.id;
            return (
              <div
                key={node.id}
                role="treeitem"
                aria-selected={selected}
                aria-expanded={hasChildren ? expanded.has(node.id) : undefined}
                aria-level={depth + 1}
                tabIndex={index === 0 ? 0 : -1}
                data-testid={`import-tree-row-${node.type}`}
                data-block-id={node.id}
                onClick={() => onSelectBlock?.(node.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectBlock?.(node.id);
                  } else if (e.key === "ArrowRight" && hasChildren) {
                    e.preventDefault();
                    if (!expanded.has(node.id)) toggle(node.id);
                  } else if (e.key === "ArrowLeft") {
                    e.preventDefault();
                    if (expanded.has(node.id)) toggle(node.id);
                  }
                }}
                className={cn(
                  "flex cursor-pointer select-none items-center gap-1.5 rounded-lg py-1 pr-2 text-xs",
                  selected
                    ? "bg-accent/15 text-text-primary ring-1 ring-accent/30"
                    : "text-text-muted hover:bg-card/70 hover:text-text-primary",
                )}
                style={{ paddingLeft: `${8 + depth * 14}px` }}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={expanded.has(node.id) ? "Collapse" : "Expand"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(node.id);
                    }}
                    className="flex h-4 w-4 items-center justify-center rounded text-text-dim/70"
                  >
                    <ChevronRight
                      className={cn(
                        "h-3 w-3 transition-transform duration-150",
                        expanded.has(node.id) && "rotate-90",
                      )}
                    />
                  </button>
                ) : (
                  <span className="w-4 flex-none" />
                )}
                <span className="flex-none">
                  <BlockIcon
                    iconKey={definition?.iconKey ?? "box"}
                    className="h-3.5 w-3.5 text-text-dim"
                  />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {blockDisplayLabel(node)}
                </span>
                <span className="hidden flex-none rounded bg-card px-1 py-0.5 text-[9px] text-text-dim/70 group-hover:inline sm:inline">
                  {friendlyBlockLabel(node.type)}
                </span>
                {warningCount > 0 && node.parentId === null && (
                  <span
                    title="This design has notes to review"
                    aria-label="Has review notes"
                    className="flex-none rounded bg-amber-500/10 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-300"
                  >
                    Notes
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function depthOf(tree: BlockTree, node: BlockNode): number {
  let depth = 0;
  let current: BlockNode | undefined = node;
  while (current?.parentId && tree.nodes[current.parentId]) {
    depth += 1;
    current = tree.nodes[current.parentId];
  }
  return depth;
}
