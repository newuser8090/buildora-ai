"use client";

// ---------------------------------------------------------------------------
// PlacementPickerDialog (Phase P5) — choose where a saved block goes
//
// Beginner-friendly options in plain language: Top of page, Above/Below the
// selected part, End of page, Inside the selected group, New page. Invalid
// choices are disabled with an explanation (validation lives in the canonical
// insertion service — the UI never re-implements insertion rules).
//
// Every choice routes through insertMyBlock → ONE atomic history entry, one
// Undo removes the whole copy.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, MousePointerClick } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ImportPlacement } from "@/features/code-import/services/insert-imported-block-tree";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useEditorUiStore } from "@/features/editor/ui/editor-ui-store";
import { scrollSectionIntoView } from "@/features/editor/utils/scroll-section-into-view";
import { CUSTOM_BLOCK_SECTION_TYPE } from "@/features/code-import/schemas/custom-block-schema";
import { getMyBlocksAdapter } from "../storage/my-blocks-singleton";
import { insertMyBlock } from "../services/insert-my-block";
import { useMyBlocksUiStore } from "../store/my-blocks-ui-store";

interface PlacementOption {
  id: string;
  label: string;
  description: string;
  placement: ImportPlacement;
  valid: boolean;
  reason?: string;
}

export function PlacementPickerDialog() {
  const block = useMyBlocksUiStore((s) => s.placementBlock);
  const close = useMyBlocksUiStore((s) => s.closePlacementPicker);
  const closeLibrary = useMyBlocksUiStore((s) => s.closeLibrary);
  const showToast = useMyBlocksUiStore((s) => s.showToast);
  const project = useEditorStore((s) => s.project);
  const selectedPageId = useEditorStore((s) => s.selectedPageId);
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);
  const selectSection = useEditorStore((s) => s.selectSection);
  const setRightSidebarTab = useEditorUiStore((s) => s.setRightSidebarTab);

  const [inserting, setInserting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!block) return;
    const prev = document.activeElement as HTMLElement | null;
    const raf = window.setTimeout(() => dialogRef.current?.focus(), 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !inserting) {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(raf);
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [block, inserting, close]);

  const options = useMemo<PlacementOption[]>(() => {
    if (!block) return [];
    const pageId = selectedPageId ?? project.pages[0]?.id;
    if (!pageId) return [];
    const page = project.pages.find((p) => p.id === pageId);
    const sections = page
      ? [...page.sections].sort((a, b) => a.order - b.order)
      : [];
    const firstSection = sections.find((s) => s.visible);
    const selected = sections.find((s) => s.id === selectedSectionId);

    const out: PlacementOption[] = [
      {
        id: "top",
        label: "Top of page",
        description: "Add as the first thing visitors see.",
        placement: firstSection
          ? { kind: "before-section", pageId, sectionId: firstSection.id }
          : { kind: "end-of-page", pageId },
        valid: true,
      },
      {
        id: "above",
        label: "Above selected part",
        description: "Right before the part you selected.",
        placement: selected
          ? { kind: "before-section", pageId, sectionId: selected.id }
          : { kind: "end-of-page", pageId },
        valid: !!selected,
        reason: selected ? undefined : "Select a part of the page first.",
      },
      {
        id: "below",
        label: "Below selected part",
        description: "Right after the part you selected.",
        placement: selected
          ? { kind: "after-section", pageId, sectionId: selected.id }
          : { kind: "end-of-page", pageId },
        valid: !!selected,
        reason: selected ? undefined : "Select a part of the page first.",
      },
      {
        id: "end",
        label: "End of page",
        description: "Add after everything already on the page.",
        placement: { kind: "end-of-page", pageId },
        valid: true,
      },
      {
        id: "inside",
        label: "Inside selected group",
        description: "Nest this piece inside an imported design you selected.",
        placement: selected
          ? {
              kind: "inside-custom-block",
              pageId,
              sectionId: selected.id,
              parentBlockId: selected.id,
            }
          : { kind: "end-of-page", pageId },
        valid: !!selected && selected.type === CUSTOM_BLOCK_SECTION_TYPE,
        reason: !selected
          ? "Select an imported design first."
          : selected.type !== CUSTOM_BLOCK_SECTION_TYPE
            ? "This piece cannot go inside a built-in layout — add it beside the section instead."
            : undefined,
      },
      {
        id: "new-page",
        label: "New page",
        description: "Create a new page that starts with this piece.",
        placement: { kind: "new-page", pageId },
        valid: true,
      },
    ];
    return out;
  }, [block, project, selectedPageId, selectedSectionId]);

  const handleChoose = useCallback(
    async (option: PlacementOption) => {
      if (!block || inserting) return;
      setInserting(true);
      const result = await insertMyBlock({
        projectId: project.id,
        blockId: block.id,
        placement: option.placement,
        adapter: getMyBlocksAdapter(),
      });
      setInserting(false);
      if (!result.ok) {
        showToast(result.error.message);
        return;
      }
      // Post-insert: select the inserted content, open the Blocks tab, scroll.
      selectSection(result.sectionId);
      setRightSidebarTab("blocks");
      window.setTimeout(
        () => scrollSectionIntoView(result.sectionId, { block: "center" }),
        0,
      );
      close();
      closeLibrary();
      showToast(`"${block.name}" added to your page`);
    },
    [block, inserting, project.id, selectSection, setRightSidebarTab, close, closeLibrary, showToast],
  );

  if (!block) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="placement-picker-title"
      data-testid="placement-picker-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget && !inserting) close();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl border border-border bg-base p-5 shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="placement-picker-title" className="text-sm font-semibold text-text-primary">
              Where should this go?
            </h3>
            <p className="mt-0.5 truncate text-xs text-text-dim" title={block.name}>
              {block.name} · {block.previewMetadata.blockCount} blocks
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            data-testid="placement-picker-close"
            disabled={inserting}
            onClick={close}
            className="flex h-7 w-7 flex-none items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid gap-1.5">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={!option.valid || inserting}
              data-testid={`placement-option-${option.id}`}
              onClick={() => void handleChoose(option)}
              title={option.reason}
              className={`group flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-all ${
                option.valid
                  ? "border-border bg-secondary hover:border-accent/40 hover:bg-card active:scale-[0.99]"
                  : "cursor-not-allowed border-border/50 bg-secondary/50 opacity-50"
              }`}
            >
              <span
                className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-lg ${
                  option.valid ? "bg-accent/10 text-accent" : "bg-card text-text-dim/50"
                }`}
              >
                <MousePointerClick className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-text-primary">
                  {option.label}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-text-dim">
                  {option.valid ? option.description : option.reason}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={close}
            disabled={inserting}
            data-testid="placement-picker-cancel"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
