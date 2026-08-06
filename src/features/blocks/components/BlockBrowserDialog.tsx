"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { GripVertical, Search, Star, X, Sparkles } from "lucide-react";
import { blockRegistry } from "@/features/blocks/registry/block-registry";
import { blockCategoryOf, type BlockType } from "../types";
import { useBlockEditorStore } from "../store/block-editor-store";
import { useBlockOperations } from "../hooks/useBlockOperations";
import { BlockIcon } from "./BlockIcon";
import { bindingsForSection } from "../adapters/section-block-adapter";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useEditorUiStore } from "@/features/editor/ui/editor-ui-store";
import { useMyBlocksUiStore } from "@/features/my-blocks/store/my-blocks-ui-store";
import { getMyBlocksAdapter } from "@/features/my-blocks/storage/my-blocks-singleton";
import { insertMyBlock } from "@/features/my-blocks/services/insert-my-block";
import { MyBlockThumb } from "@/features/my-blocks/components/MyBlockThumb";
import { useDraggable } from "@dnd-kit/core";
import { scrollSectionIntoView } from "@/features/editor/utils/scroll-section-into-view";
import type { MyBlockRecord } from "@/features/my-blocks/types";

// ---------------------------------------------------------------------------
// Friendly categories for the browser (plain-language, Phase O)
// ---------------------------------------------------------------------------

interface BrowserCategory {
  id: string;
  label: string;
  match: (type: BlockType) => boolean;
}

const CATEGORIES: BrowserCategory[] = [
  { id: "all", label: "All", match: () => true },
  { id: "layout", label: "Layout", match: (t) => blockCategoryOf(t) === "layout" },
  {
    id: "text",
    label: "Text",
    match: (t) => ["heading", "paragraph", "badge"].includes(t),
  },
  {
    id: "media",
    label: "Media",
    match: (t) => ["image", "video", "icon"].includes(t),
  },
  { id: "buttons", label: "Buttons", match: (t) => t === "button" },
  {
    id: "cards",
    label: "Cards",
    match: (t) => blockCategoryOf(t) === "composite",
  },
  {
    id: "interactive",
    label: "Interactive",
    match: (t) => blockCategoryOf(t) === "interactive",
  },
  {
    id: "navigation",
    label: "Navigation",
    match: (t) => blockCategoryOf(t) === "navigation",
  },
  {
    id: "my-blocks",
    label: "My blocks",
    // My Blocks are NOT registered BlockTypes — this category is handled
    // specially (a library view, not a registry category).
    match: () => false,
  },
];

// Plain-language synonym search.
const SYNONYMS: Record<string, string[]> = {
  button: ["action", "cta", "click", "get started"],
  heading: ["title", "headline", "main message", "text"],
  paragraph: ["description", "body", "copy", "text"],
  image: ["photo", "picture", "visual"],
  "pricing-card": ["pricing", "plan", "price", "cost"],
  "review-card": ["review", "testimonial", "customer", "trust"],
  "faq-item": ["faq", "question", "answer"],
  navbar: ["nav", "navigation", "menu", "header", "top"],
  footer: ["bottom", "contact", "copyright"],
  menu: ["links", "list"],
  card: ["panel", "box"],
};

function matchesQuery(type: BlockType, query: string): boolean {
  const q = query.toLowerCase();
  const definition = blockRegistry.get(type);
  if (!definition) return false;
  if (definition.label.toLowerCase().includes(q)) return true;
  if (definition.description.toLowerCase().includes(q)) return true;
  if (definition.keywords?.some((k) => k.toLowerCase().includes(q))) return true;
  const synonyms = SYNONYMS[type.toLowerCase()] ?? [];
  return synonyms.some((s) => s.includes(q) || q.includes(s));
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export function BlockBrowserDialog() {
  const open = useBlockEditorStore((s) => s.browserOpen);
  const target = useBlockEditorStore((s) => s.browserTarget);
  const closeBrowser = useBlockEditorStore((s) => s.closeBrowser);
  const toggleFavorite = useBlockEditorStore((s) => s.toggleFavorite);
  const favoriteBlockTypes = useBlockEditorStore((s) => s.favoriteBlockTypes);
  const recentBlockTypes = useBlockEditorStore((s) => s.recentBlockTypes);

  const project = useEditorStore((s) => s.project);
  const ops = useBlockOperations(target?.pageId ?? null);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const searchRef = useRef<HTMLInputElement>(null);

  // Render-phase adjustment (no setState-in-effect): reset the search/category
  // state each time the dialog reopens.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery("");
      setCategory("all");
    }
  }

  // Focus the search box + handle Escape while open.
  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const previous = document.activeElement as HTMLElement | null;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeBrowser();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previous?.focus?.();
    };
  }, [open, closeBrowser]);

  // ---- My Blocks library (Phase P4) ----
  // `myBlocks` is null while loading (never re-shows stale data). The reset
  // happens in a render-phase adjustment, not inside the effect.
  const [myBlocks, setMyBlocks] = useState<MyBlockRecord[] | null>(null);
  const [insertingMyBlockId, setInsertingMyBlockId] = useState<string | null>(null);
  const showToast = useMyBlocksUiStore((s) => s.showToast);

  const [prevMyBlocksView, setPrevMyBlocksView] = useState({ open, category });
  if (prevMyBlocksView.open !== open || prevMyBlocksView.category !== category) {
    setPrevMyBlocksView({ open, category });
    if (open && category === "my-blocks") {
      setMyBlocks(null);
    }
  }

  useEffect(() => {
    if (!open || category !== "my-blocks") return;
    let cancelled = false;
    getMyBlocksAdapter()
      .listMyBlocks()
      .then((result) => {
        if (cancelled) return;
        setMyBlocks(result.ok ? result.value : []);
      })
      .catch(() => {
        if (!cancelled) setMyBlocks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, category]);

  const filteredMyBlocks = useMemo(() => {
    if (!myBlocks) return [];
    const q = query.trim().toLowerCase();
    if (!q) return myBlocks;
    return myBlocks.filter((b) => {
      const haystack = [b.name, b.description ?? "", ...b.tags].join(" ").toLowerCase();
      return q.split(/\s+/).every((token) => haystack.includes(token));
    });
  }, [myBlocks, query]);

  const insertMyBlockInto = async (block: MyBlockRecord) => {
    if (!target || insertingMyBlockId) return;
    setInsertingMyBlockId(block.id);
    // Choose a valid placement for the browser target: inside an imported
    // design when the target section hosts custom blocks, otherwise as a new
    // section right after the selected one.
    const section = project.pages
      .flatMap((p) => p.sections)
      .find((s) => s.id === target.sectionId);
    const placement =
      section?.type === "custom-block"
        ? {
            kind: "inside-custom-block" as const,
            pageId: target.pageId,
            sectionId: target.sectionId,
            parentBlockId: target.parentId ?? target.sectionId,
          }
        : {
            kind: "after-section" as const,
            pageId: target.pageId,
            sectionId: target.sectionId,
          };
    const result = await insertMyBlock({
      projectId: useEditorStore.getState().project.id,
      blockId: block.id,
      placement,
      adapter: getMyBlocksAdapter(),
    });
    setInsertingMyBlockId(null);
    if (!result.ok) {
      showToast(result.error.message);
      return;
    }
    useEditorStore.getState().selectSection(result.sectionId);
    useEditorUiStore.getState().setRightSidebarTab("blocks");
    window.setTimeout(() => scrollSectionIntoView(result.sectionId, { block: "center" }), 0);
    showToast(`"${block.name}" added to your page`);
    closeBrowser();
  };

  // Recommended types: the block types bound by the target section.
  const recommended = useMemo(() => {
    if (!target) return [] as BlockType[];
    const section = project.pages
      .flatMap((p) => p.sections)
      .find((s) => s.id === target.sectionId);
    if (!section) return [] as BlockType[];
    const types = bindingsForSection(section).map((b) => b.blockType);
    return [...new Set(types)];
  }, [target, project]);

  const allBlocks = useMemo(() => blockRegistry.list(), []);
  const visibleBlocks = useMemo(() => {
    const cat = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0];
    let list = allBlocks.filter((d) => cat.match(d.type));
    if (query.trim()) {
      list = list.filter((d) => matchesQuery(d.type, query.trim()));
    }
    // Recommended first, deterministic.
    return [...list].sort((a, b) => {
      const ra = recommended.includes(a.type) ? 0 : 1;
      const rb = recommended.includes(b.type) ? 0 : 1;
      return ra - rb;
    });
  }, [allBlocks, category, query, recommended]);

  // My Blocks are handled as a separate view inside the same dialog.
  const showMyBlocks = category === "my-blocks";

  if (!open || !target) return null;

  const insert = (type: BlockType) => {
    // insertBlock selects the new block; we keep that selection visible in
    // the inspector after the dialog closes.
    ops.insertBlock(type, target.parentId ?? target.sectionId);
    closeBrowser();
  };

  const openImport = () => {
    // Open the shared Import Studio with the current insertion target so the
    // placement step can suggest "inside this design" where valid.
    useEditorUiStore.getState().openCodeImportDialog({
      pageId: target.pageId,
      sectionId: target.sectionId,
      parentBlockId: target.parentId,
    });
    closeBrowser();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Add a block"
      data-testid="block-browser"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeBrowser();
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-base shadow-2xl" data-testid="block-browser-dialog">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Add a block</h2>
            <p className="text-[11px] text-text-dim">
              Building blocks for the selected part of your page
            </p>
          </div>
          <button
            type="button"
            data-testid="block-browser-close"
            aria-label="Close"
            onClick={closeBrowser}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim hover:bg-card hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-border px-4 py-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-dim" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search… e.g. reviews, prices, contact, questions"
              aria-label="Search blocks"
              data-testid="block-browser-search"
              className="h-8 w-full rounded-lg border border-border bg-secondary pl-9 pr-3 text-sm text-text-primary placeholder:text-text-dim/50 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/10"
            />
          </div>
        </div>

        {/* Categories */}
        <div
          role="tablist"
          aria-label="Block categories"
          className="flex flex-wrap gap-1 border-b border-border px-4 py-2"
        >
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={category === cat.id}
              data-testid={`block-cat-${cat.id}`}
              onClick={() => setCategory(cat.id)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                category === cat.id
                  ? "bg-accent/15 text-accent ring-1 ring-accent/30"
                  : "text-text-dim hover:bg-card hover:text-text-primary",
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Recents (native blocks only — My Blocks have their own list) */}
        {!showMyBlocks && recentBlockTypes.length > 0 && (
          <div className="flex items-center gap-1.5 border-b border-border px-4 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-dim/70">
              Recent
            </span>
            {recentBlockTypes.map((type) => {
              const d = blockRegistry.get(type);
              if (!d) return null;
              return (
                <button
                  key={type}
                  type="button"
                  data-testid={`block-recent-${type}`}
                  onClick={() => insert(type)}
                  className="flex items-center gap-1 rounded-lg bg-card px-2 py-1 text-[11px] text-text-muted transition-colors hover:text-text-primary"
                >
                  <BlockIcon iconKey={d.iconKey} className="h-3 w-3" />
                  {d.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Import code — Phase P3 entry point */}
        <div className="border-b border-border px-4 py-3">
          <button
            type="button"
            data-testid="browser-import-code"
            onClick={openImport}
            className="group flex w-full items-center gap-3 rounded-xl border border-dashed border-accent/30 bg-accent/5 p-3 text-left transition-all duration-200 hover:border-accent/50 hover:bg-accent/10"
          >
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-accent/15">
              <Sparkles className="h-4 w-4 text-accent" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-text-primary group-hover:text-accent">
                Import code
              </span>
              <span className="mt-0.5 block text-[10px] leading-relaxed text-text-dim">
                Paste HTML, JSX, React or Tailwind and turn it into editable
                building blocks
              </span>
            </span>
            <span className="flex-none rounded-lg bg-accent/10 px-2 py-1 text-[10px] font-semibold text-accent">
              Open
            </span>
          </button>
        </div>

        {/* My Blocks grid (Phase P4) */}
        {showMyBlocks ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {myBlocks === null ? (
              <div data-testid="my-blocks-browser-loading" className="flex justify-center py-12">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
              </div>
            ) : filteredMyBlocks.length === 0 ? (
              <div data-testid="my-blocks-browser-empty" className="py-12 text-center">
                <p className="text-sm text-text-dim">
                  {myBlocks.length === 0
                    ? "Save a design once and reuse it in any project."
                    : `No saved blocks match “${query}”.`}
                </p>
                {myBlocks.length === 0 && (
                  <p className="mt-1 text-xs text-text-dim/60">
                    Import a design and choose “Save as My Block” to build your library.
                  </p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {filteredMyBlocks.map((block) => (
                  <MyBlockBrowserCard
                    key={block.id}
                    block={block}
                    inserting={insertingMyBlockId === block.id}
                    insertingAny={!!insertingMyBlockId}
                    onInsert={() => void insertMyBlockInto(block)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Grid */
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {recommended.length > 0 && (
            <div
              data-testid="block-recommended"
              className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-accent"
            >
              <Sparkles className="h-3 w-3" />
              Recommended for this part
            </div>
          )}
          {visibleBlocks.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-text-dim">No blocks match “{query}”.</p>
              <p className="mt-1 text-xs text-text-dim/60">
                Try “reviews”, “prices”, “questions”, “contact” or “top bar”.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {visibleBlocks.map((d) => {
                const favorite = favoriteBlockTypes.includes(d.type);
                const isRecommended = recommended.includes(d.type);
                return (
                  <div
                    key={d.type}
                    data-testid={`block-card-${d.type}`}
                    className="group relative flex flex-col rounded-xl border border-border bg-secondary p-3 transition-all duration-200 hover:border-accent/40 hover:bg-card"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-card/70">
                        <BlockIcon iconKey={d.iconKey} className="h-3.5 w-3.5 text-text-muted" />
                      </span>
                      <button
                        type="button"
                        data-testid={`block-fav-${d.type}`}
                        aria-label={favorite ? `Remove ${d.label} from favorites` : `Favorite ${d.label}`}
                        onClick={() => toggleFavorite(d.type)}
                        className={cn(
                          "flex h-5 w-5 items-center justify-center rounded opacity-0 transition-all group-hover:opacity-100",
                          favorite ? "text-amber-300 opacity-100" : "text-text-dim hover:text-amber-300",
                        )}
                      >
                        <Star className={cn("h-3.5 w-3.5", favorite && "fill-current")} />
                      </button>
                    </div>
                    <h4 className="text-xs font-semibold text-text-primary">{d.label}</h4>
                    <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-text-dim">
                      {d.description}
                    </p>
                    <div className="mt-2 flex items-center gap-1.5">
                      <button
                        type="button"
                        data-testid={`block-add-${d.type}`}
                        onClick={() => insert(d.type)}
                        className="flex-1 rounded-lg bg-accent/10 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20 active:scale-95"
                      >
                        Add
                      </button>
                      {isRecommended && (
                        <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-accent">
                          Recommended
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MyBlockBrowserCard — saved-block card in the browser's My Blocks tab
// (Phase P5: drag handle → root DndContext → canvas drop zones)
// ---------------------------------------------------------------------------

function MyBlockBrowserCard({
  block,
  inserting,
  insertingAny,
  onInsert,
}: {
  block: MyBlockRecord;
  inserting: boolean;
  insertingAny: boolean;
  onInsert: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `myblock-browser-drag-${block.id}`,
    data: { blockId: block.id, source: "browser" as const },
  });

  return (
    <div
      ref={setNodeRef}
      data-testid={`my-block-browser-card-${block.id}`}
      className={`group relative flex flex-col rounded-xl border border-border bg-secondary p-2 transition-all duration-200 hover:border-accent/40 hover:bg-card ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="relative mb-1.5">
        <MyBlockThumb block={block} height={72} />
      </div>
      <div className="flex items-start justify-between gap-1">
        <h4 className="min-w-0 flex-1 truncate text-xs font-semibold text-text-primary" title={block.name}>
          {block.name}
        </h4>
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag ${block.name} onto the page`}
          data-testid={`my-block-browser-drag-${block.id}`}
          className="flex h-6 w-6 flex-none cursor-grab touch-none items-center justify-center rounded-md text-text-dim/60 transition-colors hover:bg-card hover:text-text-primary active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-0.5 text-[10px] text-text-dim">
        {block.previewMetadata.blockCount} blocks
      </p>
      <button
        type="button"
        data-testid={`my-block-browser-add-${block.id}`}
        onClick={onInsert}
        disabled={insertingAny}
        className="mt-2 flex-1 rounded-lg bg-accent/10 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20 active:scale-95 disabled:opacity-50"
      >
        {inserting ? "Adding…" : "Insert"}
      </button>
    </div>
  );
}
