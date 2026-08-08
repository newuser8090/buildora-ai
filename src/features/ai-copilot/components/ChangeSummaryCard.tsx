"use client";

import { CheckCircle2, Undo2 } from "lucide-react";
import type { CopilotAppliedSummary } from "../types";

interface ChangeSummaryCardProps {
  summary: CopilotAppliedSummary;
  canUndo: boolean;
  onUndo: () => void;
}

export function ChangeSummaryCard({ summary, canUndo, onUndo }: ChangeSummaryCardProps) {
  return (
    <div
      data-testid="copilot-change-summary"
      className="mb-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.05] p-3.5"
    >
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
        <h3 className="flex-1 text-sm font-semibold text-text-primary">
          Done — updated {summary.applied} thing{summary.applied === 1 ? "" : "s"}
        </h3>
        {summary.skipped > 0 && (
          <span className="text-[10px] text-text-dim">{summary.skipped} skipped</span>
        )}
      </div>
      <ul className="mt-2 flex flex-col gap-1">
        {summary.opLabels.map((label, i) => (
          <li key={i} className="flex items-center gap-1.5 text-xs text-text-muted">
            <span className="h-1 w-1 rounded-full bg-emerald-400/70" />
            {label}
          </li>
        ))}
      </ul>
      <button
        type="button"
        data-testid="copilot-undo"
        onClick={onUndo}
        disabled={!canUndo}
        className="mt-3 flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text-muted transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Undo2 className="h-3.5 w-3.5" />
        Undo this change
      </button>
    </div>
  );
}
