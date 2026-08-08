"use client";

// ---------------------------------------------------------------------------
// DeploymentDetailsDialog — the advanced-but-beginner-safe deployment view
// (Phase P8)
//
// Shows provider, status, published time, live/preview URLs, project
// revision, export hash, duration, build stages, advanced provider id, and a
// sanitized error summary on failure. Actions are derived from the
// provider's declared capabilities — never hard-coded provider names.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import {
  X,
  ExternalLink,
  Copy,
  RefreshCw,
  RotateCcw,
  Ban,
  Trash2,
  Globe,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { usePublishingStore } from "../store/publishing-store";
import { usePublishing } from "../hooks/usePublishing";
import { getPublishingProvider } from "../providers";
import { getPublishBearerToken } from "../client-auth";
import { isSafeDeploymentUrl } from "../domain/domain-utils";
import { providerLabel, formatDuration } from "./provider-labels";
import type { DeploymentStatus } from "../types";
import type { DeploymentLogEntry } from "../server/publish-api-types";

function statusMeta(status: DeploymentStatus) {
  switch (status) {
    case "live":
      return { label: "Live", tone: "text-emerald-500", icon: CheckCircle2 };
    case "failed":
      return { label: "Failed", tone: "text-red-500", icon: XCircle };
    case "cancelled":
      return { label: "Cancelled", tone: "text-text-dim", icon: Ban };
    case "building":
      return { label: "Building", tone: "text-amber-500", icon: Loader2 };
    case "uploading":
      return { label: "Uploading", tone: "text-amber-500", icon: Loader2 };
    default:
      return { label: "Queued", tone: "text-text-dim", icon: Clock };
  }
}

function formatTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function DeploymentDetailsDialog() {
  const deploymentId = usePublishingStore((s) => s.detailsDeploymentId);
  const closeDetails = usePublishingStore((s) => s.closeDetails);
  const openDomainDialog = usePublishingStore((s) => s.openDomainDialog);
  const deployments = usePublishingStore((s) => s.deployments);
  const { publish, rollback, cancelDeployment, deleteDeployment } = usePublishing();

  const deployment = deployments.find((d) => d.id === deploymentId) ?? null;
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<"republish" | "rollback" | "cancel" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRollback, setConfirmRollback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [logs, setLogs] = useState<DeploymentLogEntry[] | null>(null);

  const provider = deployment ? getPublishingProvider(deployment.providerId) : undefined;
  const capabilities = provider?.capabilities;

  const activeDeployment = deployments
    .filter((d) => d.status === "live")
    .sort((a, b) =>
      (b.activatedAt ?? b.completedAt ?? b.createdAt).localeCompare(
        a.activatedAt ?? a.completedAt ?? a.createdAt,
      ),
    )[0];
  const isActive = activeDeployment?.id === deployment?.id;

  // Escape to close.
  useEffect(() => {
    if (!deploymentId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDetails();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deploymentId, closeDetails]);

  // Reset ephemeral state when the target changes. Wrapped in
  // requestAnimationFrame to avoid set-state-in-effect lint rule (the state
  // just needs to be fresh by the next paint — the dialog content is keyed by
  // the deployment anyway).
  useEffect(() => {
    if (!deploymentId) return;
    const id = requestAnimationFrame(() => {
      setConfirmDelete(false);
      setConfirmRollback(false);
      setError(null);
      setShowAdvanced(false);
      setLogs(null);
      setCopied(false);
    });
    return () => cancelAnimationFrame(id);
  }, [deploymentId]);

  // Load sanitized build details when the provider supports logs. The logs
  // route is session-protected like every privileged provider call, so the
  // bearer token is attached here too (never a credential in the bundle —
  // it's the user's own session token).
  useEffect(() => {
    if (!deploymentId || !deployment || !capabilities?.deploymentLogs) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await getPublishBearerToken();
        const res = await fetch(
          `/api/publish/vercel/deployments/${encodeURIComponent(deployment.providerDeploymentId ?? deploymentId)}/logs`,
          { method: "GET", headers: token ? { Authorization: `Bearer ${token}` } : undefined },
        );
        const envelope = (await res.json().catch(() => null)) as
          | { ok: true; data: { entries: DeploymentLogEntry[] } }
          | { ok: false }
          | null;
        if (!cancelled && envelope?.ok) setLogs(envelope.data.entries.slice(0, 8));
      } catch {
        // Logs are optional — never block the dialog.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deploymentId]);

  const liveUrl = deployment ? (deployment.productionUrl ?? deployment.url) : null;
  const liveUrlSafe =
    liveUrl && deployment && isSafeDeploymentUrl(liveUrl, deployment.providerId) ? liveUrl : null;
  const previewUrlSafe =
    deployment?.previewUrl &&
    isSafeDeploymentUrl(deployment.previewUrl, deployment.providerId)
      ? deployment.previewUrl
      : null;

  // Plain function (not useCallback) — the React Compiler can't preserve the
  // manual memoization across the early return below, so memoizing here would
  // only disable its optimization.
  const copyLink = async () => {
    if (!liveUrlSafe) return;
    try {
      await navigator.clipboard.writeText(liveUrlSafe);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy the link. Try selecting it manually.");
    }
  };

  if (!deploymentId || !deployment) return null;

  const meta = statusMeta(deployment.status);
  const StatusIcon = meta.icon;

  const handleRepublish = async () => {
    if (busy) return;
    setBusy("republish");
    setError(null);
    try {
      await publish(deployment.providerId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publishing failed.");
    } finally {
      setBusy(null);
    }
  };

  const handleRollback = async () => {
    if (busy) return;
    setBusy("rollback");
    setError(null);
    try {
      const result = await rollback(deployment.id);
      if (!result.ok) setError(result.error.message);
      else {
        setConfirmRollback(false);
        closeDetails();
      }
    } finally {
      setBusy(null);
    }
  };

  const handleCancel = async () => {
    if (busy) return;
    setBusy("cancel");
    setError(null);
    try {
      const result = await cancelDeployment(deployment.id);
      if (!result.ok) setError(result.error.message);
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (busy) return;
    setBusy("delete");
    setError(null);
    try {
      const result = await deleteDeployment(deployment.id);
      if (!result.ok) setError(result.error.message);
      else closeDetails();
    } finally {
      setBusy(null);
    }
  };

  const duration = formatDuration(
    deployment.buildStartedAt ?? deployment.createdAt,
    deployment.buildCompletedAt ?? deployment.completedAt,
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deployment-details-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeDetails();
      }}
    >
      <div className="mx-4 flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-secondary shadow-elevated">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2
              id="deployment-details-title"
              className="text-sm font-semibold text-text-primary"
            >
              Deployment details
            </h2>
            <p className="mt-0.5 text-xs text-text-dim">
              {providerLabel(deployment.providerId)} · Published from revision{" "}
              {deployment.projectRevision}
            </p>
          </div>
          <button
            onClick={closeDetails}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary"
            aria-label="Close deployment details"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* Status row */}
          <div className="flex items-center gap-2">
            <StatusIcon className={`h-4 w-4 ${meta.tone} ${deployment.status === "building" || deployment.status === "uploading" ? "animate-spin" : ""}`} />
            <span className={`text-sm font-medium ${meta.tone}`}>{meta.label}</span>
            {isActive && (
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                Current live version
              </span>
            )}
            {deployment.providerId === "mock" && (
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent">
                Demo — not public
              </span>
            )}
          </div>

          {deployment.status === "failed" && deployment.errorCode && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
              <XCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-400" />
              <p className="text-xs text-red-400">
                {deployment.providerErrorSummary ??
                  "Your site couldn't finish publishing. Try again, or download the website files instead."}
              </p>
            </div>
          )}

          {/* URLs */}
          {(liveUrlSafe || previewUrlSafe) && (
            <div className="mt-4 flex flex-col gap-2">
              {liveUrlSafe && (
                <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-base px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-left text-xs text-text-muted">
                    {liveUrlSafe}
                  </span>
                  <button
                    onClick={copyLink}
                    className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
                    type="button"
                    data-testid="details-copy-link"
                  >
                    {copied ? (
                      <span className="text-emerald-500">Copied!</span>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy
                      </>
                    )}
                  </button>
                  <a
                    href={liveUrlSafe}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-accent transition-colors hover:bg-accent/10"
                    data-testid="details-open-site"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open
                  </a>
                </div>
              )}
              {previewUrlSafe && previewUrlSafe !== liveUrlSafe && (
                <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-base/60 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-left text-xs text-text-dim">
                    Preview: {previewUrlSafe}
                  </span>
                  <a
                    href={previewUrlSafe}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-medium text-text-dim hover:text-text-primary"
                  >
                    Open
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Facts */}
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
            <div>
              <dt className="text-text-dim">Published</dt>
              <dd className="mt-0.5 text-text-primary">
                {formatTime(deployment.completedAt ?? deployment.activatedAt ?? deployment.createdAt)}
              </dd>
            </div>
            <div>
              <dt className="text-text-dim">Duration</dt>
              <dd className="mt-0.5 text-text-primary">{duration ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-text-dim">Revision</dt>
              <dd className="mt-0.5 text-text-primary">
                Published from revision {deployment.projectRevision}
              </dd>
            </div>
            <div>
              <dt className="text-text-dim">Export hash</dt>
              <dd className="mt-0.5 font-mono text-[11px] text-text-primary">
                {deployment.exportHash}
              </dd>
            </div>
          </dl>

          {/* Build stages */}
          {capabilities?.deploymentLogs && logs && logs.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-dim">
                Build details
              </h3>
              <ul className="mt-2 flex flex-col gap-1.5">
                {logs.map((entry, index) => (
                  <li
                    key={`${entry.stage}-${index}`}
                    className="flex items-center gap-2 rounded-lg border border-border/40 bg-base/60 px-3 py-2 text-[11px]"
                  >
                    {entry.level === "error" ? (
                      <XCircle className="h-3 w-3 flex-shrink-0 text-red-400" />
                    ) : entry.level === "warn" ? (
                      <Clock className="h-3 w-3 flex-shrink-0 text-amber-400" />
                    ) : (
                      <CheckCircle2 className="h-3 w-3 flex-shrink-0 text-emerald-400" />
                    )}
                    <span className="font-medium text-text-primary">{entry.stage}</span>
                    <span className="min-w-0 flex-1 truncate text-text-dim">{entry.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Advanced provider info */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="mt-4 flex items-center gap-1 text-[11px] text-text-dim transition-colors hover:text-text-primary"
            type="button"
            aria-expanded={showAdvanced}
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
            Advanced provider info
          </button>
          {showAdvanced && (
            <dl className="mt-2 flex flex-col gap-1.5 rounded-lg border border-border/40 bg-base px-3 py-2.5 text-[11px]">
              <div className="flex justify-between gap-2">
                <dt className="text-text-dim">Provider deployment id</dt>
                <dd className="font-mono text-text-primary">
                  {deployment.providerDeploymentId ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-text-dim">Provider state</dt>
                <dd className="font-mono text-text-primary">{deployment.providerState ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-text-dim">Provider project</dt>
                <dd className="font-mono text-text-primary">{deployment.providerProjectName ?? "—"}</dd>
              </div>
            </dl>
          )}

          {error && (
            <p className="mt-3 text-xs text-red-400" data-testid="details-error">
              {error}
            </p>
          )}
        </div>

        {/* Actions (capability-driven) */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          {capabilities?.customDomains && deployment.status === "live" && (
            <button
              onClick={openDomainDialog}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
              type="button"
              data-testid="details-manage-domain"
            >
              <Globe className="h-3.5 w-3.5" />
              Manage domain
            </button>
          )}
          {capabilities?.rollback && deployment.status === "live" && (
            <button
              onClick={handleRepublish}
              disabled={busy !== null}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary disabled:opacity-50"
              type="button"
              data-testid="details-republish"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy === "republish" ? "animate-spin" : ""}`} />
              Republish
            </button>
          )}
          {capabilities?.rollback && deployment.status === "live" && !isActive && (
            <button
              onClick={() => setConfirmRollback(true)}
              disabled={busy !== null}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary disabled:opacity-50"
              type="button"
              data-testid="details-rollback"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Roll back to this version
            </button>
          )}
          {capabilities?.cancelDeployment &&
            (deployment.status === "queued" ||
              deployment.status === "building" ||
              deployment.status === "uploading") && (
              <button
                onClick={handleCancel}
                disabled={busy !== null}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary disabled:opacity-50"
                type="button"
                data-testid="details-cancel"
              >
                <Ban className="h-3.5 w-3.5" />
                Cancel publish
              </button>
            )}
          {capabilities?.deleteDeployment && (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={busy !== null}
              className="ml-auto flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
              type="button"
              data-testid="details-delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Rollback confirmation */}
      {confirmRollback && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="details-rollback-title"
        >
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-elevated">
            <h3 id="details-rollback-title" className="text-base font-semibold text-text-primary">
              Roll back to this version?
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-text-muted">
              The live site will go back to this version. Your project in the
              editor is not changed — only which version is live.
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => setConfirmRollback(false)}
                className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted hover:bg-base"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={handleRollback}
                disabled={busy !== null}
                className="flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                type="button"
                data-testid="details-rollback-confirm"
              >
                {busy === "rollback" ? "Working…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="details-delete-title"
        >
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-elevated">
            <h3 id="details-delete-title" className="text-base font-semibold text-text-primary">
              Delete this deployment?
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-text-muted">
              {isActive
                ? "This is the current live version. Deleting it removes the publish record; the live site may be affected."
                : "This removes the deployment and its history. This can't be undone."}
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted hover:bg-base"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={busy !== null}
                className="flex h-9 items-center rounded-lg bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
                type="button"
                data-testid="details-delete-confirm"
              >
                {busy === "delete" ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
