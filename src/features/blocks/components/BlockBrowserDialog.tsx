"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { Search, Star, X, Sparkles } from "lucide-react";
import { blockRegistry } from "@/features/blocks/registry/block-registry";
import { blockCategoryOf, type BlockType } from "../types";
import { useBlockEditorStore } from "../store/block-editor-store";
import { useBlockOperations } from "../hooks/useBlockOperations";
import { BlockIcon } from "./BlockIcon";
import { bindingsForSection } from "../adapters/section-block-adapter";
import { useEditorStore } from "@/features/editor/store/editor-store";

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

  if (!open || !target) return null;

  const insert = (type: BlockType) => {
    // insertBlock selects the new block; we keep that selection visible in
    // the inspector after the dialog closes.
    ops.insertBlock(type, target.parentId ?? target.sectionId);
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

        {/* Recents */}
        {recentBlockTypes.length > 0 && (
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

        {/* Grid */}
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
      </div>
    </div>
  );
}
