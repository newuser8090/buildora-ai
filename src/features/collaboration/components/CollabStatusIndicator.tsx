"use client";

// ---------------------------------------------------------------------------
// Collaborative editing (Phase P16) — CollabStatusIndicator (editor TopNav)
//
// Honest collaboration sync status — NEVER color alone, always text (a11y §73):
//   Synced / Syncing… / Offline / Reconnecting… / Error
// plus a batched, debounced remote-change hint ("Alex updated the homepage").
// Remote change hints never spam per character — they batch per update burst
// and fade automatically (architecture §22).
// ---------------------------------------------------------------------------

import { Check, CloudOff, Loader2, TriangleAlert, Wifi } from "lucide-react";
import { useCollabUiStore } from "../store/collab-ui-store";
import type { CollabSyncStatus } from "../types";

const STATUS_TEXT: Record<CollabSyncStatus, string> = {
  idle: "Collaboration ready",
  connecting: "Connecting…",
  syncing: "Syncing…",
  synced: "Synced",
  offline: "Offline — changes saved on this device",
  reconnecting: "Reconnecting…",
  error: "Connection error",
};

const STATUS_TESTID: Record<CollabSyncStatus, string> = {
  idle: "collab-status-idle",
  connecting: "collab-status-connecting",
  syncing: "collab-status-syncing",
  synced: "collab-status-synced",
  offline: "collab-status-offline",
  reconnecting: "collab-status-reconnecting",
  error: "collab-status-error",
};

export function CollabStatusIndicator() {
  const status = useCollabUiStore((s) => s.status);
  const maintenance = useCollabUiStore((s) => s.maintenance);
  const lastActorName = useCollabUiStore((s) => s.lastActorName);
  const lastChangeLabel = useCollabUiStore((s) => s.lastChangeLabel);
  // The remote-change hint is visible while the store holds a batched change;
  // the store auto-clears it after a short window (no per-character toasts).
  const hintVisible = Boolean(lastActorName && lastChangeLabel);

  // Only render once a session is actually active (never on personal projects
  // or read-only previews — status stays "idle" there and we show nothing).
  if (status === "idle") return null;

  const Icon =
    status === "synced"
      ? Check
      : status === "syncing" || status === "connecting" || status === "reconnecting"
        ? Loader2
        : status === "offline"
          ? CloudOff
          : status === "error"
            ? TriangleAlert
            : Wifi;

  const label = maintenance
    ? "Updating project…"
    : STATUS_TEXT[status];

  return (
    <div
      className="flex items-center gap-2"
      data-testid="collab-status"
      role="status"
      aria-label={label}
    >
      <span
        data-testid={STATUS_TESTID[status]}
        className={`flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors ${
          status === "synced"
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : status === "offline" || status === "error"
              ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
              : "border-border bg-card text-text-dim"
        }`}
      >
        <Icon
          className={`h-3 w-3 ${status === "syncing" || status === "connecting" || status === "reconnecting" ? "animate-spin" : ""}`}
          aria-hidden="true"
        />
        {label}
      </span>

      {hintVisible && lastActorName && lastChangeLabel && (
        <span
          className="max-w-[260px] truncate rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent transition-opacity"
          data-testid="collab-live-change"
          role="status"
        >
          {lastActorName} {lastChangeLabel}
        </span>
      )}
    </div>
  );
}
