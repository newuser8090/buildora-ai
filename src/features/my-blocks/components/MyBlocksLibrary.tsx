"use client";

// ---------------------------------------------------------------------------
// MyBlocksLibrary — browse, search, filter, sort, and insert saved blocks
//
// Desktop: grid library. Tablet/mobile: single-column cards (grid collapses).
// States: loading, empty, loaded, corrupt-record warning. Keyboard navigable
// (cards + menu are buttons). Inserting uses the canonical insertMyBlock
// service (fresh IDs, one history entry).
//
// The library is opened via the shared MyBlocks UI store; the insertion
// target comes from the editor's current selection.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X, BookMarked, AlertTriangle, Download, Upload } from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useEditorUiStore } from "@/features/editor/ui/editor-ui-store";
import { scrollSectionIntoView } from "@/features/editor/utils/scroll-section-into-view";
import type { ImportPlacement } from "@/features/code-import/services/insert-imported-block-tree";
import type { MyBlockRecord, MyBlockSortOption } from "../types";
import { getMyBlocksAdapter } from "../storage/my-blocks-singleton";
import { estimateLibraryBytes } from "../storage/my-blocks-storage-adapter";
import { insertMyBlock } from "../services/insert-my-block";
import { useMyBlocksUiStore } from "../store/my-blocks-ui-store";
import { MY_BLOCK_RECOMMENDED_LIBRARY_SIZE_BYTES } from "../schemas/my-block-schema";
import { formatBytes } from "../errors";
import { MyBlockCard } from "./MyBlockCard";

const CATEGORY_FILTERS = [
  { id: "all", label: "All" },
  { id: "layout", label: "Layout" },
  { id: "text", label: "Text" },
  { id: "media", label: "Media" },
  { id: "buttons", label: "Buttons" },
  { id: "cards", label: "Cards" },
  { id: "forms", label: "Forms" },
  { id: "navigation", label: "Navigation" },
  { id: "complete-section", label: "Complete sections" },
  { id: "other", label: "Other" },
];

export function MyBlocksLibrary() {
  const open = useMyBlocksUiStore((s) => s.libraryOpen);
  const closeLibrary = useMyBlocksUiStore((s) => s.closeLibrary);
  const refreshTick = useMyBlocksUiStore((s) => s.refreshTick);
  const openDetails = useMyBlocksUiStore((s) => s.openDetails);
  const openRename = useMyBlocksUiStore((s) => s.openRename);
  const openDelete = useMyBlocksUiStore((s) => s.openDelete);
  const openImport = useMyBlocksUiStore((s) => s.openImport);
  const showToast = useMyBlocksUiStore((s) => s.showToast);
  const bumpRefresh = useMyBlocksUiStore((s) => s.bumpRefresh);

  const project = useEditorStore((s) => s.project);
  const selectedPageId = useEditorStore((s) => s.selectedPageId);
  const setRightSidebarTab = useEditorUiStore((s) => s.setRightSidebarTab);
  const selectSection = useEditorStore((s) => s.selectSection);

  const [blocks, setBlocks] = useState<MyBlockRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<MyBlockSortOption>("recent");
  const [insertingId, setInsertingId] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const [prevOpen, setPrevOpen] = useState(open);

  // Reset search/filter/sort each time the library reopens. The loading flag
  // is also set here (render-phase adjustment) so the effect never calls
  // setState synchronously.
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery("");
      setCategory("all");
      setSort("recent");
      setLoadError(null);
      setLoading(true);
    }
  }

  // Load the library when opened / refreshed.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getMyBlocksAdapter()
      .listMyBlocks()
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setBlocks(result.value);
        } else {
          setBlocks([]);
          setLoadError(result.error.message);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBlocks([]);
          setLoadError("Could not load your saved blocks.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, refreshTick]);

  // Focus + Escape + focus trap.
  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    const raf = window.setTimeout(() => searchRef.current?.focus(), 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeLibrary();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(raf);
      document.removeEventListener("keydown", onKey);
      prevFocusRef.current?.focus?.();
      prevFocusRef.current = null;
    };
  }, [open, closeLibrary]);

  // Storage usage estimate for the footer (informational, never a block).
  const usedBytes = useMemo(() => estimateLibraryBytes(blocks), [blocks]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = blocks;
    if (category !== "all") {
      list = list.filter((b) => b.category === category);
    }
    if (q) {
      list = list.filter((b) => {
        const haystack = [b.name, b.description ?? "", ...b.tags].join(" ").toLowerCase();
        return q.split(/\s+/).every((token) => haystack.includes(token));
      });
    }
    const sorted = [...list];
    if (sort === "name") {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === "oldest") {
      sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    } else {
      // recent (library default is updatedAt desc; keep stable)
      sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    }
    return sorted;
  }, [blocks, query, category, sort]);

  // Build a placement for the current editor context.
  const buildPlacement = useCallback((): ImportPlacement | null => {
    const pageId = selectedPageId ?? project.pages[0]?.id;
    if (!pageId) return null;
    const page = project.pages.find((p) => p.id === pageId);
    const selectedSectionId = useEditorStore.getState().selectedSectionId;
    const selectedSection = page?.sections.find((s) => s.id === selectedSectionId);
    if (selectedSection && selectedSection.type === "custom-block") {
      return {
        kind: "inside-custom-block",
        pageId,
        sectionId: selectedSection.id,
        parentBlockId: selectedSection.id,
      };
    }
    if (selectedSection) {
      return { kind: "after-section", pageId, sectionId: selectedSection.id };
    }
    return { kind: "end-of-page", pageId };
  }, [project, selectedPageId]);

  const handleInsert = useCallback(
    async (block: MyBlockRecord) => {
      const placement = buildPlacement();
      if (!placement) {
        showToast("Choose a page before inserting a saved block.");
        return;
      }
      setInsertingId(block.id);
      const result = await insertMyBlock({
        projectId: project.id,
        blockId: block.id,
        placement,
        adapter: getMyBlocksAdapter(),
      });
      setInsertingId(null);
      if (!result.ok) {
        showToast(result.error.message);
        return;
      }
      // Post-insert: select the inserted section, open the Blocks tab, scroll
      // into view. One history entry — one Undo removes the whole copy.
      selectSection(result.sectionId);
      setRightSidebarTab("blocks");
      window.setTimeout(() => scrollSectionIntoView(result.sectionId, { block: "center" }), 0);
      closeLibrary();
      showToast(`"${block.name}" added to your page`);
    },
    [project.id, buildPlacement, selectSection, setRightSidebarTab, closeLibrary, showToast],
  );

  const handleDuplicate = useCallback(
    async (block: MyBlockRecord) => {
      const result = await getMyBlocksAdapter().duplicateMyBlock(block.id);
      if (result.ok) {
        bumpRefresh();
        showToast(`"${result.value.name}" duplicated`);
      } else {
        showToast(result.error.message);
      }
    },
    [bumpRefresh, showToast],
  );

  const handleExport = useCallback(
    async (block: MyBlockRecord) => {
      const { buildBlockFile } = await import("../services/my-block-file");
      const payload = buildBlockFile(block);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safeName = block.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "saved-block";
      a.href = url;
      a.download = `${safeName}.buildora-block.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("Block exported");
    },
    [showToast],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="My Blocks"
      data-testid="my-blocks-library"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeLibrary();
      }}
    >
      <div className="flex max-h-[88dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-base shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10">
              <BookMarked className="h-4 w-4 text-accent" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-text-primary">My Blocks</h2>
              <p className="text-[11px] text-text-dim">
                Designs you saved — reusable in any project
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            data-testid="my-blocks-close"
            onClick={closeLibrary}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search + sort */}
        <div className="flex flex-col gap-2 border-b border-border px-4 py-2.5 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-dim" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search saved blocks…"
              aria-label="Search saved blocks"
              data-testid="my-blocks-search"
              className="h-8 w-full rounded-lg border border-border bg-secondary pl-9 pr-3 text-sm text-text-primary placeholder:text-text-dim/50 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/10"
            />
          </div>
          <label className="flex items-center gap-2 text-[11px] text-text-dim">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as MyBlockSortOption)}
              data-testid="my-blocks-sort"
              aria-label="Sort saved blocks"
              className="h-8 rounded-lg border border-border bg-secondary px-2 text-xs text-text-primary focus:border-accent/40 focus:outline-none"
            >
              <option value="recent">Recently updated</option>
              <option value="oldest">Oldest</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>

        {/* Category filter */}
        <div role="tablist" aria-label="Block categories" className="flex flex-wrap gap-1 border-b border-border px-4 py-2">
          {CATEGORY_FILTERS.map((cat) => (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={category === cat.id}
              data-testid={`my-blocks-cat-${cat.id}`}
              onClick={() => setCategory(cat.id)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                category === cat.id
                  ? "bg-accent/15 text-accent ring-1 ring-accent/30"
                  : "text-text-dim hover:bg-card hover:text-text-primary"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loadError && (
            <div
              role="alert"
              data-testid="my-blocks-error"
              className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200"
            >
              <AlertTriangle className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
              {loadError}
            </div>
          )}

          {loading ? (
            <div data-testid="my-blocks-loading" className="flex items-center justify-center py-16">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
            </div>
          ) : filtered.length === 0 ? (
            <div data-testid="my-blocks-empty" className="py-14 text-center">
              <BookMarked className="mx-auto h-8 w-8 text-text-dim/40" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-text-primary">
                {blocks.length === 0 ? "No saved blocks yet" : `No saved blocks match “${query}”`}
              </p>
              <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-text-dim">
                {blocks.length === 0
                  ? "Save a design once and reuse it in any project."
                  : "Try a different search or category."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((block) => (
                <MyBlockCard
                  key={block.id}
                  block={block}
                  onInsert={handleInsert}
                  onPreview={(b) => openDetails(b.id)}
                  onRename={(b) => openRename(b.id)}
                  onDuplicate={handleDuplicate}
                  onDelete={(b) => openDelete(b.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
          <p className="text-[10px] text-text-dim/70">
            {blocks.length} saved block{blocks.length === 1 ? "" : "s"}
            {blocks.length > 0 && (
              <span data-testid="my-blocks-usage">
                {" · "}
                {formatBytes(usedBytes)} of {formatBytes(MY_BLOCK_RECOMMENDED_LIBRARY_SIZE_BYTES)} used
              </span>
            )}
            {insertingId ? " · inserting…" : ""}
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-testid="my-blocks-import"
              onClick={openImport}
              className="flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-[10px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
            >
              <Upload className="h-3 w-3" />
              Import
            </button>
            {blocks.length > 0 && (
              <button
                type="button"
                data-testid="my-blocks-export-first"
                onClick={() => blocks[0] && handleExport(blocks[0])}
                className="flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-[10px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
              >
                <Download className="h-3 w-3" />
                Export
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
