// ---------------------------------------------------------------------------
// GuidedStartScreen — "Let's build your homepage" (Phase N, spec §5)
//
// Shown in Guided mode for a new or nearly-blank homepage. Each option:
//   - explains what it does in one short sentence
//   - inserts through the real SectionFactory + editor store (one history entry)
//   - selects the inserted section and switches to the editing UI
//   - singleton sections already on the page are disabled ("Already added")
// ---------------------------------------------------------------------------

"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles, LayoutGrid, ClipboardPaste, BookMarked, FolderPlus } from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useEditorUiStore } from "@/features/editor/ui/editor-ui-store";
import { useMyBlocksUiStore } from "@/features/my-blocks/store/my-blocks-ui-store";
import { getMyBlocksAdapter } from "@/features/my-blocks/storage/my-blocks-singleton";
import type { MyBlockRecord } from "@/features/my-blocks/types";
import { useGuidedActions } from "../hooks/useGuidedActions";
import {
  getGuidedSectionExample,
  getGuidedSectionExplanation,
  getGuidedSectionLabel,
} from "../registry/guided-section-language";
import { isSingletonSectionType, type SectionType } from "@/features/editor/section-library/types";

interface StartBlock {
  sectionType: SectionType;
}

const START_BLOCKS: StartBlock[] = [
  { sectionType: "header" },
  { sectionType: "hero" },
  { sectionType: "features" },
  { sectionType: "faq" },
  { sectionType: "cta" },
  { sectionType: "footer" },
];

// ---------------------------------------------------------------------------
// RecentSavedPieces — deterministic "reuse it again" suggestions (Phase P5)
//
// Shows the three most recently updated saved blocks. Clicking one opens the
// placement picker (canonical insertion). Never AI-inferred; purely the
// library's own data. Loaded once on mount with unmount safety.
// ---------------------------------------------------------------------------

function RecentSavedPieces() {
  const [blocks, setBlocks] = useState<MyBlockRecord[] | null>(null);
  const openPlacementPicker = useMyBlocksUiStore((s) => s.openPlacementPicker);

  useEffect(() => {
    let cancelled = false;
    getMyBlocksAdapter()
      .listMyBlocks()
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) return;
        const top = [...result.value]
          .sort(
            (a, b) =>
              b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
          )
          .slice(0, 3);
        setBlocks(top);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!blocks || blocks.length === 0) return null;

  return (
    <div className="mt-6 text-left" data-testid="guided-recent-pieces">
      <p className="text-xs font-medium text-text-dim">
        Use something you saved before
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {blocks.map((block) => (
          <button
            key={block.id}
            type="button"
            data-testid={`guided-recent-piece-${block.id}`}
            onClick={() => openPlacementPicker(block)}
            title="Drag this where you want it, or choose a spot."
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium text-text-primary transition-all duration-200 hover:border-accent/40 hover:bg-card active:scale-95"
          >
            <BookMarked className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            <span className="max-w-[160px] truncate">{block.name}</span>
            <span className="text-[10px] text-text-dim">
              {block.previewMetadata.blockCount} blocks
            </span>
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] text-text-dim/70">
        Use this again on another page, or drag it straight onto the canvas.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CollectionSuggestion — deterministic hint after several saved blocks
// ---------------------------------------------------------------------------

function CollectionSuggestion() {
  const [suggestion, setSuggestion] = useState<{
    blocks: number;
    collections: number;
  } | null>(null);
  const openCreateCollection = useMyBlocksUiStore((s) => s.openCreateCollection);

  useEffect(() => {
    let cancelled = false;
    const adapter = getMyBlocksAdapter();
    void Promise.all([adapter.listMyBlocks(), adapter.listMyBlockCollections()]).then(
      ([blocks, collections]) => {
        if (cancelled) return;
        if (blocks.ok && collections.ok) {
          setSuggestion({
            blocks: blocks.value.length,
            collections: collections.value.length,
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (!suggestion || suggestion.blocks < 3 || suggestion.collections > 0) {
    return null;
  }

  return (
    <button
      type="button"
      data-testid="guided-collection-suggestion"
      onClick={openCreateCollection}
      className="mt-3 flex h-9 items-center gap-2 rounded-lg border border-dashed border-accent/30 bg-accent/5 px-4 text-xs font-medium text-accent transition-all duration-200 hover:border-accent/60 hover:bg-accent/10 active:scale-95"
    >
      <FolderPlus className="h-4 w-4" aria-hidden="true" />
      You have {suggestion.blocks} saved pieces — group them with a collection
    </button>
  );
}

export function GuidedStartScreen({
  pageId,
  existingSectionIds,
  compact = false,
}: {
  pageId: string;
  existingSectionIds: ReadonlySet<string>;
  compact?: boolean;
}) {
  const pages = useEditorStore((s) => s.project.pages);
  // Reference-stable selector + memoized set (a fresh Set per render would
  // cause infinite re-renders with zustand's Object.is comparison).
  const existingTypes = useMemo(() => {
    const page = pages.find((p) => p.id === pageId);
    return new Set((page?.sections ?? []).map((sec) => sec.type));
  }, [pages, pageId]);
  const { addBlock, browseBlocks, askAi } = useGuidedActions();

  const openImport = () => {
    // Phase P3 — "Bring your own design" opens the shared Import Studio.
    useEditorUiStore.getState().openCodeImportDialog({ pageId });
  };

  const handleAdd = (sectionType: SectionType) => {
    const ids = existingSectionIds;
    void addBlock(pageId, sectionType, { type: "end" }, ids);
  };

  if (compact) {
    return (
      <div
        data-testid="guided-start-screen"
        className="flex flex-wrap items-center justify-center gap-2 py-2"
      >
        {START_BLOCKS.map((block) => {
          const added = existingTypes.has(block.sectionType);
          const disabled = isSingletonSectionType(block.sectionType) && added;
          return (
            <button
              key={block.sectionType}
              type="button"
              data-testid={`guided-start-${block.sectionType}`}
              disabled={disabled}
              onClick={() => handleAdd(block.sectionType)}
              title={getGuidedSectionExplanation(block.sectionType)}
              className="flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-card/80 px-3 text-xs font-medium text-text-primary transition-all duration-200 hover:border-accent/40 hover:bg-card active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Sparkles className="h-3 w-3 text-accent" />
              {getGuidedSectionLabel(block.sectionType)}
            </button>
          );
        })}
        <button
          type="button"
          data-testid="guided-start-import"
          onClick={openImport}
          className="flex h-8 items-center gap-1.5 rounded-full border border-dashed border-accent/40 bg-accent/5 px-3 text-xs font-medium text-text-primary transition-all duration-200 hover:border-accent/60 hover:bg-accent/10 active:scale-95"
        >
          <ClipboardPaste className="h-3 w-3 text-accent" />
          Bring your own design
        </button>
        <button
          type="button"
          data-testid="guided-start-my-blocks-compact"
          title="Reuse designs you saved earlier."
          onClick={() => useMyBlocksUiStore.getState().openLibrary()}
          className="flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-card/80 px-3 text-xs font-medium text-text-primary transition-all duration-200 hover:border-accent/40 hover:bg-card active:scale-95"
        >
          <BookMarked className="h-3 w-3 text-accent" />
          My saved pieces
        </button>
        <button
          type="button"
          data-testid="guided-start-browse"
          onClick={() => browseBlocks()}
          className="flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-card/80 px-3 text-xs font-medium text-text-primary transition-all duration-200 hover:border-accent/40 hover:bg-card active:scale-95"
        >
          <LayoutGrid className="h-3 w-3 text-accent" />
          Browse all blocks
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="guided-start-screen"
      className="mx-auto w-full max-w-2xl rounded-2xl border border-dashed border-accent/30 bg-card/50 px-6 py-8 text-center"
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">
        Let&rsquo;s build your homepage
      </p>
      <p className="mt-1 text-sm text-text-muted">
        Start with one piece — you can add or change anything later.
      </p>

      <RecentSavedPieces />

      <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {START_BLOCKS.map((block) => {
          const added = existingTypes.has(block.sectionType);
          const disabled = isSingletonSectionType(block.sectionType) && added;
          return (
            <button
              key={block.sectionType}
              type="button"
              data-testid={`guided-start-${block.sectionType}`}
              disabled={disabled}
              onClick={() => handleAdd(block.sectionType)}
              className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all duration-200 active:scale-[0.98] ${
                disabled
                  ? "cursor-not-allowed border-border/30 opacity-45"
                  : "border-border/50 bg-card hover:border-accent/40 hover:bg-card"
              }`}
            >
              <span className="text-sm font-semibold text-text-primary">
                {getGuidedSectionLabel(block.sectionType)}
                {added && (
                  <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-text-dim/60">
                    Already added
                  </span>
                )}
              </span>
              <span className="text-xs leading-relaxed text-text-muted">
                {getGuidedSectionExample(block.sectionType)}
              </span>
            </button>
          );
        })}
      </div>

      <CollectionSuggestion />

      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          data-testid="guided-start-import"
          onClick={openImport}
          title="Paste something you found or created elsewhere, and Buildora will turn the parts it understands into editable building blocks."
          className="flex h-9 items-center gap-2 rounded-lg border border-dashed border-accent/40 bg-accent/5 px-4 text-sm font-medium text-text-primary transition-all duration-200 hover:border-accent/60 hover:bg-accent/10 active:scale-95"
        >
          <ClipboardPaste className="h-4 w-4 text-accent" />
          Bring your own design
        </button>
        <button
          type="button"
          data-testid="guided-start-my-blocks"
          title="Reuse designs you saved earlier."
          onClick={() => useMyBlocksUiStore.getState().openLibrary()}
          className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium text-text-primary transition-all duration-200 hover:bg-base active:scale-95"
        >
          <BookMarked className="h-4 w-4 text-accent" />
          My saved pieces
        </button>
        <button
          type="button"
          data-testid="guided-start-browse"
          onClick={() => browseBlocks()}
          className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium text-text-primary transition-all duration-200 hover:bg-base active:scale-95"
        >
          <LayoutGrid className="h-4 w-4 text-accent" />
          Browse building blocks
        </button>
        <button
          type="button"
          data-testid="guided-start-ask-ai"
          onClick={() => askAi("create")}
          className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium text-text-primary transition-all duration-200 hover:bg-base active:scale-95"
        >
          <Sparkles className="h-4 w-4 text-accent" />
          Ask AI to build a starting point
        </button>
      </div>
    </div>
  );
}
