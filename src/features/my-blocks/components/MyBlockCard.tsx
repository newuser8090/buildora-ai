"use client";

// ---------------------------------------------------------------------------
// MyBlockCard — one saved block in the library grid
//
// Shows: name, category, lightweight preview, block count, updated date,
// tags, Insert, and a More menu (Preview / Rename / Duplicate / Delete).
// Keyboard accessible: the card is focusable, Enter/Space opens the menu,
// and every action is a real button with a clear label.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { MoreHorizontal, Plus, Layers, Clock } from "lucide-react";
import type { MyBlockRecord } from "../types";
import { MyBlockPreview } from "./MyBlockPreview";

export interface MyBlockCardProps {
  block: MyBlockRecord;
  onInsert: (block: MyBlockRecord) => void;
  onPreview: (block: MyBlockRecord) => void;
  onRename: (block: MyBlockRecord) => void;
  onDuplicate: (block: MyBlockRecord) => void;
  onDelete: (block: MyBlockRecord) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  layout: "Layout",
  text: "Text",
  media: "Media",
  buttons: "Buttons",
  cards: "Cards",
  forms: "Forms",
  navigation: "Navigation",
  "complete-section": "Complete section",
  other: "Other",
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function MyBlockCard({
  block,
  onInsert,
  onPreview,
  onRename,
  onDuplicate,
  onDelete,
}: MyBlockCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the menu on outside click + Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <div
      data-testid={`my-block-card-${block.id}`}
      className="group flex flex-col rounded-xl border border-border bg-secondary p-2.5 transition-all duration-200 hover:border-accent/40 hover:bg-card hover:shadow-sm"
    >
      {/* Preview */}
      <button
        type="button"
        data-testid={`my-block-preview-${block.id}`}
        onClick={() => onPreview(block)}
        className="mb-2 block w-full cursor-pointer rounded-lg text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
        aria-label={`Preview ${block.name}`}
      >
        <MyBlockPreview tree={block.tree} height={88} maxNodes={30} />
      </button>

      {/* Name + menu */}
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <h4 className="truncate text-xs font-semibold text-text-primary" title={block.name}>
            {block.name}
          </h4>
          <p className="mt-0.5 flex items-center gap-1 text-[10px] text-text-dim">
            <Layers className="h-2.5 w-2.5" aria-hidden="true" />
            {block.previewMetadata.blockCount} blocks
            <span className="mx-0.5 text-text-dim/40">·</span>
            {CATEGORY_LABELS[block.category] ?? "Other"}
          </p>
          {block.updatedAt && (
            <p className="mt-0.5 flex items-center gap-1 text-[10px] text-text-dim/70">
              <Clock className="h-2.5 w-2.5" aria-hidden="true" />
              {formatDate(block.updatedAt)}
            </p>
          )}
        </div>

        <div ref={menuRef} className="relative flex-none">
          <button
            type="button"
            data-testid={`my-block-menu-${block.id}`}
            aria-label={`More actions for ${block.name}`}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-card hover:text-text-primary"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>

          {menuOpen && (
            <div
              data-testid={`my-block-menu-panel-${block.id}`}
              className="absolute right-0 top-7 z-20 w-36 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-elevated"
              role="menu"
            >
              <button
                type="button"
                role="menuitem"
                data-testid={`my-block-rename-${block.id}`}
                onClick={() => {
                  closeMenu();
                  onRename(block);
                }}
                className="flex w-full items-center px-3 py-1.5 text-left text-xs text-text-muted transition-colors hover:bg-base hover:text-text-primary"
              >
                Rename
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid={`my-block-duplicate-${block.id}`}
                onClick={() => {
                  closeMenu();
                  onDuplicate(block);
                }}
                className="flex w-full items-center px-3 py-1.5 text-left text-xs text-text-muted transition-colors hover:bg-base hover:text-text-primary"
              >
                Duplicate
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid={`my-block-delete-${block.id}`}
                onClick={() => {
                  closeMenu();
                  onDelete(block);
                }}
                className="flex w-full items-center px-3 py-1.5 text-left text-xs text-red-400 transition-colors hover:bg-red-500/10"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tags */}
      {block.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {block.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded bg-card/80 px-1.5 py-0.5 text-[9px] font-medium text-text-dim"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Insert */}
      <button
        type="button"
        data-testid={`my-block-insert-${block.id}`}
        onClick={() => onInsert(block)}
        className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg bg-accent/10 py-1.5 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20 active:scale-[0.98]"
      >
        <Plus className="h-3 w-3" />
        Insert
      </button>
    </div>
  );
}
