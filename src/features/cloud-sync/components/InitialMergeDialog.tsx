"use client";

// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — initial merge dialog
//
// Shown once when a user signs in on a device that already has saved pieces
// OR whose account already has a cloud library. Never blindly overwrites
// either side. Options:
//   Merge both (recommended) / Upload this device's pieces / Download cloud
//   library / Review differences
//
// Duplicate detection uses content hashes — never names alone.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { X, Loader2, Merge, ArrowUpToLine, ArrowDownToLine, Search } from "lucide-react";
import { useAuth } from "@/features/auth/useAuth";
import { useCloudSyncStore } from "../store/cloud-sync-store";
import { getInitialMergeService, runInitialMergeFlow } from "../sync-runtime";
import { useFocusTrap } from "@/features/auth/components/useFocusTrap";
import type { InitialMergeChoice } from "../types";
import type { InitialMergeSummary } from "../services/initial-merge";

export function InitialMergeDialog() {
  const open = useCloudSyncStore((s) => s.initialMergeOpen);
  const { user } = useAuth();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [summary, setSummary] = useState<InitialMergeSummary | null>(null);
  const [busy, setBusy] = useState<InitialMergeChoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusTrap(open, dialogRef);

  // Render-phase reset when the dialog opens (never sync setState in an effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setSummary(null);
  }

  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    const mergeService = getInitialMergeService();
    if (!mergeService) return;
    void mergeService.computeSummary(user.id).then((s) => {
      if (!cancelled) setSummary(s);
    });
    return () => {
      cancelled = true;
    };
  }, [open, user]);

  if (!open) return null;

  const options: Array<{
    key: InitialMergeChoice;
    label: string;
    description: string;
    icon: React.ReactNode;
    recommended?: boolean;
  }> = [
    {
      key: "merge",
      label: "Merge both",
      description:
        "Keeps everything: pieces only on this device are uploaded, pieces only in the cloud are added here. Matching pieces are linked, not duplicated.",
      icon: <Merge className="h-4 w-4" />,
      recommended: true,
    },
    {
      key: "upload-local",
      label: "Upload this device's pieces",
      description:
        `Adds this device's ${summary?.localOnlyCount ?? 0} piece${(summary?.localOnlyCount ?? 0) === 1 ? "" : "s"} to your account without touching the cloud library.`,
      icon: <ArrowUpToLine className="h-4 w-4" />,
    },
    {
      key: "download-cloud",
      label: "Download cloud library",
      description:
        `Adds your account's ${summary?.cloudOnlyCount ?? 0} piece${(summary?.cloudOnlyCount ?? 0) === 1 ? "" : "s"} to this device without touching what's already here.`,
      icon: <ArrowDownToLine className="h-4 w-4" />,
    },
    {
      key: "review",
      label: "Review differences",
      description:
        "No automatic changes. Sync later, and Buildora will ask you about anything that differs.",
      icon: <Search className="h-4 w-4" />,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-title"
        className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-elevated"
      >
        <div className="flex items-start justify-between">
          <h2 id="merge-title" className="text-lg font-semibold text-text-primary">
            Buildora found saved pieces on this device and in your account
          </h2>
          <button
            onClick={() => useCloudSyncStore.getState().closeInitialMerge()}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-base hover:text-text-primary"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {summary && (
          <p className="mt-2 text-sm text-text-muted">
            This device has <span className="font-medium text-text-primary">{summary.localCount}</span> saved
            piece{summary.localCount === 1 ? "" : "s"} and your account has{" "}
            <span className="font-medium text-text-primary">{summary.cloudCount}</span>.{" "}
            {summary.matchedCount > 0 &&
              `${summary.matchedCount} match${summary.matchedCount === 1 ? "" : "es"} by content.`}
          </p>
        )}

        <div className="mt-5 space-y-2.5">
          {options.map((option) => (
            <button
              key={option.key}
              onClick={() => {
                if (busy) return;
                setBusy(option.key);
                setError(null);
                void runInitialMergeFlow(option.key).catch(() => {
                  setError("That didn't work. Your pieces are still safe — try again.");
                  setBusy(null);
                });
              }}
              disabled={busy !== null}
              className={`group flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-all duration-200 hover:border-accent/40 hover:bg-accent/5 disabled:opacity-60 ${
                option.recommended ? "border-accent/40 bg-accent/5" : "border-border"
              }`}
              type="button"
            >
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-base text-text-dim transition-colors group-hover:text-accent">
                {busy === option.key ? <Loader2 className="h-4 w-4 animate-spin" /> : option.icon}
              </span>
              <span>
                <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
                  {option.label}
                  {option.recommended && (
                    <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
                      Recommended
                    </span>
                  )}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-text-muted">
                  {option.description}
                </span>
              </span>
            </button>
          ))}
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
