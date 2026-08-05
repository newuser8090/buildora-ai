"use client";

// ---------------------------------------------------------------------------
// ImportConfidenceBadge — how well Buildora understood the pasted code.
// Text + icon based (never color-only): accessible and beginner friendly.
// ---------------------------------------------------------------------------

import { ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";
import { cn } from "@/utils/cn";

export type ConfidenceLevel = "high" | "medium" | "low";

export function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= 0.8) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

const LEVEL_LABELS: Record<ConfidenceLevel, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

const LEVEL_HINTS: Record<ConfidenceLevel, string> = {
  high: "Buildora understood most of this design.",
  medium: "Some parts were changed or left out — check the notes.",
  low: "A lot was changed or left out — review before adding.",
};

export function ImportConfidenceBadge({
  score,
  showDetail = true,
}: {
  score: number;
  showDetail?: boolean;
}) {
  const level = confidenceLevel(score);
  const Icon =
    level === "high" ? ShieldCheck : level === "medium" ? ShieldAlert : ShieldQuestion;

  return (
    <div
      data-testid="import-confidence"
      data-confidence={level}
      className={cn(
        "flex items-start gap-2 rounded-xl border p-3",
        level === "high" && "border-emerald-500/25 bg-emerald-500/5",
        level === "medium" && "border-amber-500/25 bg-amber-500/5",
        level === "low" && "border-orange-500/25 bg-orange-500/5",
      )}
    >
      <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-card">
        <Icon className="h-4 w-4 text-text-muted" aria-hidden="true" />
      </span>
      <span>
        <span className="block text-xs font-semibold text-text-primary">
          {LEVEL_LABELS[level]}
          {showDetail && (
            <span className="ml-1.5 font-normal text-text-dim">
              {Math.round(score * 100)}%
            </span>
          )}
        </span>
        {showDetail && (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-text-muted">
            {LEVEL_HINTS[level]}
          </span>
        )}
      </span>
    </div>
  );
}
