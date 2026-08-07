// ---------------------------------------------------------------------------
// useLaunchReadiness — memoized derived launch readiness
//
// Pure engine + live editor store. No mutations, no autosave, no history.
// Memoized so repeated renders don't re-run the engine.
// ---------------------------------------------------------------------------

"use client";

import { useMemo } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useGuidedBuilderStore } from "@/features/guided-builder/store/guided-builder-store";
import { getLaunchReadinessReport } from "../engine/launch-readiness";
import { contentHashOfProject } from "@/features/publishing/services/hash";

export function useLaunchReadiness() {
  const project = useEditorStore((s) => s.project);
  const hasPreviewedMobile = useGuidedBuilderStore((s) => s.hasPreviewedMobile);

  return useMemo(() => {
    const report = getLaunchReadinessReport(project, { hasPreviewedMobile });
    return {
      ...report,
      contentHash: contentHashOfProject(project),
    };
  }, [project, hasPreviewedMobile]);
}
