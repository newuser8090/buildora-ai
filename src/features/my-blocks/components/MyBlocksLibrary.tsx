"use client";

// ---------------------------------------------------------------------------
// MyBlocksLibrary — Phase P5 visual library
//
// Beginner-first browsing of saved blocks:
//   - grid + compact list views (persisted locally)
//   - sections: All blocks, Favorites, Recent (recently saved), Collections
//   - search + category + collection filters, 6 deterministic sort options
//   - selection mode with bulk Export / Move to collection / Favorite /
//     Delete (delete shows a confirmation with the exact count)
//   - persistent visual thumbnails (lazy — cards off-screen do no blob work)
//   - incremental rendering (large libraries stay responsive)
//   - storage usage footer (records + thumbnail bytes + collections)
//
// Inserting always opens the placement picker → canonical insertMyBlock.
// Library data never touches project history or autosave.
// ---------------------------------------------------------------------------

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  BookMarked,
  CheckSquare,
  Clock,
  Download,
  Folder,
  FolderPlus,
  LayoutGrid,
  List,
  Search,
  Star,
  Trash2,
  Upload,
  X,
  Bookmark,
  Pencil,
} from "lucide-react";
import type { MyBlockRecord, MyBlockSortOption } from "../types";
import type { MyBlockCollection } from "../types";
import { getMyBlocksAdapter } from "../storage/my-blocks-singleton";
import { estimateLibraryBytes } from "../storage/my-blocks-storage-adapter";
import { getMyBlockThumbnailService } from "../thumbnails/my-block-thumbnail-singleton";
import { useMyBlocksUiStore } from "../store/my-blocks-ui-store";
import { MY_BLOCK_RECOMMENDED_LIBRARY_SIZE_BYTES } from "../schemas/my-block-schema";
import { formatBytes } from "../errors";
import {
  loadLibraryPreferences,
  saveLibraryPreferences,
  type LibraryPreferences,
  type MyBlockLibrarySection,
} from "../services/library-preferences";
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

const SECTIONS: { id: MyBlockLibrarySection; label: string }[] = [
  { id: "all", label: "All blocks" },
  { id: "favorites", label: "Favorites" },
  { id: "recent", label: "Recent" },
  { id: "collections", label: "Collections" },
];

const SORT_OPTIONS: { id: MyBlockSortOption; label: string }[] = [
  { id: "recent", label: "Recently updated" },
  { id: "recently-used", label: "Recently used" },
  { id: "oldest", label: "Oldest" },
  { id: "name-asc", label: "Name A–Z" },
  { id: "name-desc", label: "Name Z–A" },
  { id: "most-used", label: "Most used" },
];

const PAGE_SIZE = 48;

/** Deterministic sort for the library. */
function sortBlocks(
  blocks: MyBlockRecord[],
  sort: MyBlockSortOption,
): MyBlockRecord[] {
  const list = [...blocks];
  switch (sort) {
    case "name-asc":
      list.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      break;
    case "name-desc":
      list.sort((a, b) => b.name.localeCompare(a.name) || b.id.localeCompare(a.id));
      break;
    case "oldest":
      list.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      break;
    case "recently-used":
      list.sort(
        (a, b) =>
          (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "") ||
          b.updatedAt.localeCompare(a.updatedAt) ||
          a.id.localeCompare(b.id),
      );
      break;
    case "most-used":
      list.sort(
        (a, b) =>
          (b.useCount ?? 0) - (a.useCount ?? 0) ||
          b.updatedAt.localeCompare(a.updatedAt) ||
          a.id.localeCompare(b.id),
      );
      break;
    default:
      // recent
      list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
      break;
  }
  return list;
}

export function MyBlocksLibrary() {
  const open = useMyBlocksUiStore((s) => s.libraryOpen);
  const closeLibrary = useMyBlocksUiStore((s) => s.closeLibrary);
  const refreshTick = useMyBlocksUiStore((s) => s.refreshTick);
  const openDetails = useMyBlocksUiStore((s) => s.openDetails);
  const openRename = useMyBlocksUiStore((s) => s.openRename);
  const openDelete = useMyBlocksUiStore((s) => s.openDelete);
  const openImport = useMyBlocksUiStore((s) => s.openImport);
  const openPlacementPicker = useMyBlocksUiStore((s) => s.openPlacementPicker);
  const openCreateCollection = useMyBlocksUiStore((s) => s.openCreateCollection);
  const openRenameCollection = useMyBlocksUiStore((s) => s.openRenameCollection);
  const openMoveToCollection = useMyBlocksUiStore((s) => s.openMoveToCollection);
  const openBulkDelete = useMyBlocksUiStore((s) => s.openBulkDelete);
  const showToast = useMyBlocksUiStore((s) => s.showToast);
  const bumpRefresh = useMyBlocksUiStore((s) => s.bumpRefresh);

  const [blocks, setBlocks] = useState<MyBlockRecord[]>([]);
  const [collections, setCollections] = useState<MyBlockCollection[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  // Persisted UI preferences.
  const [prefs, setPrefs] = useState<LibraryPreferences>(() =>
    loadLibraryPreferences(),
  );
  const view = prefs.view;
  const sort = prefs.sort;
  const section = prefs.section;
  const collectionId = prefs.collectionId;

  // Selection mode.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Incremental rendering.
  const [renderedCount, setRenderedCount] = useState(PAGE_SIZE);

  const [thumbnailBytes, setThumbnailBytes] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const [prevOpen, setPrevOpen] = useState(open);

  // Reset search/filter/selection each time the library reopens. Loading is
  // set in a render-phase adjustment (never sync setState inside an effect).
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery("");
      setCategory("all");
      setSelectionMode(false);
      setSelectedIds(new Set());
      setRenderedCount(PAGE_SIZE);
      setLoadError(null);
      setLoading(true);
    }
  }

  // Load blocks + collections + thumbnail usage when opened/refreshed.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const adapter = getMyBlocksAdapter();
    void Promise.all([
      adapter.listMyBlocks(),
      adapter.listMyBlockCollections(),
      getMyBlockThumbnailService().estimateUsage(),
    ])
      .then(([blocksResult, collectionsResult, thumbResult]) => {
        if (cancelled) return;
        if (blocksResult.ok) setBlocks(blocksResult.value);
        else {
          setBlocks([]);
          setLoadError(blocksResult.error.message);
        }
        if (collectionsResult.ok) setCollections(collectionsResult.value);
        setThumbnailBytes(thumbResult.ok ? thumbResult.value.bytes : 0);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Could not load your saved blocks.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, refreshTick]);

  // Focus + Escape + focus restoration.
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

  // Persist preferences (only harmless UI state).
  useEffect(() => {
    saveLibraryPreferences(prefs);
  }, [prefs]);

  // ---- Filtering + sorting (memoized — large libraries stay fast) ----
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = blocks;

    switch (section) {
      case "favorites":
        list = list.filter((b) => b.favorite === true);
        break;
      case "recent":
        list = sortBlocks(list, "recent");
        break;
      case "collections":
        if (collectionId) {
          list = list.filter((b) => b.collectionIds?.includes(collectionId));
        }
        break;
      default:
        break;
    }

    if (category !== "all") {
      list = list.filter((b) => b.category === category);
    }
    if (q) {
      list = list.filter((b) => {
        const haystack = [b.name, b.description ?? "", ...b.tags].join(" ").toLowerCase();
        return q.split(/\s+/).every((token) => haystack.includes(token));
      });
    }
    return sortBlocks(list, sort);
  }, [blocks, query, category, sort, section, collectionId]);

  const usedBytes = useMemo(() => estimateLibraryBytes(blocks), [blocks]);
  const hasCollections = collections.length > 0;

  // ---- Actions ----

  const handleInsert = useCallback(
    (block: MyBlockRecord) => {
      openPlacementPicker(block);
    },
    [openPlacementPicker],
  );

  const handleFavorite = useCallback(
    async (block: MyBlockRecord, favorite: boolean) => {
      const result = await getMyBlocksAdapter().updateMyBlock(block.id, { favorite });
      if (result.ok) {
        bumpRefresh();
        showToast(favorite ? `"${block.name}" added to Favorites` : `"${block.name}" removed from Favorites`);
      } else {
        showToast(result.error.message);
      }
    },
    [bumpRefresh, showToast],
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

  const downloadJson = useCallback((payload: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const safeFilename = (name: string) =>
    name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "saved-block";

  const handleExport = useCallback(
    (block: MyBlockRecord) => {
      void import("../services/my-block-file").then(({ buildBlockFile }) => {
        downloadJson(buildBlockFile(block), `${safeFilename(block.name)}.buildora-block.json`);
        showToast("Block exported");
      });
    },
    [downloadJson, showToast],
  );

  const handleExportSelected = useCallback(
    (ids: string[]) => {
      void import("../services/my-block-file").then(({ buildBlocksFile }) => {
        const records = ids
          .map((id) => blocks.find((b) => b.id === id))
          .filter((b): b is MyBlockRecord => !!b);
        if (records.length === 0) return;
        downloadJson(buildBlocksFile(records, collections), "my-blocks.buildora-blocks.json");
        showToast(`Exported ${records.length} saved ${records.length === 1 ? "block" : "blocks"}`);
      });
    },
    [blocks, collections, downloadJson, showToast],
  );

  // Selection helpers.
  const toggleSelect = useCallback((block: MyBlockRecord) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(block.id)) next.delete(block.id);
      else next.add(block.id);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedIds(new Set(filtered.map((b) => b.id)));
  }, [filtered]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const bulkFavorite = useCallback(
    async (favorite: boolean) => {
      const ids = [...selectedIds];
      if (ids.length === 0) return;
      const adapter = getMyBlocksAdapter();
      let ok = 0;
      for (const id of ids) {
        const result = await adapter.updateMyBlock(id, { favorite });
        if (result.ok) ok += 1;
      }
      bumpRefresh();
      showToast(
        ok === ids.length
          ? `${favorite ? "Favorited" : "Unfavorited"} ${ids.length} saved ${ids.length === 1 ? "block" : "blocks"}`
          : `${ok} of ${ids.length} updated`,
      );
    },
    [selectedIds, bumpRefresh, showToast],
  );

  const allSelected = filtered.length > 0 && selectedIds.size === filtered.length;

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
      <div className="flex max-h-[88dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-base shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10">
              <BookMarked className="h-4 w-4 text-accent" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-text-primary">My Blocks</h2>
              <p className="text-[11px] text-text-dim">
                Designs you saved — reuse them in any project
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {/* View toggle */}
            <div className="flex items-center rounded-lg border border-border/60 p-0.5" role="group" aria-label="Library view">
              <button
                type="button"
                aria-label="Grid view"
                aria-pressed={view === "grid"}
                data-testid="my-blocks-view-grid"
                onClick={() => setPrefs((p) => ({ ...p, view: "grid" }))}
                className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                  view === "grid" ? "bg-card text-text-primary" : "text-text-dim hover:text-text-primary"
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="List view"
                aria-pressed={view === "list"}
                data-testid="my-blocks-view-list"
                onClick={() => setPrefs((p) => ({ ...p, view: "list" }))}
                className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                  view === "list" ? "bg-card text-text-primary" : "text-text-dim hover:text-text-primary"
                }`}
              >
                <List className="h-3.5 w-3.5" />
              </button>
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
        </div>

        {/* Sections + search + sort */}
        <div className="border-b border-border px-4 pt-2">
          <div role="tablist" aria-label="Library sections" className="flex flex-wrap gap-1">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={section === s.id}
                data-testid={`my-blocks-section-${s.id}`}
                onClick={() => setPrefs((p) => ({ ...p, section: s.id }))}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  section === s.id
                    ? "bg-accent/15 text-accent ring-1 ring-accent/30"
                    : "text-text-dim hover:bg-card hover:text-text-primary"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-dim" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setRenderedCount(PAGE_SIZE);
                }}
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
                onChange={(e) => setPrefs((p) => ({ ...p, sort: e.target.value as MyBlockSortOption }))}
                data-testid="my-blocks-sort"
                aria-label="Sort saved blocks"
                className="h-8 rounded-lg border border-border bg-secondary px-2 text-xs text-text-primary focus:border-accent/40 focus:outline-none"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {/* Collections strip (only in the Collections section) */}
        {section === "collections" && (
          <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border px-4 py-2">
            <button
              type="button"
              data-testid="my-blocks-collection-all"
              onClick={() => setPrefs((p) => ({ ...p, collectionId: null }))}
              className={`flex h-8 flex-none items-center gap-1.5 rounded-full px-3 text-[11px] font-medium transition-colors ${
                !collectionId
                  ? "bg-accent/15 text-accent ring-1 ring-accent/30"
                  : "text-text-dim hover:bg-card hover:text-text-primary"
              }`}
            >
              <Folder className="h-3.5 w-3.5" aria-hidden="true" />
              All collections
            </button>
            {collections.map((collection) => (
              <div
                key={collection.id}
                title={collection.description ?? undefined}
                className={`flex h-8 flex-none items-center overflow-hidden rounded-full text-[11px] font-medium transition-colors ${
                  collectionId === collection.id
                    ? "bg-accent/15 text-accent ring-1 ring-accent/30"
                    : "bg-secondary/80 text-text-dim hover:bg-card hover:text-text-primary"
                }`}
              >
                <button
                  type="button"
                  data-testid={`my-blocks-collection-${collection.id}`}
                  onClick={() => setPrefs((p) => ({ ...p, collectionId: collection.id }))}
                  className="flex h-full items-center gap-1.5 pl-3 pr-1"
                >
                  <Folder className="h-3.5 w-3.5" aria-hidden="true" />
                  {collection.name}
                  <span className="rounded bg-card px-1 text-[9px] text-text-dim">
                    {blocks.filter((b) => b.collectionIds?.includes(collection.id)).length}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Rename collection ${collection.name}`}
                  data-testid={`my-blocks-collection-rename-${collection.id}`}
                  onClick={() => openRenameCollection(collection)}
                  className="flex h-full items-center px-1.5 text-text-dim/70 transition-colors hover:text-text-primary"
                >
                  <Pencil className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            ))}
            <button
              type="button"
              data-testid="my-blocks-new-collection"
              onClick={openCreateCollection}
              className="flex h-8 flex-none items-center gap-1.5 rounded-full border border-dashed border-accent/30 px-3 text-[11px] font-medium text-accent transition-colors hover:bg-accent/10"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              New collection
            </button>
          </div>
        )}

        {/* Category filter */}
        <div role="tablist" aria-label="Block categories" className="flex flex-wrap gap-1 border-b border-border px-4 py-2">
          {CATEGORY_FILTERS.map((cat) => (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={category === cat.id}
              data-testid={`my-blocks-cat-${cat.id}`}
              onClick={() => {
                setCategory(cat.id);
                setRenderedCount(PAGE_SIZE);
              }}
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
            <EmptyLibraryState
              section={section}
              hasCollections={hasCollections}
              blocksCount={blocks.length}
              query={query}
              onCreateCollection={openCreateCollection}
            />
          ) : (
            <>
              <div
                data-testid="my-blocks-grid"
                className={
                  view === "list"
                    ? "flex flex-col gap-2"
                    : "grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                }
              >
                {filtered.slice(0, renderedCount).map((block) => (
                  <MyBlockCard
                    key={block.id}
                    block={block}
                    view={view}
                    collections={collections}
                    selectionMode={selectionMode}
                    selected={selectedIds.has(block.id)}
                    onSelect={toggleSelect}
                    onInsert={handleInsert}
                    onPreview={(b) => openDetails(b.id)}
                    onRename={(b) => openRename(b.id)}
                    onDuplicate={handleDuplicate}
                    onDelete={(b) => openDelete(b.id)}
                    onFavorite={handleFavorite}
                    onMoveToCollection={(b) => openMoveToCollection([b.id])}
                    onExport={handleExport}
                  />
                ))}
              </div>
              {filtered.length > renderedCount && (
                <div className="mt-4 flex justify-center">
                  <button
                    type="button"
                    data-testid="my-blocks-load-more"
                    onClick={() => setRenderedCount((c) => c + PAGE_SIZE)}
                    className="flex h-8 items-center rounded-lg border border-border px-4 text-xs font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
                  >
                    Show more ({filtered.length - renderedCount} more)
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Selection toolbar (bulk actions) */}
        {selectionMode ? (
          <div
            className="flex flex-wrap items-center gap-1.5 border-t border-border bg-secondary/60 px-4 py-2.5"
            role="toolbar"
            aria-label="Bulk actions"
            data-testid="my-blocks-selection-toolbar"
          >
            <span className="mr-1 text-[11px] font-medium text-text-primary" aria-live="polite">
              {selectedIds.size} selected
            </span>
            <button
              type="button"
              data-testid="my-blocks-select-all"
              disabled={filtered.length === 0}
              onClick={allSelected ? clearSelection : selectAllVisible}
              className="flex h-7 items-center gap-1 rounded-lg border border-border/60 px-2 text-[10px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary disabled:opacity-40"
            >
              <CheckSquare className="h-3 w-3" />
              {allSelected ? "Clear" : "Select all visible"}
            </button>
            <button
              type="button"
              data-testid="my-blocks-bulk-export"
              disabled={selectedIds.size === 0}
              onClick={() => handleExportSelected([...selectedIds])}
              className="flex h-7 items-center gap-1 rounded-lg border border-border/60 px-2 text-[10px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary disabled:opacity-40"
            >
              <Download className="h-3 w-3" />
              Export
            </button>
            <button
              type="button"
              data-testid="my-blocks-bulk-move"
              disabled={selectedIds.size === 0}
              onClick={() => openMoveToCollection([...selectedIds])}
              className="flex h-7 items-center gap-1 rounded-lg border border-border/60 px-2 text-[10px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary disabled:opacity-40"
            >
              <Folder className="h-3 w-3" />
              Move
            </button>
            <button
              type="button"
              data-testid="my-blocks-bulk-favorite"
              disabled={selectedIds.size === 0}
              onClick={() => void bulkFavorite(true)}
              className="flex h-7 items-center gap-1 rounded-lg border border-border/60 px-2 text-[10px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary disabled:opacity-40"
            >
              <Star className="h-3 w-3" />
              Favorite
            </button>
            <button
              type="button"
              data-testid="my-blocks-bulk-unfavorite"
              disabled={selectedIds.size === 0}
              onClick={() => void bulkFavorite(false)}
              className="flex h-7 items-center gap-1 rounded-lg border border-border/60 px-2 text-[10px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary disabled:opacity-40"
            >
              <Star className="h-3 w-3 text-text-dim/60" />
              Unfavorite
            </button>
            <button
              type="button"
              data-testid="my-blocks-bulk-delete"
              disabled={selectedIds.size === 0}
              onClick={() => openBulkDelete([...selectedIds])}
              className="flex h-7 items-center gap-1 rounded-lg border border-red-500/25 px-2 text-[10px] font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-40"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </button>
            <button
              type="button"
              data-testid="my-blocks-selection-done"
              onClick={() => {
                setSelectionMode(false);
                setSelectedIds(new Set());
              }}
              className="ml-auto flex h-7 items-center rounded-lg border border-border/60 px-2 text-[10px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
            >
              Done
            </button>
          </div>
        ) : (
          /* Footer */
          <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
            <p className="text-[10px] text-text-dim/70" data-testid="my-blocks-usage">
              {blocks.length} saved {blocks.length === 1 ? "block" : "blocks"}
              {" · "}
              {formatBytes(usedBytes + thumbnailBytes)} of {formatBytes(MY_BLOCK_RECOMMENDED_LIBRARY_SIZE_BYTES)} used
              {collections.length > 0 ? ` · ${collections.length} ${collections.length === 1 ? "collection" : "collections"}` : ""}
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-testid="my-blocks-select-mode"
                onClick={() => setSelectionMode((m) => !m)}
                className="flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-[10px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
              >
                <CheckSquare className="h-3 w-3" />
                Select
              </button>
              <button
                type="button"
                data-testid="my-blocks-import"
                onClick={openImport}
                className="flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-[10px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
              >
                <Upload className="h-3 w-3" />
                Import
              </button>
              <button
                type="button"
                data-testid="my-blocks-export-all"
                onClick={() => blocks.length > 0 && handleExportSelected(blocks.map((b) => b.id))}
                className="flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-[10px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
              >
                <Download className="h-3 w-3" />
                Export all
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty states — beginner-friendly copy for each context
// ---------------------------------------------------------------------------

function EmptyLibraryState({
  section,
  hasCollections,
  blocksCount,
  query,
  onCreateCollection,
}: {
  section: MyBlockLibrarySection;
  hasCollections: boolean;
  blocksCount: number;
  query: string;
  onCreateCollection: () => void;
}) {
  let title: string;
  let body: string;
  let icon: React.ReactNode;

  if (query.trim()) {
    title = `No saved blocks match “${query.trim()}”`;
    body = "Try a simpler word, like “button”, “card”, or “hero”.";
    icon = <Search className="mx-auto h-8 w-8 text-text-dim/40" aria-hidden="true" />;
  } else if (blocksCount === 0) {
    title = "No saved blocks yet";
    body = "Save a design once and reuse it anywhere.";
    icon = <BookMarked className="mx-auto h-8 w-8 text-text-dim/40" aria-hidden="true" />;
  } else if (section === "favorites") {
    title = "No favorites yet";
    body = "Star the pieces you use most.";
    icon = <Star className="mx-auto h-8 w-8 text-text-dim/40" aria-hidden="true" />;
  } else if (section === "recent") {
    title = "Nothing here yet";
    body = "Recently saved pieces will appear here.";
    icon = <Clock className="mx-auto h-8 w-8 text-text-dim/40" aria-hidden="true" />;
  } else if (section === "collections") {
    title = hasCollections ? "This collection is empty" : "No collections yet";
    body = hasCollections
      ? "Add saved blocks to this collection to keep them together."
      : "Group related pieces so they are easier to find.";
    icon = <Folder className="mx-auto h-8 w-8 text-text-dim/40" aria-hidden="true" />;
  } else {
    title = "No saved blocks match";
    body = "Try a different search or category.";
    icon = <Bookmark className="mx-auto h-8 w-8 text-text-dim/40" aria-hidden="true" />;
  }

  return (
    <div data-testid="my-blocks-empty" className="py-14 text-center">
      {icon}
      <p className="mt-3 text-sm font-medium text-text-primary">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-text-dim">{body}</p>
      {section === "collections" && !hasCollections && blocksCount > 0 && (
        <button
          type="button"
          data-testid="my-blocks-empty-new-collection"
          onClick={onCreateCollection}
          className="mt-4 flex h-8 items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/5 px-3 text-xs font-medium text-accent transition-colors hover:bg-accent/10"
        >
          <FolderPlus className="h-3.5 w-3.5" />
          Create a collection
        </button>
      )}
    </div>
  );
}
