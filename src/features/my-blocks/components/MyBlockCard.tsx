"use client";

// ---------------------------------------------------------------------------
// MyBlockCard — one saved block in the library (Phase P5 visual upgrade)
//
// Shows: persistent thumbnail (lazy, with fallback), name, category,
// collections, tags, block count, last-used/updated time, favorite state,
// Insert (→ placement picker), drag handle, selection checkbox in selection
// mode, and a full More menu (Preview / Insert / Rename / Duplicate / Move to
// collection / Favorite / Export / Delete).
//
// Keyboard accessible: every action is a real button with a clear label; the
// drag handle is focusable (Space starts a keyboard drag, arrows move through
// drop zones, Enter drops, Escape cancels).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import {
  Check,
  Clock,
  Copy,
  Download,
  FolderInput,
  GripVertical,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  Star,
  StarOff,
  Trash2,
} from "lucide-react";
import { cn } from "@/utils/cn";
import type { MyBlockCollection, MyBlockRecord } from "../types";
import { MyBlockThumb } from "./MyBlockThumb";

export type MyBlockView = "grid" | "list";

export interface MyBlockCardProps {
  block: MyBlockRecord;
  view: MyBlockView;
  collections: MyBlockCollection[];
  /** Selection mode active — cards show checkboxes. */
  selectionMode: boolean;
  selected: boolean;
  onSelect: (block: MyBlockRecord) => void;
  onInsert: (block: MyBlockRecord) => void;
  onPreview: (block: MyBlockRecord) => void;
  onRename: (block: MyBlockRecord) => void;
  onDuplicate: (block: MyBlockRecord) => void;
  onDelete: (block: MyBlockRecord) => void;
  onFavorite: (block: MyBlockRecord, favorite: boolean) => void;
  onMoveToCollection: (block: MyBlockRecord) => void;
  onExport: (block: MyBlockRecord) => void;
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

function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function friendlyTime(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function MyBlockCard({
  block,
  view,
  collections,
  selectionMode,
  selected,
  onSelect,
  onInsert,
  onPreview,
  onRename,
  onDuplicate,
  onDelete,
  onFavorite,
  onMoveToCollection,
  onExport,
}: MyBlockCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Drag source (Phase P5): the payload is just { blockId, source }.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `myblock-drag-${block.id}`,
    disabled: selectionMode,
    data: { blockId: block.id, source: "library" as const },
  });

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
  const favorite = block.favorite === true;
  const blockCollections = collections.filter((c) => block.collectionIds?.includes(c.id));

  const menuItem =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-muted transition-colors hover:bg-base hover:text-text-primary";

  const thumb = (height: number) => (
    <div className="relative">
      <MyBlockThumb block={block} height={height} />
      {/* Favorite star (touch target ≥ 32px) */}
      <button
        type="button"
        data-testid={`my-block-favorite-${block.id}`}
        aria-label={favorite ? `Remove ${block.name} from favorites` : `Add ${block.name} to favorites`}
        aria-pressed={favorite}
        onClick={(e) => {
          e.stopPropagation();
          onFavorite(block, !favorite);
        }}
        className={cn(
          "absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-full backdrop-blur transition-all active:scale-90",
          favorite
            ? "bg-amber-400/90 text-amber-950"
            : "bg-black/30 text-white/80 hover:bg-black/50 hover:text-white",
        )}
      >
        {favorite ? (
          <Star className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
        ) : (
          <StarOff className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </button>
      {/* Selection checkbox (selection mode) */}
      {selectionMode && (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={selected ? `Deselect ${block.name}` : `Select ${block.name}`}
          data-testid={`my-block-select-${block.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(block);
          }}
          className={cn(
            "absolute left-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-full border backdrop-blur transition-all active:scale-90",
            selected
              ? "border-accent bg-accent text-white"
              : "border-white/60 bg-black/30 text-transparent hover:bg-black/50",
          )}
        >
          <Check className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );

  const meta = (
    <div className="min-w-0">
      <h4 className="truncate text-xs font-semibold text-text-primary" title={block.name}>
        {block.name}
      </h4>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-text-dim">
        <span className="flex items-center gap-1">
          <Layers className="h-2.5 w-2.5" aria-hidden="true" />
          {block.previewMetadata.blockCount}
        </span>
        <span aria-hidden="true">·</span>
        <span>{CATEGORY_LABELS[block.category] ?? "Other"}</span>
        {block.useCount ? (
          <>
            <span aria-hidden="true">·</span>
            <span>used {block.useCount}×</span>
          </>
        ) : null}
      </p>
      <p className="mt-0.5 flex items-center gap-1 text-[10px] text-text-dim/70">
        <Clock className="h-2.5 w-2.5" aria-hidden="true" />
        {block.lastUsedAt
          ? `Last used ${friendlyTime(block.lastUsedAt)}`
          : `Saved ${formatDate(block.updatedAt)}`}
      </p>
      {blockCollections.length > 0 && (
        <p className="mt-1 flex flex-wrap gap-1">
          {blockCollections.slice(0, 2).map((c) => (
            <span
              key={c.id}
              data-testid={`my-block-collection-chip-${c.id}`}
              className="rounded bg-accent/10 px-1.5 py-0.5 text-[9px] font-medium text-accent"
            >
              {c.name}
            </span>
          ))}
        </p>
      )}
      {block.tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
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
    </div>
  );

  const actions = (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        data-testid={`my-block-insert-${block.id}`}
        onClick={() => onInsert(block)}
        className="flex h-7 flex-1 items-center justify-center gap-1 rounded-lg bg-accent/10 px-2 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20 active:scale-[0.98]"
      >
        <Plus className="h-3 w-3" />
        Insert
      </button>
      <div ref={menuRef} className="relative flex-none">
        <button
          type="button"
          data-testid={`my-block-menu-${block.id}`}
          aria-label={`More actions for ${block.name}`}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
        {menuOpen && (
          <div
            data-testid={`my-block-menu-panel-${block.id}`}
            className="absolute right-0 top-8 z-30 w-44 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-elevated"
            role="menu"
          >
            <button type="button" role="menuitem" data-testid={`my-block-preview-${block.id}`}
              className={menuItem}
              onClick={() => { closeMenu(); onPreview(block); }}>
              Preview
            </button>
            <button type="button" role="menuitem" data-testid={`my-block-menu-insert-${block.id}`}
              className={menuItem}
              onClick={() => { closeMenu(); onInsert(block); }}>
              <Plus className="h-3.5 w-3.5" /> Insert
            </button>
            <button type="button" role="menuitem" data-testid={`my-block-rename-${block.id}`}
              className={menuItem}
              onClick={() => { closeMenu(); onRename(block); }}>
              <Pencil className="h-3.5 w-3.5" /> Rename
            </button>
            <button type="button" role="menuitem" data-testid={`my-block-duplicate-${block.id}`}
              className={menuItem}
              onClick={() => { closeMenu(); onDuplicate(block); }}>
              <Copy className="h-3.5 w-3.5" /> Duplicate
            </button>
            <button type="button" role="menuitem" data-testid={`my-block-move-${block.id}`}
              className={menuItem}
              onClick={() => { closeMenu(); onMoveToCollection(block); }}>
              <FolderInput className="h-3.5 w-3.5" /> Move to collection
            </button>
            <button type="button" role="menuitem" data-testid={`my-block-menu-favorite-${block.id}`}
              className={menuItem}
              onClick={() => { closeMenu(); onFavorite(block, !favorite); }}>
              {favorite ? <StarOff className="h-3.5 w-3.5" /> : <Star className="h-3.5 w-3.5" />}
              {favorite ? "Unfavorite" : "Favorite"}
            </button>
            <button type="button" role="menuitem" data-testid={`my-block-export-${block.id}`}
              className={menuItem}
              onClick={() => { closeMenu(); onExport(block); }}>
              <Download className="h-3.5 w-3.5" /> Export
            </button>
            <button type="button" role="menuitem" data-testid={`my-block-delete-${block.id}`}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-400 transition-colors hover:bg-red-500/10"
              onClick={() => { closeMenu(); onDelete(block); }}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );

  // Drag handle (hidden in selection mode — checkboxes take over).
  const dragHandle = (
    <button
      type="button"
      {...attributes}
      {...listeners}
      aria-label={`Drag ${block.name} to add it to the page`}
      data-testid={`my-block-drag-${block.id}`}
      className="flex h-7 w-7 cursor-grab touch-none items-center justify-center rounded-md text-text-dim/60 transition-colors hover:bg-card hover:text-text-primary active:cursor-grabbing"
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );

  if (view === "list") {
    return (
      <div
        ref={setNodeRef}
        data-testid={`my-block-card-${block.id}`}
        data-selected={selected || undefined}
        data-dragging={isDragging || undefined}
        onClick={() => selectionMode && onSelect(block)}
        className={cn(
          "group flex items-center gap-3 rounded-xl border bg-secondary p-2 transition-all duration-200",
          selected ? "border-accent/60 bg-accent/5" : "border-border hover:border-accent/40 hover:bg-card",
          isDragging && "opacity-40",
        )}
      >
        <div className="w-24 flex-none">{thumb(56)}</div>
        <div className="min-w-0 flex-1">{meta}</div>
        <div className="flex flex-none items-center gap-1">{dragHandle}</div>
        <div className="w-44 flex-none">{actions}</div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      data-testid={`my-block-card-${block.id}`}
      data-selected={selected || undefined}
      data-dragging={isDragging || undefined}
      onClick={() => selectionMode && onSelect(block)}
      className={cn(
        "group flex flex-col rounded-xl border bg-secondary p-2 transition-all duration-200",
        selected ? "border-accent/60 bg-accent/5" : "border-border hover:border-accent/40 hover:bg-card hover:shadow-sm",
        isDragging && "opacity-40",
      )}
    >
      {thumb(88)}
      <div className="mt-2 flex items-start justify-between gap-1">
        {meta}
        {dragHandle}
      </div>
      <div className="mt-2">{actions}</div>
    </div>
  );
}
