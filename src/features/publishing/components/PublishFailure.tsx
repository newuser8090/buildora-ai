"use client";

// ---------------------------------------------------------------------------
// PublishFailure — user-safe publish failure with retry (Phase P7 + P8)
//
// "Your site couldn't finish publishing." → simple reason, Retry (publishes
// the CURRENT version again), Download website files, and Build details
// (advanced). Raw provider internals are never shown by default.
// ---------------------------------------------------------------------------

import { useCallback, useState } from "react";
import { AlertTriangle, RefreshCw, Download, Info } from "lucide-react";
import { usePublishingStore } from "../store/publishing-store";
import { usePublishing } from "../hooks/usePublishing";

export function PublishFailure() {
  const result = usePublishingStore((s) => s.lastResult);
  const deployments = usePublishingStore((s) => s.deployments);
  const attemptedProviderId = usePublishingStore((s) => s.attemptedProviderId);
  const openDetails = usePublishingStore((s) => s.openDetails);
  const { publish } = usePublishing();
  const [retrying, setRetrying] = useState(false);

  const error = result?.ok ? null : result?.error;
  const code = error?.code ?? "UNKNOWN";
  const providerId = attemptedProviderId ?? "mock";

  const handleRetry = useCallback(async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      // "Try publishing the current version again." — always the current
      // project content, never an ambiguous snapshot.
      await publish(providerId);
    } finally {
      setRetrying(false);
    }
  }, [publish, providerId, retrying]);

  const handleDownload = useCallback(async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await publish("local-export");
    } finally {
      setRetrying(false);
    }
  }, [publish, retrying]);

  // The failed deployment for this attempt (for Build details).
  const failedDeployment = [...deployments]
    .filter((d) => d.providerId === providerId && d.status === "failed")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  return (
    <div
      className="flex flex-col items-center gap-4 py-2 text-center"
      data-testid="publish-failure"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15">
        <AlertTriangle className="h-7 w-7 text-red-500" />
      </div>
      <div>
        <h3 className="text-lg font-semibold text-text-primary">
          Your site couldn&apos;t finish publishing
        </h3>
        <p className="mx-auto mt-1 max-w-sm text-xs text-text-dim">
          {error?.message ?? "Something went wrong. Please try again."}
        </p>
        {code !== "CANCELLED" && (
          <p className="mt-1 text-[11px] text-text-dim/70">
            Your project is safe — nothing was changed.
          </p>
        )}
      </div>

      <div className="flex w-full flex-col gap-2">
        <button
          onClick={handleRetry}
          disabled={retrying}
          data-testid="publish-retry"
          className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-white transition-all hover:bg-accent-hover disabled:opacity-50"
          type="button"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`} />
          Try publishing the current version again
        </button>
        {code !== "EXPORT_INVALID" && code !== "PROJECT_INVALID" && (
          <button
            onClick={handleDownload}
            disabled={retrying}
            className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary disabled:opacity-50"
            type="button"
          >
            <Download className="h-3.5 w-3.5" />
            Download website files instead
          </button>
        )}
        {failedDeployment && (
          <button
            onClick={() => openDetails(failedDeployment.id)}
            className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
            type="button"
            data-testid="publish-build-details"
          >
            <Info className="h-3.5 w-3.5" />
            Build details
          </button>
        )}
      </div>
    </div>
  );
}
