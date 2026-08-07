"use client";

// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — sync details dialog
//
// Beginner-friendly sync status summary: last successful sync, pending
// changes, conflicts, device-local storage usage, cloud record count. Raw
// technical codes are only shown under an "Advanced details" disclosure.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { X, RefreshCw, Check, AlertTriangle, ChevronDown } from "lucide-react";
import { useAuth } from "@/features/auth/useAuth";
import { useCloudSyncStore } from "../store/cloud-sync-store";
import { cloudProviderLabel } from "../cloud-environment";
import { syncNow } from "../sync-runtime";
import { useFocusTrap } from "@/features/auth/components/useFocusTrap";
import { formatBytes } from "@/features/my-blocks/errors";
import { estimateLibraryBytes } from "@/features/my-blocks/storage/my-blocks-storage-adapter";
import { getMyBlocksAdapter } from "@/features/my-blocks/storage/my-blocks-singleton";

export function CloudSyncDetailsDialog() {
  const open = useCloudSyncStore((s) => s.detailsOpen);
  const close = useCloudSyncStore((s) => s.closeDetails);
  const status = useCloudSyncStore((s) => s.status);
  const lastSuccessfulSyncAt = useCloudSyncStore((s) => s.lastSuccessfulSyncAt);
  const pendingUploadCount = useCloudSyncStore((s) => s.pendingUploadCount);
  const conflictCount = useCloudSyncStore((s) => s.conflictCount);
  const latestError = useCloudSyncStore((s) => s.latestError);
  const online = useCloudSyncStore((s) => s.online);
  const { user } = useAuth();

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [storageBytes, setStorageBytes] = useState(0);
  const [blockCount, setBlockCount] = useState(0);

  useFocusTrap(open, dialogRef);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const result = await getMyBlocksAdapter().listMyBlocks();
      if (cancelled) return;
      if (result.ok) {
        setBlockCount(result.value.length);
        setStorageBytes(estimateLibraryBytes(result.value));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const providerLabel = cloudProviderLabel() || "Local only";
  const formatTime = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "Not synced yet";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-details-title"
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-elevated"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 id="sync-details-title" className="text-lg font-semibold text-text-primary">
              Backup details
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

        <dl className="mt-5 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-muted">Status</dt>
            <dd className="flex items-center gap-1.5 font-medium text-text-primary">
              {status === "synced" && (<><Check className="h-4 w-4 text-emerald-400" /> Synced</>)}
              {status === "syncing" && <span>Syncing…</span>}
              {status === "offline" && (<><AlertTriangle className="h-4 w-4 text-amber-400" /> Offline — changes saved here</>)}
              {status === "error" && (<><AlertTriangle className="h-4 w-4 text-amber-400" /> Sync needs attention</>)}
              {status === "conflict" && (<><AlertTriangle className="h-4 w-4 text-amber-400" /> Conflicts to review</>)}
              {status === "signed-out" && <span>Saved locally</span>}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-muted">Last successful sync</dt>
            <dd className="text-text-primary">{formatTime(lastSuccessfulSyncAt)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-muted">Online</dt>
            <dd className="text-text-primary">{online ? "Yes" : "No"}</dd>
          </div>
          {user && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-text-muted">Account</dt>
              <dd className="truncate text-text-primary">{user.email}</dd>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-muted">Saved pieces on this device</dt>
            <dd className="text-text-primary">{blockCount}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-muted">Storage used by saved pieces</dt>
            <dd className="text-text-primary">{formatBytes(storageBytes)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-muted">Changes waiting to sync</dt>
            <dd className="text-text-primary">{pendingUploadCount}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-muted">Conflicts to review</dt>
            <dd className="text-text-primary">{conflictCount}</dd>
          </div>
        </dl>

        {user && (
          <button
            onClick={() => void syncNow()}
            className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-white transition-all hover:bg-accent-hover"
            type="button"
          >
            <RefreshCw className="h-4 w-4" />
            Sync now
          </button>
        )}

        {latestError && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {latestError.message}
          </div>
        )}

        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="mt-4 flex items-center gap-1 text-xs font-medium text-text-dim transition-colors hover:text-text-primary"
          type="button"
          aria-expanded={showAdvanced}
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
          Advanced details
        </button>
        {showAdvanced && latestError?.cause && (
          <pre className="mt-2 overflow-x-auto rounded-lg bg-base p-3 text-[11px] leading-relaxed text-text-dim">
            {latestError.cause}
          </pre>
        )}
      </div>
    </div>
  );
}
