// ---------------------------------------------------------------------------
// Universal Block Import (Phase P2) — converter orchestrator
//
// Public Phase P2 entry points:
//   convertImportAnalysis(analysis, options) — convert a P1 analysis
//   convertImportedSource(source, options)   — analyse + convert in one step
//
// Both are deterministic, never execute imported code, and always produce a
// BlockTree that passes the Phase O validateTree invariants (nesting rules,
// id consistency, acyclicity). Failures are structured ConversionErrors.
// ---------------------------------------------------------------------------

import {
  isDefaultBlocksRegistered,
  registerDefaultBlocks,
} from "../../blocks/registry/block-registry";
import { validateTree } from "../../blocks/engine/nesting-rules";
import { allNodes } from "../../blocks/engine/tree-traversal";
import type { BlockTree } from "../../blocks/types";
import { analyseImportSource } from "../analysis/analyse-import-source";
import type { CodeImportAnalysis, CodeImportSource } from "../types";
import { convertImportNodes } from "./node-converter";
import {
  createConversionContext,
  foldAnalysisIntoReport,
  type ConversionReport,
} from "./conversion-report";
import {
  createConversionError,
  createConversionIdFactory,
  ConversionFatalError,
  type ConversionError,
  type ConversionIdFactory,
} from "./conversion-errors";

export interface ConversionOptions {
  idFactory?: ConversionIdFactory;
}

export interface ConversionSuccess {
  tree: BlockTree;
  report: ConversionReport;
}

export type ConversionOutcome =
  | { ok: true; value: ConversionSuccess }
  | { ok: false; error: ConversionError };

/** Convert a P1 analysis into an editable BlockTree + report. */
export function convertImportAnalysis(
  analysis: CodeImportAnalysis,
  options: ConversionOptions = {},
): ConversionOutcome {
  try {
    return convertAnalysisUnchecked(analysis, options);
  } catch (err) {
    if (err instanceof ConversionFatalError) {
      return { ok: false, error: err.error };
    }
    return {
      ok: false,
      error: createConversionError(
        "UNKNOWN_CONVERSION_ERROR",
        "Conversion failed unexpectedly.",
        err instanceof Error ? err.message : undefined,
      ),
    };
  }
}

/** Analyse a pasted source (P1) and convert it (P2) in one step. */
export function convertImportedSource(
  input: CodeImportSource | string,
  options: ConversionOptions = {},
): ConversionOutcome {
  const analysis = analyseImportSource(input);
  return convertImportAnalysis(analysis, options);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function convertAnalysisUnchecked(
  analysis: CodeImportAnalysis,
  options: ConversionOptions,
): ConversionOutcome {
  // The converter reads the shared Phase O registry. Ensure the default block
  // catalogue is present (idempotent — the app also registers it at startup).
  if (!isDefaultBlocksRegistered()) {
    registerDefaultBlocks();
  }

  const context = createConversionContext(
    analysis,
    options.idFactory ?? createConversionIdFactory(),
  );

  if (!analysis.canContinueToConversion) {
    return {
      ok: false,
      error: createConversionError(
        "CONVERSION_NOT_ALLOWED",
        "Analysis did not produce a usable AST, so nothing was converted.",
      ),
    };
  }

  foldAnalysisIntoReport(analysis, context.report);

  // ---- CSS-only import: nothing to convert into blocks ----
  if (analysis.rootNodes.length === 0) {
    if (analysis.cssRules.length > 0) {
      context.report.warn(
        "css-only-import",
        "CSS-only import: styles were analysed but no blocks were converted.",
      );
      const report = context.report.finalize(analysis.detectedLanguage, 0, 0, {});
      return { ok: true, value: { tree: { rootIds: [], nodes: {} }, report } };
    }
    return {
      ok: false,
      error: createConversionError(
        "NO_CONVERTIBLE_CONTENT",
        "The analysis contains no markup to convert into blocks.",
      ),
    };
  }

  // ---- Convert (every block is returned in creation order) ----
  const blocks = convertImportNodes(analysis.rootNodes, context);
  const roots = blocks.filter((block) => block.parentId === null);

  if (roots.length === 0) {
    return {
      ok: false,
      error: createConversionError(
        "NO_CONVERTIBLE_CONTENT",
        "No blocks could be produced from the analysed markup.",
      ),
    };
  }

  const tree: BlockTree = {
    rootIds: roots.map((root) => root.id),
    nodes: Object.fromEntries(blocks.map((block) => [block.id, block])),
  };

  // ---- Validate the output against the Phase O engine ----
  const validation = validateTree(tree);
  if (!validation.valid) {
    return {
      ok: false,
      error: createConversionError(
        "INVALID_OUTPUT_TREE",
        "The converted block tree failed validation.",
        validation.problems[0].message,
      ),
    };
  }

  const blockTypeCounts: Record<string, number> = {};
  for (const node of allNodes(tree)) {
    blockTypeCounts[node.type] = (blockTypeCounts[node.type] ?? 0) + 1;
  }

  const report = context.report.finalize(
    analysis.detectedLanguage,
    Object.keys(tree.nodes).length,
    tree.rootIds.length,
    blockTypeCounts,
  );

  return { ok: true, value: { tree, report } };
}
