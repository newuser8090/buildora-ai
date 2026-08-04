// ---------------------------------------------------------------------------
// useGuidedBuilder — derived guidance from REAL project state
//
// Pure engines + live editor store. No mutations, no autosave, no history —
// recommendations/score/journey are derived views.
// ---------------------------------------------------------------------------

"use client";

import { useMemo } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useGuidedBuilderStore } from "../store/guided-builder-store";
import { getBuilderRecommendations } from "../engine/builder-recommendations";
import { getReadinessReport } from "../engine/readiness-score";
import { getBuildingJourney } from "../engine/building-journey";
import type { BuilderSiteType } from "../types";

export function useGuidedBuilder() {
  const project = useEditorStore((s) => s.project);
  const selectedPageId = useEditorStore((s) => s.selectedPageId);

  const experienceMode = useGuidedBuilderStore((s) => s.experienceMode);
  const dismissedSuggestionIds = useGuidedBuilderStore(
    (s) => s.dismissedSuggestionIds,
  );
  const coachEnabled = useGuidedBuilderStore((s) => s.coachEnabled);
  const onboardingSelections = useGuidedBuilderStore(
    (s) => s.onboardingSelections,
  );
  const hasPreviewedMobile = useGuidedBuilderStore((s) => s.hasPreviewedMobile);
  const hasExported = useGuidedBuilderStore((s) => s.hasExported);

  const activePage =
    project.pages.find((p) => p.id === selectedPageId) ?? project.pages[0];

  const guided = experienceMode === "guided";

  const siteType: BuilderSiteType = useMemo(
    () => onboardingSelections?.category ?? "generic",
    [onboardingSelections],
  );

  return useMemo(() => {
    const sections = activePage
      ? [...activePage.sections]
          .filter((s) => s.visible)
          .sort((a, b) => a.order - b.order)
      : [];

    const recommendations = getBuilderRecommendations({
      siteType,
      pageTitle: activePage?.title ?? "",
      sectionTypes: sections.map((s) => s.type),
      sections: sections.map((s) => ({
        type: s.type,
        props: s.props,
      })),
      pageCount: project.pages.length,
      dismissedIds: dismissedSuggestionIds,
      limit: 4,
    });

    const readiness = getReadinessReport({
      siteType,
      sections: sections.map((s) => ({ type: s.type, props: s.props })),
      pageTitle: activePage?.title ?? "",
      pageMeta: activePage?.meta ?? null,
      pageCount: project.pages.length,
    });

    const journey = getBuildingJourney({
      pageTitle: activePage?.title ?? "",
      sections: sections.map((s) => ({ type: s.type, props: s.props })),
      hasPreviewedMobile,
      hasExported,
    });

    return {
      activePage,
      sections,
      guided,
      siteType,
      recommendations,
      readiness,
      journey,
      coachEnabled,
    };
  }, [
    activePage,
    project.pages.length,
    siteType,
    guided,
    dismissedSuggestionIds,
    coachEnabled,
    hasPreviewedMobile,
    hasExported,
  ]);
}
