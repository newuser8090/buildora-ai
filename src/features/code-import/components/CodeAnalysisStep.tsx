"use client";

// ---------------------------------------------------------------------------
// CodeAnalysisStep — Step 2 of the Import Studio.
// Shows what Buildora detected in plain language: found components, block
// count, removed-for-safety count, and the confidence badge.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { CheckCircle2, ArrowRight, RefreshCw, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useCodeImportStore } from "../store/code-import-store";
import { buildFriendlyImportSummary } from "../presentation/import-summary-builder";
import { groupWarnings } from "../services/warning-grouping";
import { ImportConfidenceBadge } from "./ImportConfidenceBadge";
import { useCodeImport } from "../hooks/useCodeImport";

export function CodeAnalysisStep({
  onContinue,
  onBack,
}: {
  onContinue: () => void;
  onBack: () => void;
}) {
  const status = useCodeImportStore((s) => s.status);
  const analysis = useCodeImportStore((s) => s.analysis);
  const conversion = useCodeImportStore((s) => s.conversion);
  const conversionError = useCodeImportStore((s) => s.conversionError);
  const error = useCodeImportStore((s) => s.error);
  const { retry } = useCodeImportRetry();

  const summary = useMemo(
    () => (conversion ? buildFriendlyImportSummary(conversion.tree, { cap: 8 }) : null),
    [conversion],
  );

  if (status === "analysing" || !analysis) {
    return (
      <div className="flex flex-col items-center gap-4 py-10" data-testid="analysis-loading">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <p className="text-sm text-text-muted">Analysing your code…</p>
      </div>
    );
  }

  if (!conversion) {
    const detail = conversionError?.detail
      ? ` (${conversionError.detail})`
      : "";
    return (
      <div
        role="alert"
        data-testid="analysis-failed"
        className="flex flex-col items-start gap-4"
      >
        <p className="text-sm leading-relaxed text-text-primary">
          {error ?? "We couldn't turn this code into editable blocks."}
        </p>
        <p className="text-xs text-text-dim">{conversionError?.code}{detail}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to code
          </Button>
          <Button variant="secondary" size="sm" onClick={retry}>
            <RefreshCw className="h-3.5 w-3.5" />
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const report = conversion.report;
  const grouping = groupWarnings({ report, analysis });
  const removedCount = grouping.groups.find((g) => g.id === "removed")?.items.length ?? 0;

  return (
    <div className="flex flex-col gap-4" data-testid="analysis-result">
      {/* Detected format */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-text-dim">We detected</p>
          <p className="text-sm font-semibold text-text-primary" data-testid="detected-format">
            {detectedFormatLabel(report.detectedFramework)}
          </p>
        </div>
        <div className="w-56">
          <ImportConfidenceBadge score={report.confidence} />
        </div>
      </div>

      {/* Friendly found list */}
      <div className="rounded-xl border border-border bg-secondary p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-dim">
          We found
        </h3>
        {summary && summary.items.length > 0 ? (
          <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {summary.items.map((item) => (
              <li key={item.label} data-testid={`found-${item.blockTypes[0]}`} className="flex items-center gap-2 text-sm text-text-primary">
                <CheckCircle2 className="h-4 w-4 flex-none text-emerald-400" aria-hidden="true" />
                {item.displayLabel}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-text-muted">
            No blocks were produced — check the notes below.
          </p>
        )}
        {summary?.capped && (
          <p className="mt-2 text-[11px] text-text-dim">
            Showing the first {summary.items.length} — there are more.
          </p>
        )}
        <p className="mt-3 border-t border-border/60 pt-2 text-[11px] leading-relaxed text-text-dim">
          {report.convertedBlockCount} editable block{report.convertedBlockCount === 1 ? "" : "s"} ·{" "}
          {removedCount} removed for safety · {grouping.total - removedCount} change{grouping.total - removedCount === 1 ? "" : "s"} to review
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Change code
        </Button>
        <Button
          type="button"
          size="md"
          data-testid="analysis-continue"
          onClick={onContinue}
        >
          Review and place
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function detectedFormatLabel(framework: string): string {
  switch (framework) {
    case "html":
      return "HTML";
    case "react-jsx":
      return "React / JSX";
    case "tailwind":
      return "HTML with Tailwind";
    case "css":
      return "CSS";
    default:
      return "Code";
  }
}

function useCodeImportRetry() {
  const { retry } = useCodeImport();
  return { retry };
}
