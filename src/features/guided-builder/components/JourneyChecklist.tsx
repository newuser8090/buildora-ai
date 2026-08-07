// ---------------------------------------------------------------------------
// JourneyChecklist — guided homepage progress checklist (Phase N, spec §11)
//
// Completion is derived from REAL project state. Clicking an incomplete step
// opens the relevant action; clicking a complete step navigates to the
// relevant section. Collapsed state is a UI preference only.
// ---------------------------------------------------------------------------

"use client";

import { useCallback } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useEditorUiStore } from "@/features/editor/ui/editor-ui-store";
import { useGuidedBuilder } from "../hooks/useGuidedBuilder";
import { useGuidedBuilderStore } from "../store/guided-builder-store";
import { useGuidedActions } from "../hooks/useGuidedActions";
import {
  journeyStepSectionType,
} from "../engine/building-journey";
import type { JourneyStepId } from "../types";

export function JourneyChecklist() {
  const { journey, sections } = useGuidedBuilder();
  const collapsed = useGuidedBuilderStore((s) => s.journeyCollapsed);
  const setJourneyCollapsed = useGuidedBuilderStore((s) => s.setJourneyCollapsed);
  const selectSection = useEditorStore((s) => s.selectSection);
  const setRightSidebarTab = useEditorUiStore((s) => s.setRightSidebarTab);
  const setViewport = useEditorStore((s) => s.setViewport);
  const setHasPreviewedMobile = useGuidedBuilderStore(
    (s) => s.setHasPreviewedMobile,
  );
  const setHasExported = useGuidedBuilderStore((s) => s.setHasExported);
  const { browseBlocks } = useGuidedActions();

  const goToStep = useCallback(
    (stepId: JourneyStepId) => {
      const sectionType = journeyStepSectionType(stepId);
      if (sectionType) {
        const existing = sections.find((s) => s.type === sectionType);
        if (existing) {
          selectSection(existing.id);
          setRightSidebarTab("design");
        } else {
          browseBlocks({ initialType: sectionType });
        }
        return;
      }
      if (stepId === "preview-mobile") {
        setViewport("mobile");
        setHasPreviewedMobile(true);
      } else if (stepId === "preview-site") {
        useGuidedBuilderStore.getState().setHasPreviewedSite(true);
        window.dispatchEvent(new CustomEvent("buildora:preview-site"));
      } else if (stepId === "publish") {
        useGuidedBuilderStore.getState().setHasPublished(true);
        window.dispatchEvent(new CustomEvent("buildora:open-launch-center"));
      } else if (stepId === "export") {
        setHasExported(true);
        window.dispatchEvent(new CustomEvent("buildora:export-site"));
      }
    },
    [
      sections,
      selectSection,
      setRightSidebarTab,
      browseBlocks,
      setViewport,
      setHasPreviewedMobile,
      setHasExported,
    ],
  );

  const progress =
    journey.total === 0 ? 0 : Math.round((journey.completedCount / journey.total) * 100);

  return (
    <div
      data-testid="journey-checklist"
      className="border-b border-border/60 px-4 py-3"
    >
      <button
        type="button"
        onClick={() => setJourneyCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-xs font-semibold text-text-primary">
          {journey.pageTitle} progress
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-[11px] text-text-dim">
            {journey.completedCount}/{journey.total}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 text-text-dim transition-transform duration-200 ${
              collapsed ? "-rotate-90" : ""
            }`}
          />
        </span>
      </button>

      {/* Accessible progress bar */}
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-base"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-label={`${journey.pageTitle} progress ${progress} percent`}
      >
        <div
          className="h-full rounded-full bg-accent transition-all duration-500 motion-reduce:transition-none"
          style={{ width: `${progress}%` }}
        />
      </div>

      {!collapsed && (
        <ul className="mt-2 flex flex-col">
          {journey.steps.map((step) => (
            <li key={step.id}>
              <button
                type="button"
                data-testid={`journey-step-${step.id}`}
                onClick={() => goToStep(step.id)}
                aria-label={`${step.label}${step.complete ? " — done" : " — not done"}`}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-base"
              >
                <span
                  aria-hidden="true"
                  className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${
                    step.complete
                      ? "border-accent bg-accent text-white"
                      : "border-border/60 text-transparent"
                  }`}
                >
                  <Check className="h-2.5 w-2.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-xs ${
                      step.complete
                        ? "text-text-dim line-through decoration-text-dim/40"
                        : "text-text-primary"
                    }`}
                  >
                    {step.label}
                  </span>
                  <span className="block truncate text-[10px] text-text-muted">
                    {step.helper}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
