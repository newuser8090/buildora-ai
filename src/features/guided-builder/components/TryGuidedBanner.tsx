// ---------------------------------------------------------------------------
// TryGuidedBanner — "Try Guided Mode" banner (Phase N, spec §20)
//
// Shown only for RETURNING users (stored prefs exist) who are in Standard
// mode and have not dismissed the banner. Dismissal is a persistent UI
// preference. Purely a suggestion — nothing changes until the user clicks.
// ---------------------------------------------------------------------------

"use client";

import { Sparkles, X } from "lucide-react";
import { useGuidedBuilderStore } from "../store/guided-builder-store";

export function TryGuidedBanner() {
  const experienceMode = useGuidedBuilderStore((s) => s.experienceMode);
  const tryGuidedBannerDismissed = useGuidedBuilderStore(
    (s) => s.tryGuidedBannerDismissed,
  );
  const hydrated = useGuidedBuilderStore((s) => s.hydrated);
  const hasStoredPrefs = useGuidedBuilderStore((s) => s.hasStoredPrefs);
  const setMode = useGuidedBuilderStore((s) => s.setExperienceMode);
  const dismiss = useGuidedBuilderStore((s) => s.dismissTryGuidedBanner);

  // Returning users only (spec §20): the banner appears once stored prefs
  // exist and the user is still in Standard mode. New users never see it —
  // they get onboarding instead, and fresh contexts must not be obstructed.
  if (!hydrated) return null;
  if (!hasStoredPrefs) return null;
  if (experienceMode !== "standard") return null;
  if (tryGuidedBannerDismissed) return null;

  return (
    <div
      data-testid="try-guided-banner"
      className="fixed bottom-14 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-accent/30 bg-card px-4 py-2.5 shadow-elevated"
      role="status"
    >
      <Sparkles className="h-4 w-4 flex-shrink-0 text-accent" />
      <div className="min-w-0">
        <p className="text-xs font-medium text-text-primary">
          New to building websites?
        </p>
        <p className="text-[11px] text-text-muted">
          Guided mode uses simple words and suggests what to add next.
        </p>
      </div>
      <button
        type="button"
        data-testid="try-guided-confirm"
        onClick={() => setMode("guided")}
        className="flex h-7 flex-shrink-0 items-center rounded-lg bg-accent px-3 text-xs font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95"
      >
        Try Guided Mode
      </button>
      <button
        type="button"
        data-testid="try-guided-dismiss"
        onClick={dismiss}
        aria-label="Dismiss"
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-text-dim transition-colors hover:bg-base hover:text-text-primary"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
