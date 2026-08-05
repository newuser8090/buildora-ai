"use client";

// ---------------------------------------------------------------------------
// CodeReviewStep — Step 3 of the Import Studio.
// Two synchronized previews of the native converted blocks, selection
// inspection, grouped warnings, and the conversion-mode choice.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, LayoutGrid, ListTree, ImageOff } from "lucide-react";
import { cn } from "@/utils/cn";
import { Button } from "@/components/ui/Button";
import { useCodeImportStore } from "../store/code-import-store";
import { ImportTreePreview } from "./ImportTreePreview";
import { ImportVisualPreview } from "./ImportVisualPreview";
import { ImportWarningsPanel } from "./ImportWarningsPanel";
import { ImportConfidenceBadge } from "./ImportConfidenceBadge";
import { filterSupportedOnly } from "../services/placeholder-filter";
import { friendlyBlockLabel } from "../presentation/import-summary-builder";
import { allNodes } from "@/features/blocks/engine/tree-traversal";
import { isSafeImageUrl } from "@/features/blocks/render/BlockRenderer";
import type { BlockNode } from "@/features/blocks/types";

export function CodeReviewStep({
  onContinue,
  onBack,
}: {
  onContinue: () => void;
  onBack: () => void;
}) {
  const conversion = useCodeImportStore((s) => s.conversion);
  const analysis = useCodeImportStore((s) => s.analysis);
  const selectedPreviewBlockId = useCodeImportStore((s) => s.selectedPreviewBlockId);
  const setSelectedPreviewBlock = useCodeImportStore((s) => s.setSelectedPreviewBlock);
  const conversionMode = useCodeImportStore((s) => s.conversionMode);
  const setConversionMode = useCodeImportStore((s) => s.setConversionMode);

  const [previewTab, setPreviewTab] = useState<"tree" | "visual">("visual");

  const shown = useMemo(() => {
    if (!conversion) return null;
    if (conversionMode === "supported-only") {
      return filterSupportedOnly(conversion.tree);
    }
    return { tree: conversion.tree, removed: 0 };
  }, [conversion, conversionMode]);

  const unresolvedAssets = useMemo(() => {
    if (!shown) return 0;
    let count = 0;
    for (const node of allNodes(shown.tree)) {
      if (node.type === "image" || node.type === "video") {
        if (!isSafeImageUrl(node.props.src)) count += 1;
      }
    }
    return count;
  }, [shown]);

  if (!conversion || !shown) {
    return (
      <p className="py-8 text-center text-sm text-text-dim">
        Nothing to review yet.
      </p>
    );
  }

  const report = conversion.report;
  const selectedNode = selectedPreviewBlockId
    ? shown.tree.nodes[selectedPreviewBlockId]
    : undefined;

  return (
    <div className="flex flex-col gap-4" data-testid="review-step">
      {/* Confidence + mode */}
      <div className="flex flex-col gap-3">
        <ImportConfidenceBadge score={report.confidence} />
        <fieldset data-testid="conversion-mode">
          <legend className="mb-1 text-xs font-semibold text-text-dim">
            What should be added?
          </legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <ModeOption
              id="everything"
              checked={conversionMode === "everything"}
              title="Convert everything supported"
              description="Keeps placeholder boxes for parts that need running code."
              onChange={() => setConversionMode("everything")}
            />
            <ModeOption
              id="supported-only"
              checked={conversionMode === "supported-only"}
              title="Supported parts only"
              description="Skips empty placeholder boxes from parts that couldn't be converted."
              onChange={() => setConversionMode("supported-only")}
            />
          </div>
        </fieldset>
      </div>

      {/* Preview tab toggle (tablet/mobile) */}
      <div className="flex items-center gap-1 rounded-lg bg-secondary p-1 sm:hidden">
        <PreviewTabButton
          active={previewTab === "visual"}
          onClick={() => setPreviewTab("visual")}
          icon={<LayoutGrid className="h-3.5 w-3.5" />}
          label="Preview"
        />
        <PreviewTabButton
          active={previewTab === "tree"}
          onClick={() => setPreviewTab("tree")}
          icon={<ListTree className="h-3.5 w-3.5" />}
          label="Build tree"
        />
      </div>

      {/* Previews */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className={cn("min-w-0", previewTab === "visual" ? "block" : "hidden sm:block")}>
          <ImportVisualPreview
            tree={shown.tree}
            selectedBlockId={selectedPreviewBlockId}
            onSelectBlock={setSelectedPreviewBlock}
          />
        </div>
        <div className={cn("min-w-0", previewTab === "tree" ? "block" : "hidden sm:block")}>
          <ImportTreePreview
            tree={shown.tree}
            warningCount={report.warnings.length}
            selectedBlockId={selectedPreviewBlockId}
            onSelectBlock={setSelectedPreviewBlock}
          />
        </div>
      </div>

      {/* Unresolved assets */}
      {unresolvedAssets > 0 && (
        <div
          data-testid="unresolved-assets"
          className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-200"
        >
          <ImageOff className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
          <span>
            {unresolvedAssets} image{unresolvedAssets === 1 ? "" : "s"} could not be
            preserved and will appear as placeholders. You can replace them
            after adding.
          </span>
        </div>
      )}

      {/* Selection inspection */}
      {selectedNode && <BlockInspection node={selectedNode} />}

      {/* Warnings */}
      <ImportWarningsPanel report={report} analysis={analysis} />

      {/* Actions */}
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
        <Button
          type="button"
          size="md"
          data-testid="review-continue"
          onClick={onContinue}
        >
          Choose where to place it
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function ModeOption({
  id,
  checked,
  title,
  description,
  onChange,
}: {
  id: string;
  checked: boolean;
  title: string;
  description: string;
  onChange: () => void;
}) {
  return (
    <label
      data-testid={`mode-${id}`}
      className={cn(
        "flex cursor-pointer items-start gap-2 rounded-xl border p-3 transition-colors",
        checked
          ? "border-accent/50 bg-accent/5"
          : "border-border bg-secondary hover:bg-card",
      )}
    >
      <input
        type="radio"
        name="conversion-mode"
        value={id}
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent,#7c5cfc)]"
      />
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-text-primary">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-text-muted">
          {description}
        </span>
      </span>
    </label>
  );
}

function PreviewTabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors",
        active ? "bg-card text-text-primary shadow-sm" : "text-text-dim",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function BlockInspection({ node }: { node: BlockNode }) {
  const props = Object.entries(node.props).filter(
    ([key, value]) =>
      !key.startsWith("_") &&
      (typeof value === "string" || typeof value === "number" || typeof value === "boolean"),
  );
  return (
    <div
      data-testid="block-inspection"
      className="rounded-xl border border-border bg-secondary p-3"
    >
      <h3 className="text-xs font-semibold text-text-primary">
        {friendlyBlockLabel(node.type)}
        <span className="ml-1.5 font-normal text-text-dim">{node.type}</span>
      </h3>
      {props.length > 0 ? (
        <dl className="mt-2 grid grid-cols-1 gap-1">
          {props.slice(0, 6).map(([key, value]) => (
            <div key={key} className="flex items-baseline gap-2 text-[11px]">
              <dt className="w-20 flex-none text-text-dim">{key}</dt>
              <dd className="min-w-0 truncate text-text-muted">{String(value)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-1 text-[11px] text-text-muted">
          This block holds other blocks.
        </p>
      )}
      <p className="mt-2 text-[10px] leading-relaxed text-text-dim/70">
        This is how the part appears in your editor — you can move, restyle and
        edit it like any other block.
      </p>
    </div>
  );
}
