"use client";

// ---------------------------------------------------------------------------
// DeploymentCard — one deployment in the history list (Phase P7)
//
// Shows status, time, provider, URL, project revision, and current/latest
// indicator. Actions: Open, Republish, Restore (rollback), Delete.
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
} from "lucide-react";
import type { DeploymentRecord } from "../types";
import { usePublishing } from "../hooks/usePublishing";

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
  const [busy, setBusy] = useState<"republish" | "delete" | null>(null);

  const isLive = deployment.status === "live";

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
        {active && (
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
            Current
          </span>
        )}
        <span className="ml-auto text-[11px] text-text-dim">
          {formatTime(deployment.completedAt ?? deployment.createdAt)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-dim">
        <span>
          {deployment.providerId === "mock" ? "Demo publish" : "Website files"}
        </span>
        <span>·</span>
        <span>Revision {deployment.projectRevision}</span>
        {deployment.errorCode && (
          <>
            <span>·</span>
            <span className="text-red-400">{deployment.errorCode}</span>
          </>
        )}
      </div>

      {deployment.url && (
        <a
          href={deployment.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 flex items-center gap-1.5 text-[11px] text-accent hover:underline"
          data-testid="deployment-url"
        >
          <ExternalLink className="h-3 w-3" />
          <span className="truncate">{deployment.url}</span>
        </a>
      )}

      <div className="mt-2 flex items-center gap-2">
        {isLive && !active && (
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
      </div>
    </div>
  );
}
