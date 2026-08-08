"use client";

// ---------------------------------------------------------------------------
// DeploymentCard — one deployment in the history list (Phase P7 + P8)
//
// Shows status, time, provider badge, URL, project revision, duration and a
// sanitized failure reason. Actions are derived from the provider's declared
// capabilities (never hard-coded names): Open, Details, Restore (rollback),
// Delete.
// ---------------------------------------------------------------------------

import { useCallback, useState } from "react";
import {
  ExternalLink,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  Trash2,
  Loader2,
  Info,
} from "lucide-react";
import type { DeploymentRecord } from "../types";
import { usePublishing } from "../hooks/usePublishing";
import { usePublishingStore } from "../store/publishing-store";
import { getPublishingProvider } from "../providers";
import { isSafeDeploymentUrl } from "../domain/domain-utils";
import { providerLabel, formatDuration } from "./provider-labels";

export interface DeploymentCardProps {
  deployment: DeploymentRecord;
  active: boolean;
  onRollback: (deployment: DeploymentRecord) => void;
  onDeleted: () => void;
}

function statusLabel(status: DeploymentRecord["status"]): string {
  switch (status) {
    case "live":
      return "Live";
    case "building":
      return "Building";
    case "uploading":
      return "Uploading";
    case "queued":
      return "Queued";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function DeploymentCard({
  deployment,
  active,
  onRollback,
  onDeleted,
}: DeploymentCardProps) {
  const { publish, deleteDeployment } = usePublishing();
  const openDetails = usePublishingStore((s) => s.openDetails);
  const [busy, setBusy] = useState<"republish" | "delete" | null>(null);

  const isLive = deployment.status === "live";
  const provider = getPublishingProvider(deployment.providerId);
  const capabilities = provider?.capabilities;

  const liveUrl =
    deployment.productionUrl ??
    (deployment.providerId === "vercel" ? deployment.deploymentUrl : deployment.url);
  const liveUrlSafe = liveUrl && isSafeDeploymentUrl(liveUrl, deployment.providerId) ? liveUrl : null;
  const duration = formatDuration(
    deployment.buildStartedAt ?? deployment.createdAt,
    deployment.buildCompletedAt ?? deployment.completedAt,
  );

  const handleRepublish = useCallback(async () => {
    if (busy) return;
    setBusy("republish");
    try {
      await publish(deployment.providerId);
    } finally {
      setBusy(null);
    }
  }, [busy, publish, deployment.providerId]);

  const handleDelete = useCallback(async () => {
    if (busy) return;
    setBusy("delete");
    try {
      const result = await deleteDeployment(deployment.id);
      if (result.ok) onDeleted();
    } finally {
      setBusy(null);
    }
  }, [busy, deleteDeployment, deployment.id, onDeleted]);

  return (
    <div
      className={`rounded-xl border p-3 transition-colors ${
        active ? "border-accent/40 bg-accent/5" : "border-border/60 bg-base"
      }`}
      data-testid="deployment-card"
    >
      <div className="flex items-center gap-2">
        {isLive ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : deployment.status === "failed" ? (
          <XCircle className="h-4 w-4 text-red-500" />
        ) : (
          <Clock className="h-4 w-4 text-text-dim" />
        )}
        <span className="text-sm font-medium text-text-primary">
          {statusLabel(deployment.status)}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            deployment.providerId === "vercel"
              ? "bg-accent/15 text-accent"
              : deployment.providerId === "mock"
                ? "bg-card text-text-dim"
                : "bg-card text-text-dim"
          }`}
        >
          {providerLabel(deployment.providerId)}
        </span>
        {active && (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
            Current
          </span>
        )}
        <span className="ml-auto text-[11px] text-text-dim">
          {formatTime(deployment.completedAt ?? deployment.activatedAt ?? deployment.createdAt)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-dim">
        <span>Published from revision {deployment.projectRevision}</span>
        {duration && (
          <>
            <span>·</span>
            <span>{duration}</span>
          </>
        )}
        {deployment.status === "failed" && deployment.errorCode && (
          <>
            <span>·</span>
            <span className="text-red-400" data-testid="deployment-failed-reason">
              {deployment.providerErrorSummary ?? deployment.errorCode}
            </span>
          </>
        )}
      </div>

      {liveUrlSafe && (
        <a
          href={liveUrlSafe}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 flex items-center gap-1.5 text-[11px] text-accent hover:underline"
          data-testid="deployment-url"
        >
          <ExternalLink className="h-3 w-3" />
          <span className="truncate">{liveUrlSafe}</span>
        </a>
      )}

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => openDetails(deployment.id)}
          className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
          type="button"
          data-testid="deployment-details"
        >
          <Info className="h-3 w-3" />
          Details
        </button>
        {capabilities?.rollback && isLive && !active && (
          <button
            onClick={() => onRollback(deployment)}
            className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
            type="button"
            data-testid="deployment-rollback"
          >
            <RotateCcw className="h-3 w-3" />
            Restore this version
          </button>
        )}
        {isLive && (
          <button
            onClick={handleRepublish}
            disabled={busy !== null}
            className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary disabled:opacity-50"
            type="button"
          >
            {busy === "republish" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ExternalLink className="h-3 w-3" />
            )}
            Publish this version again
          </button>
        )}
        {capabilities?.deleteDeployment && (
          <button
            onClick={handleDelete}
            disabled={busy !== null}
            className="ml-auto flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
            type="button"
            aria-label={`Delete deployment ${deployment.id}`}
          >
            {busy === "delete" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
