"use client";

// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — account & backup settings
//
// Shows: account email, sign-out, last successful sync, pending changes,
// device-local storage usage, cloud record count, shared libraries, conflict
// count, "Sync now", and the explicit confirmed "Remove this account's cloud
// copies from this device" action. There is deliberately NO delete-account
// button — account deletion is out of scope and a fake button would mislead.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { X, RefreshCw, Trash2, LogOut, Check, AlertTriangle, Loader2, Library } from "lucide-react";
import { useAuth } from "@/features/auth/useAuth";
import { useCloudSyncStore } from "../store/cloud-sync-store";
import { getCloudEnvironment, cloudProviderLabel } from "../cloud-environment";
import { syncNow, removeCloudDataFromDevice } from "../sync-runtime";
import { useFocusTrap } from "@/features/auth/components/useFocusTrap";
import { useSharedLibrariesUiStore } from "@/features/shared-libraries/store/shared-libraries-ui-store";
import { SharedLibraryService } from "@/features/shared-libraries/services/shared-library-service";
import { getCloudProvider } from "../providers/provider-factory";
import { getMyBlocksAdapter } from "@/features/my-blocks/storage/my-blocks-singleton";
import { estimateLibraryBytes } from "@/features/my-blocks/storage/my-blocks-storage-adapter";
import { formatBytes } from "@/features/my-blocks/errors";

export function AccountSettingsDialog() {
  const open = useCloudSyncStore((s) => s.accountSettingsOpen);
  const close = useCloudSyncStore((s) => s.closeAccountSettings);
  const { user, signOut } = useAuth();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const lastSuccessfulSyncAt = useCloudSyncStore((s) => s.lastSuccessfulSyncAt);
  const pendingUploadCount = useCloudSyncStore((s) => s.pendingUploadCount);
  const conflictCount = useCloudSyncStore((s) => s.conflictCount);

  const [blockCount, setBlockCount] = useState(0);
  const [storageBytes, setStorageBytes] = useState(0);
  const [libraryCount, setLibraryCount] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);

  const openSharedLibraries = useSharedLibrariesUiStore((s) => s.openPanel);

  useFocusTrap(open, dialogRef);

  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    void (async () => {
      const result = await getMyBlocksAdapter().listMyBlocks();
      if (cancelled) return;
      if (result.ok) {
        setBlockCount(result.value.length);
        setStorageBytes(estimateLibraryBytes(result.value));
      }
    })();
    const provider = getCloudProvider();
    if (provider) {
      const service = new SharedLibraryService(provider);
      void service.list().then((listing) => {
        if (cancelled) return;
        if (listing.ok) {
          setLibraryCount(listing.value.owned.length + listing.value.shared.length);
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [open, user]);

  if (!open) return null;

  const providerLabel = cloudProviderLabel() || "Local only";
  const env = getCloudEnvironment();
  const configured = env.configured;

  const handleRemoveCloudData = async () => {
    if (!user || removing) return;
    setRemoving(true);
    await removeCloudDataFromDevice(user.id);
    setRemoving(false);
    setConfirmRemove(false);
    close();
  };

  const handleSignOut = async () => {
    setBusy(true);
    await signOut();
    setBusy(false);
    close();
  };

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-settings-title"
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-border bg-card shadow-elevated"
      >
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div>
            <h2 id="account-settings-title" className="text-lg font-semibold text-text-primary">
              Account &amp; backup
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">{providerLabel}</p>
          </div>
          <button
            onClick={close}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-base hover:text-text-primary"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {user && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-text-dim">Account</p>
              <p className="mt-1 text-sm text-text-primary">{user.email}</p>
            </div>
          )}

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-text-dim">Backup</p>
            <dl className="mt-2 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-muted">Last successful sync</dt>
                <dd className="text-text-primary">
                  {lastSuccessfulSyncAt
                    ? new Date(lastSuccessfulSyncAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                    : "Not synced yet"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-muted">Changes waiting to sync</dt>
                <dd className="text-text-primary">{pendingUploadCount}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-muted">Conflicts to review</dt>
                <dd className="text-text-primary">{conflictCount}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-muted">Saved pieces on this device</dt>
                <dd className="text-text-primary">{blockCount}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-muted">Storage used here</dt>
                <dd className="text-text-primary">{formatBytes(storageBytes)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-muted">Shared libraries</dt>
                <dd className="text-text-primary">{libraryCount}</dd>
              </div>
            </dl>
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={() => void syncNow()}
              disabled={!configured}
              className="flex h-9 items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-white transition-all hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
            >
              <RefreshCw className="h-4 w-4" />
              Sync now
            </button>
            <button
              onClick={() => { close(); openSharedLibraries(); }}
              disabled={!configured}
              className="flex h-9 items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium text-text-primary transition-all hover:bg-base disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
            >
              <Library className="h-4 w-4" />
              Manage shared libraries
            </button>
            <button
              onClick={handleSignOut}
              disabled={busy}
              className="flex h-9 items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium text-text-primary transition-all hover:bg-base disabled:opacity-50"
              type="button"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              Sign out
            </button>
          </div>

          <div className="border-t border-border pt-4">
            {!confirmRemove ? (
              <button
                onClick={() => setConfirmRemove(true)}
                className="flex items-center gap-2 text-xs font-medium text-text-dim transition-colors hover:text-red-400"
                type="button"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove this account&apos;s cloud copies from this device
              </button>
            ) : (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                <p className="flex items-start gap-2 text-xs text-red-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  This clears this device&apos;s pending backups, sync markers, and cached shared
                  libraries for this account. Your saved pieces stay on this device, and the cloud
                  copies in your account are untouched.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={handleRemoveCloudData}
                    disabled={removing}
                    className="flex h-8 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
                    type="button"
                  >
                    {removing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Yes, remove cloud copies here
                  </button>
                  <button
                    onClick={() => setConfirmRemove(false)}
                    className="h-8 rounded-lg px-3 text-xs font-medium text-text-dim hover:bg-base"
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-border px-6 py-3 text-xs text-text-dim">
          <Check className="h-3.5 w-3.5 text-emerald-400" />
          Signing out or going offline never deletes your saved pieces.
        </div>
      </div>
    </div>
  );
}
