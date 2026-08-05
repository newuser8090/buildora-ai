"use client";

// ---------------------------------------------------------------------------
// useCodeImport — the Import Studio orchestration hook
//
// Responsibilities:
//   - analyse pasted source (P1) + convert (P2) with stale-token guarding
//   - build source metadata (hash only — never the pasted source)
//   - insert through the canonical insertImportedBlockTree service
//   - post-insert actions (select section, open Blocks tab, scroll into view)
//   - retry / cancel / user-safe errors
//
// No parsing or conversion logic is duplicated here — everything delegates to
// the P1/P2 pipeline and the Phase P3 services.
// ---------------------------------------------------------------------------

import { useCallback } from "react";
import { analyseImportSource } from "../analysis/analyse-import-source";
import { convertImportAnalysis } from "../conversion/converter-orchestrator";
import type { ImportedCodeLanguage } from "../types";
import { useCodeImportStore } from "../store/code-import-store";
import { hashSource } from "../services/source-hash";
import {
  insertImportedBlockTree,
  type ImportPlacement,
} from "../services/insert-imported-block-tree";
import { buildSourceMetadata } from "../schemas/custom-block-schema";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useEditorUiStore } from "@/features/editor/ui/editor-ui-store";
import { scrollSectionIntoView } from "@/features/editor/utils/scroll-section-into-view";
import { CONVERTER_VERSION } from "../schemas/custom-block-schema";
import type { BlockTree } from "@/features/blocks/types";

/** Fired after a successful import so surfaces (status bar etc.) can react. */
export const IMPORT_COMPLETE_EVENT = "buildora:import-complete";

export interface ImportCompleteDetail {
  sectionId: string;
  pageId: string;
  name: string;
  blockCount: number;
}

/** Friendly display name for an imported design (root name or default). */
export function importDisplayName(tree: BlockTree): string {
  const root = tree.rootIds[0] ? tree.nodes[tree.rootIds[0]] : undefined;
  const name = root?.props.name;
  if (typeof name === "string" && name.trim().length > 0) return name.trim();
  return "Imported design";
}

export function useCodeImport() {
  const open = useCodeImportStore((s) => s.open);

  /** Run P1 analysis + P2 conversion for the current source. */
  const analyse = useCallback(
    (source: string, languageHint?: ImportedCodeLanguage | null) => {
      const token = useCodeImportStore.getState().beginAnalysis();
      // Both stages are pure and synchronous — no async races, but the token
      // still guards future async analysis runs from stale completions.
      const analysis = analyseImportSource({ source, languageHint: languageHint ?? undefined });
      const outcome = convertImportAnalysis(analysis);
      useCodeImportStore.getState().completeAnalysis(
        token,
        analysis,
        outcome.ok ? outcome.value : null,
        outcome.ok ? null : outcome.error,
      );
    },
    [],
  );

  /** Insert the converted tree at the chosen placement. */
  const insert = useCallback(() => {
    const state = useCodeImportStore.getState();
    if (state.status !== "ready" || !state.conversion || !state.placement) return false;
    if (!state.beginInsert()) return false;

    const store = useEditorStore.getState();
    const tree = state.conversion.tree;
    const name = importDisplayName(tree);

    const sourceMetadata = buildSourceMetadata({
      language: state.conversion.report.detectedFramework === "react-jsx"
        ? "jsx"
        : state.conversion.report.detectedFramework === "css"
          ? "css"
          : state.conversion.report.detectedFramework === "tailwind"
            ? "html"
            : (state.conversion.report.detectedFramework as ImportedCodeLanguage),
      sourceHash: hashSource(state.source),
      warningCount: state.conversion.report.warnings.length,
      converterVersion: CONVERTER_VERSION,
    });

    const result = insertImportedBlockTree({
      projectId: store.project.id,
      placement: state.placement,
      tree,
      name,
      sourceMetadata,
    });

    if (!result.ok) {
      useCodeImportStore.getState().failInsert(result.error.message);
      return false;
    }

    useCodeImportStore.getState().completeInsert();

    // ---- Post-insert actions ----
    useEditorStore.getState().selectSection(result.sectionId);
    useEditorUiStore.getState().setRightSidebarTab("blocks");
    window.setTimeout(() => scrollSectionIntoView(result.sectionId, { block: "center" }), 0);

    window.dispatchEvent(
      new CustomEvent<ImportCompleteDetail>(IMPORT_COMPLETE_EVENT, {
        detail: {
          sectionId: result.sectionId,
          pageId: result.pageId,
          name,
          blockCount: Object.keys(tree.nodes).length,
        },
      }),
    );
    return true;
  }, []);

  /** Re-run analysis with the current source (after a parse failure). */
  const retry = useCallback(() => {
    const state = useCodeImportStore.getState();
    if (state.source.trim().length === 0) return;
    analyse(state.source, state.languageHint);
  }, [analyse]);

  /** Close the dialog and reset transient state. */
  const cancel = useCallback(() => {
    useCodeImportStore.getState().closeDialog();
  }, []);

  return {
    open,
    analyse,
    insert,
    retry,
    cancel,
    /** Place the converted tree (review → placement). */
    choosePlacement: (placement: ImportPlacement) => {
      useCodeImportStore.getState().setPlacement(placement);
      useCodeImportStore.getState().setStep("place");
    },
  };
}
