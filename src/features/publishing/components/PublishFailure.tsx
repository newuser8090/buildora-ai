"use client";

// ---------------------------------------------------------------------------
// PublishFailure — user-safe publish failure with retry (Phase P7)
// ---------------------------------------------------------------------------

import { useCallback, useState } from "react";
import { AlertTriangle, RefreshCw, Download } from "lucide-react";
import { usePublishingStore } from "../store/publishing-store";
import { usePublishing } from "../hooks/usePublishing";

export function PublishFailure() {
  const result = usePublishingStore((s) => s.lastResult);
  const { publish } = usePublishing();
  const [retrying, setRetrying] = useState(false);

  const error = result?.ok ? null : result?.error;
  const code = error?.code ?? "UNKNOWN";

  const handleRetry = useCallback(async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await publish("mock");
    } finally {
      setRetrying(false);
    }
  }, [publish, retrying]);

  const handleDownload = useCallback(async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await publish("local-export");
    } finally {
      setRetrying(false);
    }
  }, [publish, retrying]);

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
          Publishing didn&apos;t finish
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
          Try again
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
      </div>
    </div>
  );
}
