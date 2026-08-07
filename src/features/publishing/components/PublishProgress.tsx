"use client";

// ---------------------------------------------------------------------------
// PublishProgress — truthful stage progress (Phase P7)
//
// Stages: Checking your site → Preparing files → Building → Publishing →
// Live. No fake percentages — each stage shows when it starts; the bar
// reflects the deterministic stage fraction from the provider.
// ---------------------------------------------------------------------------

import { Check } from "lucide-react";
import { usePublishingStore } from "../store/publishing-store";
import type { PublishStage } from "../types";

const STAGES: { id: PublishStage; label: string }[] = [
  { id: "checking", label: "Checking your site" },
  { id: "preparing", label: "Preparing files" },
  { id: "building", label: "Building" },
  { id: "publishing", label: "Publishing" },
  { id: "live", label: "Live" },
];

export function PublishProgress() {
  const progress = usePublishingStore((s) => s.progress);
  const currentStage: PublishStage = progress?.stage ?? "checking";
  const currentIndex = STAGES.findIndex((s) => s.id === currentStage);
  const fraction = progress?.fraction ?? 0;

  return (
    <div
      className="flex flex-col gap-4"
      role="status"
      aria-live="polite"
      data-testid="publish-progress"
    >
      <ol className="flex flex-col gap-3">
        {STAGES.map((stage, index) => {
          const done = index < currentIndex || currentStage === "live";
          const active = index === currentIndex && currentStage !== "live";
          return (
            <li key={stage.id} className="flex items-center gap-3">
              <span
                className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${
                  done
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : active
                      ? "bg-accent/15 text-accent"
                      : "bg-card text-text-dim/50"
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span
                className={`text-sm ${
                  done || active ? "text-text-primary" : "text-text-dim/50"
                }`}
              >
                {stage.label}
              </span>
              {active && (
                <span className="ml-auto h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
              )}
            </li>
          );
        })}
      </ol>

      <div className="h-1.5 overflow-hidden rounded-full bg-card">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300"
          style={{ width: `${Math.min(100, Math.round(fraction * 100))}%` }}
        />
      </div>
      <p className="text-xs text-text-dim" data-testid="publish-progress-message">
        {progress?.message ?? "Getting ready…"}
      </p>
    </div>
  );
}
