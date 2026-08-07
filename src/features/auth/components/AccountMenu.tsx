"use client";

// ---------------------------------------------------------------------------
// Auth (Phase P6) — account menu
//
// Avatar menu for both signed-out and signed-in users. Signed-out users get
// the beginner copy ("Your saved pieces live on this device.") and a sign-in
// CTA. Signed-in users see their email, sync summary, and entries for shared
// libraries, account settings, and sign-out. Signing out NEVER deletes local
// data — the menu says so explicitly.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleUser, LogOut, Settings, Library, Check, Loader2 } from "lucide-react";
import { useAuth } from "../useAuth";
import { AuthDialog } from "./AuthDialog";
import { useCloudSyncStore } from "@/features/cloud-sync/store/cloud-sync-store";
import { syncNow } from "@/features/cloud-sync/sync-runtime";
import { useSharedLibrariesUiStore } from "@/features/shared-libraries/store/shared-libraries-ui-store";
import { AccountSettingsDialog } from "@/features/cloud-sync/components/AccountSettingsDialog";

export function AccountMenu() {
  const { status, user, signOut } = useAuth();
  const syncStatus = useCloudSyncStore((s) => s.status);
  const pendingUploadCount = useCloudSyncStore((s) => s.pendingUploadCount);
  const conflictCount = useCloudSyncStore((s) => s.conflictCount);
  const [open, setOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const openSharedLibraries = useSharedLibrariesUiStore((s) => s.openPanel);
  const openAccountSettings = useCloudSyncStore((s) => s.openAccountSettings);

  // Close on outside click + Escape.
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

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    await signOut();
    setSigningOut(false);
    setOpen(false);
    // Note: local My Blocks are retained by design.
  }, [signOut]);

  const signedIn = status === "signed-in";

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="menu"
        className="relative flex h-8 w-8 items-center justify-center rounded-full bg-card text-text-dim transition-all duration-200 hover:bg-accent/15 hover:text-accent active:scale-95"
        type="button"
      >
        <CircleUser className="h-4 w-4" />
        {conflictCount > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white"
            aria-label={`${conflictCount} conflict${conflictCount === 1 ? "" : "s"} to review`}
          >
            {conflictCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-10 z-[60] w-72 overflow-hidden rounded-xl border border-border bg-card shadow-elevated"
        >
          {signedIn ? (
            <>
              <div className="border-b border-border px-4 py-3">
                <p className="text-sm font-medium text-text-primary">{user?.email}</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  Your saved pieces are backed up.
                </p>
              </div>

              <div className="border-b border-border px-4 py-2.5 text-xs text-text-dim">
                {syncStatus === "syncing" && <span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Syncing…</span>}
                {syncStatus === "synced" && <span className="flex items-center gap-1.5"><Check className="h-3 w-3 text-emerald-400" /> Synced</span>}
                {syncStatus === "offline" && <span className="flex items-center gap-1.5">Offline — changes saved here</span>}
                {syncStatus === "error" && <span className="flex items-center gap-1.5 text-amber-400">Sync needs attention</span>}
                {syncStatus === "conflict" && <span className="flex items-center gap-1.5 text-amber-400">{conflictCount} conflict{conflictCount === 1 ? "" : "s"} to review</span>}
                {pendingUploadCount > 0 && (
                  <span className="mt-1 block">{pendingUploadCount} change{pendingUploadCount === 1 ? "" : "s"} waiting to sync</span>
                )}
              </div>

              <div className="p-1.5">
                <button
                  role="menuitem"
                  onClick={() => { setOpen(false); openSharedLibraries(); }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-primary transition-colors hover:bg-base"
                  type="button"
                >
                  <Library className="h-4 w-4 text-text-dim" />
                  Shared libraries
                </button>
                <button
                  role="menuitem"
                  onClick={() => { setOpen(false); openAccountSettings(); }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-primary transition-colors hover:bg-base"
                  type="button"
                >
                  <Settings className="h-4 w-4 text-text-dim" />
                  Account &amp; backup
                </button>
                <button
                  role="menuitem"
                  onClick={() => { setOpen(false); void syncNow(); }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-primary transition-colors hover:bg-base"
                  type="button"
                >
                  <Check className="h-4 w-4 text-text-dim" />
                  Sync now
                </button>
                <button
                  role="menuitem"
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                  type="button"
                >
                  {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                  Sign out
                </button>
                <p className="px-3 pb-1 pt-1 text-[11px] leading-snug text-text-dim">
                  Signing out keeps your saved pieces on this device.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="border-b border-border px-4 py-3">
                <p className="text-sm font-medium text-text-primary">Your saved pieces live on this device.</p>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">
                  Back them up and use them anywhere. Nothing is published publicly.
                </p>
              </div>
              <div className="p-1.5">
                <button
                  role="menuitem"
                  onClick={() => { setOpen(false); setAuthOpen(true); }}
                  className="flex w-full items-center justify-center rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-all hover:bg-accent-hover"
                  type="button"
                >
                  Sign in to back up
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} initialMode="sign-in" />
      <AccountSettingsDialog />
    </div>
  );
}
