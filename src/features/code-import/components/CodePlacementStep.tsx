"use client";

// ---------------------------------------------------------------------------
// CodePlacementStep — Step 4 of the Import Studio.
// Choose where the imported design goes. The suggested spot is always first,
// invalid targets are disabled with an explanation, and the user is reminded
// that Buildora stores the editable result — not the original code.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Copy, Download, Check, MapPin, Sparkles } from "lucide-react";
import { cn } from "@/utils/cn";
import { Button } from "@/components/ui/Button";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useCodeImportStore } from "../store/code-import-store";
import { useCodeImport } from "../hooks/useCodeImport";
import { suggestPlacements, isPlacementValid, type PlacementOption } from "../services/placement-suggestions";
import type { ImportPlacement } from "../services/insert-imported-block-tree";

export function CodePlacementStep({
  onBack,
}: {
  onBack: () => void;
}) {
  const project = useEditorStore((s) => s.project);
  const selectedPageId = useEditorStore((s) => s.selectedPageId);
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);
  const conversion = useCodeImportStore((s) => s.conversion);
  const placement = useCodeImportStore((s) => s.placement);
  const setPlacement = useCodeImportStore((s) => s.setPlacement);
  const status = useCodeImportStore((s) => s.status);
  const error = useCodeImportStore((s) => s.error);
  const source = useCodeImportStore((s) => s.source);
  const insertionTarget = useCodeImportStore((s) => s.insertionTarget);
  const { insert } = useCodeImport();

  const pageId = selectedPageId ?? project.pages[0]?.id ?? "";

  const options = useMemo(() => {
    if (!conversion) return [] as PlacementOption[];
    return suggestPlacements({
      project,
      pageId,
      report: conversion.report,
      selectedSectionId,
      insertionTarget,
    });
  }, [project, pageId, conversion, selectedSectionId, insertionTarget]);

  // Default to the primary suggestion the first time this step renders.
  // Written in an effect (never during render): a render-phase store write
  // updates CodeImportDialog (a different component) mid-render, which React
  // flags as "Cannot update a component while rendering a different
  // component". The guard is idempotent — once placement is set it is never
  // overwritten, and reset happens when the dialog closes.
  const primary = options.find((o) => o.primary) ?? options[0];
  useEffect(() => {
    if (!placement && primary) {
      setPlacement(primaryToPlacement(primary));
    }
  }, [placement, primary, setPlacement]);

  const [copied, setCopied] = useState(false);
  const inserting = status === "inserting";

  const selected = placement;
  const selectedValid = selected ? isPlacementValid(project, selected) : { valid: false };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — no-op.
    }
  };

  const handleDownload = () => {
    const blob = new Blob([source], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "pasted-code.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="placement-step">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">
          Choose where to place it
        </h3>
        <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
          Your design is added as an editable part of your page. You can move
          it anywhere later.
        </p>
      </div>

      {/* Options */}
      <div className="flex flex-col gap-2" data-testid="placement-options">
        {options.map((option) => {
          const validity = isPlacementValid(project, optionToPlacement(option));
          const disabled = !validity.valid;
          const active = selected?.kind === option.kind &&
            (selected?.sectionId ?? null) === (option.sectionId ?? null) &&
            (selected?.parentBlockId ?? null) === (option.parentBlockId ?? null);
          return (
            <label
              key={option.id}
              data-testid={`placement-${option.id}`}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-xl border p-3 transition-colors",
                disabled && "cursor-not-allowed opacity-50",
                active ? "border-accent/50 bg-accent/5" : "border-border bg-secondary hover:bg-card",
              )}
            >
              <input
                type="radio"
                name="placement"
                checked={active}
                disabled={disabled}
                onChange={() => setPlacement(optionToPlacement(option))}
                className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent,#7c5cfc)]"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
                  {option.primary && (
                    <Sparkles className="h-3 w-3 text-accent" aria-hidden="true" />
                  )}
                  {option.label}
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-text-muted">
                  {disabled ? (option.disabledReason ?? validity.reason) : option.detail}
                </span>
                {option.suggestion && !disabled && (
                  <span className="mt-1 block rounded-lg bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent">
                    {option.suggestion}
                  </span>
                )}
              </span>
              {active && <Check className="h-4 w-4 flex-none text-accent" aria-hidden="true" />}
            </label>
          );
        })}
      </div>

      {/* Source retention note */}
      <div className="rounded-xl border border-border/60 bg-secondary px-3 py-2.5">
        <p className="text-[11px] leading-relaxed text-text-dim">
          Buildora stores the editable result, not the original pasted code.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy} data-testid="copy-original">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy original"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownload} data-testid="download-original">
            <Download className="h-3.5 w-3.5" />
            Download original
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" data-testid="insert-error" className="text-xs text-red-400">
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={inserting}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
        <Button
          type="button"
          size="md"
          data-testid="insert-button"
          disabled={!selected || !selectedValid.valid || !conversion || inserting}
          isLoading={inserting}
          onClick={() => insert()}
        >
          <MapPin className="h-4 w-4" />
          Convert and add
        </Button>
      </div>
    </div>
  );
}

function optionToPlacement(option: PlacementOption): ImportPlacement {
  return {
    kind: option.kind,
    pageId: option.pageId,
    sectionId: option.sectionId,
    parentBlockId: option.parentBlockId,
  };
}

function primaryToPlacement(option: PlacementOption): ImportPlacement {
  return optionToPlacement(option);
}
