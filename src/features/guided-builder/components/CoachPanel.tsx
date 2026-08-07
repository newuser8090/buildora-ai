// ---------------------------------------------------------------------------
// CoachPanel — proactive AI design coach (Phase N, spec §10)
//
// Deterministic checks only — never applies anything automatically. Each
// recommendation is a suggestion with explicit actions (Add it / Show
// examples / Ask AI / Dismiss). Dismissed items are filtered for the rest of
// the session. Plain language, explains why each recommendation helps.
// ---------------------------------------------------------------------------

"use client";

import { useCallback } from "react";
import { Lightbulb, X, Sparkles, LayoutGrid, Rocket } from "lucide-react";
import { useGuidedBuilder } from "../hooks/useGuidedBuilder";
import { useSuggestionActions } from "../hooks/useSuggestionActions";
import { useGuidedActions } from "../hooks/useGuidedActions";
import { useLaunchReadiness } from "@/features/launch-readiness/hooks/useLaunchReadiness";
import { useLaunchCenterStore } from "@/features/launch-readiness/store/launch-center-store";
import { usePreviewStore } from "@/features/preview/store/preview-store";
import type { BuilderSuggestion } from "../types";

function suggestionPrimaryLabel(suggestion: BuilderSuggestion): string {
  switch (suggestion.action.kind) {
    case "add-section":
      return "Add it";
    case "edit-section":
      return "Go to it";
    case "add-page":
      return "Add page";
    case "preview-mobile":
      return "Check it";
    case "export-site":
      return "Export now";
    case "open-blocks":
      return "Browse";
  }
}

export function CoachPanel() {
  const { recommendations, coachEnabled } = useGuidedBuilder();
  const { run, dismiss, askHelp } = useSuggestionActions();
  const { browseBlocks } = useGuidedActions();

  // Phase P7 — launch coach (deterministic; hook must stay above returns).
  const launchReadiness = useLaunchReadiness();

  const launchCard = (() => {
    const score = launchReadiness.score;
    if (score >= 75) {
      return {
        title: "Your site is ready to share",
        description:
          "Everything important checks out. Preview the whole site, then publish when you're ready.",
        action: "Open Launch Center",
        onRun: () => useLaunchCenterStore.getState().openLaunchCenter(),
      };
    }
    if (score >= 40) {
      return {
        title: "Almost there — check the details",
        description:
          "A few things are worth fixing before you go live. The Launch Center shows exactly what.",
        action: "See what's left",
        onRun: () => useLaunchCenterStore.getState().openLaunchCenter(),
      };
    }
    return {
      title: "Preview the whole site",
      description:
        "See your pages connected as one site — like a visitor would.",
      action: "Preview now",
      onRun: () => usePreviewStore.getState().openPreview("/"),
    };
  })();

  const handleExamples = useCallback(
    (suggestion: BuilderSuggestion) => {
      if (suggestion.action.kind === "add-section") {
        browseBlocks({ initialType: suggestion.action.sectionType });
      } else {
        browseBlocks();
      }
    },
    [browseBlocks],
  );

  if (!coachEnabled) return null;
  if (recommendations.length === 0) return null;

  return (
    <div
      data-testid="coach-panel"
      className="flex flex-col gap-2 border-b border-border/60 px-4 py-3"
    >
      <div className="flex items-center gap-2">
        <Lightbulb className="h-3.5 w-3.5 text-amber-400" />
        <span className="text-xs font-semibold text-text-primary">
          Helpful next steps
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-text-muted">
        Suggestions only — nothing changes until you tap an action.
      </p>

      <div className="flex flex-col gap-2">
        {/* Launch coach card */}
        <div
          data-testid="coach-launch-card"
          className="rounded-lg border border-accent/25 bg-accent/5 p-2.5"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium text-text-primary">
              {launchCard.title}
            </p>
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-accent">
              <Rocket className="h-3.5 w-3.5" />
            </span>
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-text-dim">
            {launchCard.description}
          </p>
          <button
            type="button"
            onClick={launchCard.onRun}
            data-testid="coach-launch-run"
            className="mt-2 flex h-6 items-center gap-1 rounded-md bg-accent/15 px-2 text-[11px] font-medium text-accent transition-all duration-200 hover:bg-accent/25 active:scale-95"
          >
            <Rocket className="h-3 w-3" />
            {launchCard.action}
          </button>
        </div>

        {recommendations.map((suggestion) => (
          <div
            key={suggestion.id}
            data-testid={`coach-card-${suggestion.id}`}
            className="rounded-lg border border-border/50 bg-card/60 p-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-medium text-text-primary">
                {suggestion.title}
              </p>
              <button
                type="button"
                onClick={() => dismiss(suggestion)}
                aria-label={`Dismiss ${suggestion.title}`}
                data-testid={`coach-dismiss-${suggestion.id}`}
                className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-text-dim transition-colors hover:bg-base hover:text-text-primary"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-text-dim">
              {suggestion.description}
            </p>
            <p className="mt-1 text-[10px] italic text-text-muted">
              {suggestion.reason}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => run(suggestion)}
                data-testid={`coach-run-${suggestion.id}`}
                className="flex h-6 items-center gap-1 rounded-md bg-accent/15 px-2 text-[11px] font-medium text-accent transition-all duration-200 hover:bg-accent/25 active:scale-95"
              >
                <Sparkles className="h-3 w-3" />
                {suggestionPrimaryLabel(suggestion)}
              </button>
              <button
                type="button"
                onClick={() => handleExamples(suggestion)}
                className="flex h-6 items-center gap-1 rounded-md border border-border/50 px-2 text-[11px] font-medium text-text-muted transition-all duration-200 hover:bg-base hover:text-text-primary active:scale-95"
              >
                <LayoutGrid className="h-3 w-3" />
                Show examples
              </button>
              <button
                type="button"
                onClick={askHelp}
                className="flex h-6 items-center rounded-md border border-border/50 px-2 text-[11px] font-medium text-text-muted transition-all duration-200 hover:bg-base hover:text-text-primary active:scale-95"
              >
                Ask AI
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
