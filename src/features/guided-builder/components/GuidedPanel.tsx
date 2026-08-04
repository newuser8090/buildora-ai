// ---------------------------------------------------------------------------
// GuidedPanel — right-sidebar guided experience (Phase N)
//
// Rendered at the top of the Structure panel in Guided mode. Combines the
// readiness score, the building journey checklist, and the proactive coach.
// All of it is derived UI — nothing here mutates the project.
// ---------------------------------------------------------------------------

"use client";

import { ReadinessScore } from "./ReadinessScore";
import { JourneyChecklist } from "./JourneyChecklist";
import { CoachPanel } from "./CoachPanel";
import { MicroTip } from "./MicroTip";

export function GuidedPanel() {
  return (
    <div data-testid="guided-panel" className="flex flex-col">
      <ReadinessScore />
      <JourneyChecklist />
      <CoachPanel />
      <MicroTip />
    </div>
  );
}
