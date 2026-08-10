"use client";

// ---------------------------------------------------------------------------
// Phase P15 — PresenceIndicator (editor TopNav)
//
// Subtle collaboration presence: who is currently open in this project and
// whether they are viewing or editing. Mode is server-truthful (lease-derived
// for the mock; server-resolved access for Supabase). The indicator shows
// NOTHING when there is no live presence (disconnected/offline) — it never
// fakes online state. Text is available (not color alone) for accessibility.
// ---------------------------------------------------------------------------

import { useAuth } from "@/features/auth/useAuth";
import { useWorkspaceAccessStore } from "../store/workspace-access-store";
import { dedupeByUser, useWorkspacePresenceStore } from "../store/workspace-presence-store";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");
}

export function PresenceIndicator() {
  const { user } = useAuth();
  const accessMode = useWorkspaceAccessStore((s) => s.access.mode);
  const sessions = useWorkspacePresenceStore((s) => s.sessions);
  const active = useWorkspacePresenceStore((s) => s.active);
  const disconnected = useWorkspacePresenceStore((s) => s.disconnected);
  const projectId = useWorkspacePresenceStore((s) => s.projectId);

  // Only for the active project scope; exclude the current user.
  const others = dedupeByUser(
    sessions.filter(
      (s) => (projectId ? s.projectId === projectId : true) && s.userId !== user?.id,
    ),
  );

  // No live session → render nothing (never fake online state).
  if (!active || disconnected) return null;

  const selfMode = accessMode === "editable" ? "editing" : "viewing";
  const shown = others.slice(0, 2);
  const extra = others.length - shown.length;

  const othersText =
    shown.length === 0
      ? ""
      : shown
          .map((s) => `${s.displayName} is ${s.mode === "editing" ? "editing" : "viewing"}`)
          .join(", ") + (extra > 0 ? ` and ${extra} more` : "");

  const summary = `You're ${selfMode}${othersText ? `. ${othersText}.` : ""}`;

  return (
    <div
      className="flex items-center gap-1"
      data-testid="workspace-presence"
      role="status"
      aria-label={summary}
      title={summary}
    >
      {/* Self chip */}
      <span
        data-testid="presence-self"
        className={`flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-medium ${
          selfMode === "editing"
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "border-border bg-card text-text-dim"
        }`}
      >
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
        You&apos;re {selfMode === "editing" ? "editing" : "viewing"}
      </span>

      {/* Other users (one chip each, deduped by user) */}
      {shown.map((presence) => (
        <span
          key={presence.sessionId}
          data-testid="presence-other"
          className={`flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-medium ${
            presence.mode === "editing"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border-border bg-card text-text-dim"
          }`}
        >
          <span
            aria-hidden="true"
            className="flex h-4 w-4 items-center justify-center rounded-full bg-accent/15 text-[9px] font-semibold text-accent"
          >
            {initialsOf(presence.displayName)}
          </span>
          {presence.displayName}
          {presence.mode === "editing" ? " is editing" : ""}
        </span>
      ))}

      {extra > 0 && (
        <span
          data-testid="presence-more"
          className="flex h-6 items-center rounded-full border border-border bg-card px-2 text-[11px] font-medium text-text-dim"
        >
          +{extra}
        </span>
      )}
    </div>
  );
}
