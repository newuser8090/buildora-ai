// ---------------------------------------------------------------------------
// useGuidedActions — guided builder action helpers
//
// All insertions go through the REAL editor store (insertSection) and the
// validated SectionFactory — one history entry, selection preserved, autosave
// scheduled by the normal controller subscription. Guidance never mutates the
// project any other way.
// ---------------------------------------------------------------------------

"use client";

import { useCallback } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useEditorUiStore } from "@/features/editor/ui/editor-ui-store";
import { SectionFactory } from "@/features/editor/section-library/services/section-factory";
import type { SectionType } from "@/features/editor/section-library/types";
import type { SectionInsertPosition } from "@/features/editor/store/section-structure";
import { useGuidedBuilderStore } from "../store/guided-builder-store";
import {
  AI_COMPOSER_FOCUS_EVENT,
  type AiComposerFocusDetail,
} from "../constants";

export function useGuidedActions() {
  const insertSection = useEditorStore((s) => s.insertSection);
  const selectSection = useEditorStore((s) => s.selectSection);
  const setRightSidebarTab = useEditorUiStore((s) => s.setRightSidebarTab);
  const requestAiComposerFocus = useGuidedBuilderStore(
    (s) => s.requestAiComposerFocus,
  );

  /** Create + insert a validated section at the given position. */
  const addBlock = useCallback(
    (
      pageId: string,
      sectionType: SectionType,
      position: SectionInsertPosition = { type: "end" },
      existingSectionIds: ReadonlySet<string> = new Set(),
    ): { ok: boolean; error?: string } => {
      const factory = new SectionFactory();
      const created = factory.create({
        type: sectionType,
        existingIds: existingSectionIds,
      });
      if (!created.ok) return { ok: false, error: created.error.message };

      const result = insertSection(pageId, created.section, position);
      if (!result.ok) return { ok: false, error: result.error.message };

      selectSection(created.section.id);
      setRightSidebarTab("design");
      return { ok: true };
    },
    [insertSection, selectSection, setRightSidebarTab],
  );

  /** Open the block browser (the shared AddSectionDialog) with an optional
   *  preselected insertion point. Single dialog — no duplicate state. */
  const browseBlocks = useCallback(
    (options?: { initialType?: string; position?: SectionInsertPosition }) => {
      useEditorUiStore
        .getState()
        .openAddSectionDialog({
          initialType: options?.initialType,
          initialPosition: options?.position,
        });
    },
    [],
  );

  /** Ask AI to help — focuses the sidebar composer in the given scope. */
  const askAi = useCallback(
    (scope: AiComposerFocusDetail["scope"] = "create") => {
      window.dispatchEvent(
        new CustomEvent<AiComposerFocusDetail>(AI_COMPOSER_FOCUS_EVENT, {
          detail: { scope },
        }),
      );
      requestAiComposerFocus();
    },
    [requestAiComposerFocus],
  );

  return { addBlock, browseBlocks, askAi };
}
