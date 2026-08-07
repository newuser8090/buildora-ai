"use client";

// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — compact status control
//
// Shows the current sync state ("Saved locally", "Syncing…", "Synced",
// "Offline — changes saved here", "Sync needs attention", "Conflicts to
// review") with actions (Sync now / View details / Review conflicts / Sign
// in to back up). No misleading "Synced" before acknowledgment; polite live
// region; no constant distracting animation.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import {
  Cloud,
  RefreshCw,
  AlertTriangle,
  WifiOff,
  Check,
  Loader2,
  MessageSquareWarning,
} from "lucide-react";
import { useAuth } from "@/features/auth/useAuth";
import { AuthDialog } from "@/features/auth/components/AuthDialog";
import { useCloudSyncStore } from "../store/cloud-sync-store";
import { syncNow } from "../sync-runtime";
import { CloudSyncDetailsDialog } from "./CloudSyncDetailsDialog";

export function CloudSyncStatusControl() {
  const status = useCloudSyncStore((s) => s.status);
  const online = useCloudSyncStore((s) => s.online);
  const conflictCount = useCloudSyncStore((s) => s.conflictCount);
  const { status: authStatus } = useAuth();

  const [open, setOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const openDetails = useCloudSyncStore((s) => s.openDetails);
  const openConflicts = useCloudSyncStore((s) => s.openConflicts);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // ---- Derived label + icon (never color-only: icon + text) ----
  const signedIn = authStatus === "signed-in";
  let label: string;
  let Icon = Cloud;
  let tone = "text-text-dim";
  if (!signedIn) {
    label = "Saved locally";
  } else if (status === "syncing") {
    label = "Syncing…";
    Icon = Loader2;
  } else if (status === "conflict") {
    label = `${conflictCount} conflict${conflictCount === 1 ? "" : "s"} to review`;
    Icon = MessageSquareWarning;
    tone = "text-amber-400";
  } else if (status === "offline" || !online) {
    label = "Offline — changes saved here";
    Icon = WifiOff;
  } else if (status === "error") {
    label = "Sync needs attention";
    Icon = AlertTriangle;
    tone = "text-amber-400";
  } else if (status === "synced") {
    label = "Synced";
    Icon = Check;
    tone = "text-emerald-400";
  } else {
    label = "Saved locally";
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="cloud-sync-status"
        className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-all duration-200 hover:bg-card ${tone}`}
        type="button"
      >
        <Icon className={`h-3.5 w-3.5 ${status === "syncing" ? "animate-spin" : ""}`} />
        <span className="hidden sm:inline">{label}</span>
      </button>
      {/* Polite live region — announces state changes without shouting. */}
      <span className="sr-only" role="status" aria-live="polite">
        {label}
      </span>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-10 z-[60] w-60 overflow-hidden rounded-xl border border-border bg-card shadow-elevated"
        >
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-medium text-text-primary">{label}</p>
            <p className="mt-0.5 text-xs text-text-muted">
              {signedIn
                ? "Your saved pieces are backed up. This device stays the source of truth."
                : "Your saved pieces live on this device."}
            </p>
          </div>
          <div className="p-1.5">
            {signedIn ? (
              <>
                <button
                  role="menuitem"
                  onClick={() => { setOpen(false); void syncNow(); }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-primary transition-colors hover:bg-base"
                  type="button"
                >
                  <RefreshCw className="h-4 w-4 text-text-dim" />
                  Sync now
                </button>
                <button
                  role="menuitem"
                  onClick={() => { setOpen(false); openDetails(); }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-primary transition-colors hover:bg-base"
                  type="button"
                >
                  <Cloud className="h-4 w-4 text-text-dim" />
                  View sync details
                </button>
                {conflictCount > 0 && (
                  <button
                    role="menuitem"
                    onClick={() => { setOpen(false); openConflicts(); }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-amber-400 transition-colors hover:bg-amber-500/10"
                    type="button"
                  >
                    <MessageSquareWarning className="h-4 w-4" />
                    Review conflicts
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  role="menuitem"
                  onClick={() => { setOpen(false); setAuthOpen(true); }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-accent transition-colors hover:bg-accent/10"
                  type="button"
                >
                  <Cloud className="h-4 w-4" />
                  Sign in to back up
                </button>
                <button
                  role="menuitem"
                  onClick={() => { setOpen(false); openDetails(); }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-primary transition-colors hover:bg-base"
                  type="button"
                >
                  <AlertTriangle className="h-4 w-4 text-text-dim" />
                  How backup works
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} initialMode="sign-in" />
      <CloudSyncDetailsDialog />
    </div>
  );
}
