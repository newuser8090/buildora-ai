"use client";

// ---------------------------------------------------------------------------
// Element Library (Phase P22-D) — the discover-and-insert panel
//
// A polished, compact library of every element the builder can actually
// render and persist today (block types from the Phase O registry via the
// Phase P22-A element registry). Click an element to insert it:
//   - into the selected custom-block section's tree when one is selected, or
//   - as a NEW custom-block section (after the selected section / page end).
//
// Insertion routes through the canonical insertLibraryElement service — one
// atomic history entry, existing selection/undo/collab behavior preserved.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Boxes, ArrowDownToLine, ArrowRightToLine } from "lucide-react";
import { cn } from "@/utils/cn";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { isCustomBlockSection } from "@/features/blocks/adapters/section-block-adapter";
import { BlockIcon } from "@/features/blocks/components/BlockIcon";
import { scrollSectionIntoView } from "@/features/editor/utils/scroll-section-into-view";
import { useMyBlocksUiStore } from "@/features/my-blocks/store/my-blocks-ui-store";
import { buildLibraryCatalog, filterLibraryItems, LIBRARY_CATEGORIES } from "../catalog";
import type { LibraryCategoryId, LibraryItem } from "../types";
import { insertLibraryElement } from "../services/insert-library-element";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ElementLibrary() {
  const project = useEditorStore((s) => s.project);
  const selectedPageId = useEditorStore((s) => s.selectedPageId);
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);
  const showToast = useMyBlocksUiStore((s) => s.showToast);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<LibraryCategoryId | "all">("all");
  const [inserting, setInserting] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const catalog = useMemo(() => buildLibraryCatalog(), []);
  const filtered = useMemo(
    () => filterLibraryItems(catalog, { category, query }),
    [catalog, category, query],
  );

  // The insertion target context: a selected custom-block section on the
  // active page hosts elements inside its tree; everything else adds a new
  // section after the selection (or at the end of the page).
  const activePage = project.pages.find((p) => p.id === selectedPageId) ?? project.pages[0];
  const selectedSection = selectedSectionId
    ? (activePage?.sections.find((s) => s.id === selectedSectionId) ?? null)
    : null;
  const insertingInside = selectedSection
    ? isCustomBlockSection(selectedSection)
    : false;

  // Focus the search box on first mount (the panel is a persistent tab).
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const handleInsert = useCallback(
    async (item: LibraryItem) => {
      if (inserting) return;
      setInserting(item.type);
      const pageId = selectedPageId ?? project.pages[0]?.id;
      const result = insertLibraryElement({
        type: item.type,
        pageId: pageId ?? undefined,
        targetSectionId: insertingInside ? (selectedSectionId ?? undefined) : undefined,
      });
      setInserting(null);
      if (!result.ok) {
        showToast(result.error.message);
        return;
      }
      showToast(`“${item.label}” added to your page`);
      // Keep the canvas centered on the freshly added content.
      window.setTimeout(
        () => scrollSectionIntoView(result.sectionId, { block: "center" }),
        0,
      );
    },
    [inserting, project.pages, selectedPageId, selectedSectionId, insertingInside, showToast],
  );

  return (
    <div data-testid="element-library" className="flex min-h-0 flex-1 flex-col">
      {/* ---- Header ---- */}
      <div className="border-b border-border px-4 py-3 flex-none">
        <h2 className="text-sm font-semibold text-text-primary">Elements</h2>
        <p className="mt-0.5 text-xs text-text-dim">
          Add ready-made elements to your page
        </p>
      </div>

      {/* ---- Insertion context ---- */}
      <div
        data-testid="element-library-context"
        className="flex items-center gap-2 border-b border-border/60 px-4 py-2 flex-none"
      >
        {insertingInside ? (
          <>
            <ArrowRightToLine className="h-3 w-3 shrink-0 text-accent" />
            <span className="text-[11px] text-text-dim">
              Adding inside the selected design
            </span>
          </>
        ) : (
          <>
            <ArrowDownToLine className="h-3 w-3 shrink-0 text-accent" />
            <span className="text-[11px] text-text-dim">
              {selectedSection ? "Adding as a new section below" : "Adding as a new section at the end"}
            </span>
          </>
        )}
      </div>

      {/* ---- Search ---- */}
      <div className="border-b border-border px-4 py-2.5 flex-none">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-dim" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search elements…"
            aria-label="Search elements"
            data-testid="element-library-search"
            className="h-8 w-full rounded-lg border border-border bg-secondary pl-9 pr-3 text-sm text-text-primary placeholder:text-text-dim/50 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/10"
          />
        </div>
      </div>

      {/* ---- Categories ---- */}
      <div
        role="tablist"
        aria-label="Element categories"
        className="flex flex-wrap gap-1 border-b border-border px-4 py-2 flex-none"
      >
        <CategoryChip
          id="all"
          label="All"
          active={category === "all"}
          onSelect={() => setCategory("all")}
        />
        {LIBRARY_CATEGORIES.map((cat) => (
          <CategoryChip
            key={cat.id}
            id={cat.id}
            label={cat.label}
            active={category === cat.id}
            onSelect={() => setCategory(cat.id)}
          />
        ))}
      </div>

      {/* ---- Grid ---- */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {filtered.length === 0 ? (
          <div
            data-testid="element-library-empty"
            className="py-12 text-center"
          >
            <Boxes className="mx-auto h-6 w-6 text-text-dim/40" />
            <p className="mt-2 text-sm text-text-dim">No elements match “{query}”.</p>
            <p className="mt-1 text-xs text-text-dim/60">
              Try “heading”, “button”, “card” or “image”.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filtered.map((item) => (
              <ElementCard
                key={item.type}
                item={item}
                inserting={inserting === item.type}
                disabled={inserting !== null && inserting !== item.type}
                onInsert={() => void handleInsert(item)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category chip
// ---------------------------------------------------------------------------

function CategoryChip({
  id,
  label,
  active,
  onSelect,
}: {
  id: LibraryCategoryId | "all";
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={`element-cat-${id}`}
      onClick={onSelect}
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
        active
          ? "bg-accent/15 text-accent ring-1 ring-accent/30"
          : "text-text-dim hover:bg-card hover:text-text-primary",
      )}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Element card
// ---------------------------------------------------------------------------

function ElementCard({
  item,
  inserting,
  disabled,
  onInsert,
}: {
  item: LibraryItem;
  inserting: boolean;
  disabled: boolean;
  onInsert: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`element-card-${item.type}`}
      onClick={onInsert}
      disabled={disabled}
      title={`Add ${item.label}`}
      className={cn(
        "group relative flex flex-col items-start gap-1.5 rounded-xl border border-border bg-secondary p-3 text-left transition-all duration-200 hover:border-accent/40 hover:bg-card active:scale-[0.98]",
        disabled && !inserting && "pointer-events-none opacity-50",
        inserting && "border-accent/50 bg-accent/10",
      )}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-card/70 text-text-muted transition-colors group-hover:text-accent">
        <BlockIcon iconKey={item.iconKey} className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-text-primary">
          {item.label}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[10px] leading-relaxed text-text-dim">
          {item.description}
        </span>
      </span>
      {inserting && (
        <span
          aria-hidden="true"
          className="absolute right-2 top-2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent/30 border-t-accent"
        />
      )}
    </button>
  );
}
