// ---------------------------------------------------------------------------
// useSuggestionActions — executes a BuilderSuggestion through real actions
//
// Every suggestion requires an explicit user click. Nothing is applied
// automatically. Adding a section goes through the validated SectionFactory
// + editor store (one history entry, autosave scheduled normally).
// ---------------------------------------------------------------------------

"use client";

import { useCallback } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useEditorUiStore } from "@/features/editor/ui/editor-ui-store";
import { useGuidedBuilderStore } from "../store/guided-builder-store";
import { useGuidedActions } from "./useGuidedActions";
import { EXPORT_SITE_EVENT } from "../constants";
import type { BuilderSuggestion } from "../types";
import type { SectionType } from "@/features/editor/section-library/types";

export function useSuggestionActions() {
  const { addBlock, browseBlocks, askAi } = useGuidedActions();
  const addPage = useEditorStore((s) => s.addPage);
  const selectSection = useEditorStore((s) => s.selectSection);
  const setRightSidebarTab = useEditorUiStore((s) => s.setRightSidebarTab);
  const setViewport = useEditorStore((s) => s.setViewport);
  const project = useEditorStore((s) => s.project);
  const selectedPageId = useEditorStore((s) => s.selectedPageId);
  const dismissSuggestion = useGuidedBuilderStore((s) => s.dismissSuggestion);
  const setHasPreviewedMobile = useGuidedBuilderStore(
    (s) => s.setHasPreviewedMobile,
  );
  const setHasExported = useGuidedBuilderStore((s) => s.setHasExported);

  const run = useCallback(
    (suggestion: BuilderSuggestion) => {
      const action = suggestion.action;
      const pageId = selectedPageId ?? project.pages[0]?.id ?? "";
      const visibleSectionIds = new Set(
        project.pages.flatMap((p) => p.sections).map((s) => s.id),
      );

      switch (action.kind) {
        case "add-section": {
          addBlock(pageId, action.sectionType as SectionType, { type: "end" }, visibleSectionIds);
          break;
        }
        case "edit-section": {
          const page = project.pages.find((p) => p.id === pageId);
          const existing = page?.sections.find(
            (s) => s.type === action.sectionType,
          );
          if (existing) {
            selectSection(existing.id);
            setRightSidebarTab("design");
          } else {
            browseBlocks({ initialType: action.sectionType });
          }
          break;
        }
        case "add-page": {
          addPage();
          break;
        }
        case "preview-mobile": {
          setViewport("mobile");
          setHasPreviewedMobile(true);
          break;
        }
        case "export-site": {
          setHasExported(true);
          window.dispatchEvent(new CustomEvent(EXPORT_SITE_EVENT));
          break;
        }
        case "open-blocks": {
          browseBlocks();
          break;
        }
      }
    },
    [
      selectedPageId,
      project,
      addBlock,
      browseBlocks,
      selectSection,
      setRightSidebarTab,
      addPage,
      setViewport,
      setHasPreviewedMobile,
      setHasExported,
    ],
  );

  const dismiss = useCallback(
    (suggestion: BuilderSuggestion) => {
      dismissSuggestion(suggestion.id);
    },
    [dismissSuggestion],
  );

  const askHelp = useCallback(() => {
    askAi("create");
  }, [askAi]);

  return { run, dismiss, askHelp };
}
