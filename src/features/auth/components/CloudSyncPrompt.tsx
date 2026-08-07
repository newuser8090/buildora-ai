"use client";

// ---------------------------------------------------------------------------
// Auth (Phase P6) — cloud backup prompt
//
// Beginner-first account UX. Signed-out users see "Your saved pieces live on
// this device." + "Back them up and use them anywhere." Signed-in users see
// "Your saved pieces are backed up." No database jargon — ever.
// ---------------------------------------------------------------------------

import { useAuth } from "../useAuth";
import { AuthDialog } from "./AuthDialog";
import { useState } from "react";

export interface CloudSyncPromptProps {
  /** Number of local saved pieces (drives the message copy). */
  blockCount?: number;
}

export function CloudSyncPrompt({ blockCount = 0 }: CloudSyncPromptProps) {
  const { status } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);

  if (status === "loading" || status === "signed-in") return null;

  const label = blockCount > 0
    ? `Your ${blockCount} saved piece${blockCount === 1 ? "" : "s"} ${blockCount === 1 ? "lives" : "live"} on this device.`
    : "Your saved pieces live on this device.";

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-accent/25 bg-accent/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      role="region"
      aria-label="Back up your saved pieces"
    >
      <div>
        <p className="text-sm font-medium text-text-primary">{label}</p>
        <p className="mt-0.5 text-xs text-text-muted">
          Signing in backs them up and lets you use them on any device. Nothing is
          published publicly — your library stays private.
        </p>
      </div>
      <button
        onClick={() => setAuthOpen(true)}
        className="flex h-9 shrink-0 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95"
        type="button"
      >
        Back them up and use them anywhere
      </button>
      <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} initialMode="sign-up" />
    </div>
  );
}
