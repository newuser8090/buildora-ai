// ---------------------------------------------------------------------------
// MicroTip — optional tiny explanations (Phase N, spec §15)
//
// One or two sentences only, dismissible, never shown again after dismissal
// (stored as a persistent UI preference). No modal interruptions.
// ---------------------------------------------------------------------------

"use client";

import { useMemo } from "react";
import { X, Info } from "lucide-react";
import { useGuidedBuilderStore } from "../store/guided-builder-store";

const TIPS: { id: string; text: string }[] = [
  { id: "tip-button", text: "A button helps visitors take an action." },
  { id: "tip-navigation", text: "Navigation helps people move between pages." },
  { id: "tip-testimonials", text: "Customer opinions can build trust." },
  {
    id: "tip-faq",
    text: "Questions reduce uncertainty before someone contacts or buys.",
  },
  {
    id: "tip-main-message",
    text: "Your main message is the first thing visitors see.",
  },
];

export function MicroTip() {
  const dismissedTipIds = useGuidedBuilderStore((s) => s.dismissedTipIds);
  const dismissTip = useGuidedBuilderStore((s) => s.dismissTip);

  // Deterministic: show the first tip that hasn't been dismissed yet.
  const tip = useMemo(
    () => TIPS.find((t) => !dismissedTipIds.includes(t.id)) ?? null,
    [dismissedTipIds],
  );

  if (!tip) return null;

  return (
    <div
      data-testid="micro-tip"
      className="mx-3 mb-3 mt-1 flex items-start gap-2 rounded-lg border border-border/50 bg-card/50 px-3 py-2"
    >
      <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-accent" />
      <p className="flex-1 text-[11px] leading-relaxed text-text-muted">
        {tip.text}
      </p>
      <button
        type="button"
        onClick={() => dismissTip(tip.id)}
        aria-label="Dismiss tip"
        data-testid={`micro-tip-dismiss-${tip.id}`}
        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-text-dim transition-colors hover:bg-base hover:text-text-primary"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
