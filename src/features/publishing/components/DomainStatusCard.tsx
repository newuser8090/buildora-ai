"use client";

// ---------------------------------------------------------------------------
// DomainStatusCard — a single custom domain (Phase P8)
// ---------------------------------------------------------------------------

import { useCallback, useState } from "react";
import {
  Globe,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ExternalLink,
  Copy,
  Loader2,
  X,
  ShieldCheck,
} from "lucide-react";
import type { DeploymentDomainRecord } from "../domain/types";
import { isSafeDeploymentUrl } from "../domain/domain-utils";

export interface DomainStatusCardProps {
  record: DeploymentDomainRecord;
  onCheckAgain: (record: DeploymentDomainRecord) => Promise<unknown>;
  onRemove: (record: DeploymentDomainRecord) => Promise<unknown>;
}

export function DomainStatusCard({ record, onCheckAgain, onRemove }: DomainStatusCardProps) {
  const [busy, setBusy] = useState<"check" | "remove" | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verified = record.status === "verified";
  const url = verified ? `https://${record.domain}` : null;
  const urlSafe = url && isSafeDeploymentUrl(url) ? url : null;

  const copyLink = useCallback(async () => {
    if (!urlSafe) return;
    try {
      await navigator.clipboard.writeText(urlSafe);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy the link.");
    }
  }, [urlSafe]);

  const handleCheckAgain = useCallback(async () => {
    if (busy) return;
    setBusy("check");
    setError(null);
    try {
      await onCheckAgain(record);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't check the domain.");
    } finally {
      setBusy(null);
    }
  }, [busy, onCheckAgain, record]);

  const handleRemove = useCallback(async () => {
    if (busy) return;
    setBusy("remove");
    setError(null);
    try {
      await onRemove(record);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove the domain.");
    } finally {
      setBusy(null);
    }
  }, [busy, onRemove, record]);

  return (
    <div
      className={`rounded-xl border p-3 transition-colors ${
        verified ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/60 bg-base"
      }`}
      data-testid={`domain-card-${record.domain}`}
    >
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-text-dim" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
          {record.domain}
        </span>
        {record.primary && (
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
            Primary
          </span>
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
        {verified ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              Connected
            </span>
            {record.httpsReady && (
              <span className="ml-1 flex items-center gap-1 text-text-dim">
                <ShieldCheck className="h-3 w-3" />
                Secure connection ready
              </span>
            )}
          </>
        ) : record.status === "failed" || record.status === "misconfigured" ? (
          <>
            <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
            <span className="font-medium text-red-400">
              {record.errorSummary ?? "We couldn't verify your domain yet."}
            </span>
          </>
        ) : (
          <>
            <Clock className="h-3.5 w-3.5 animate-pulse text-amber-500" />
            <span className="font-medium text-amber-600 dark:text-amber-400">
              Still connecting
            </span>
            <span className="text-text-dim">— DNS changes can take a little while.</span>
          </>
        )}
      </div>

      {error && (
        <p className="mt-1.5 text-[11px] text-red-400">{error}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {urlSafe && (
          <>
            <a
              href={urlSafe}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 text-[11px] font-medium text-white transition-colors hover:bg-accent-hover"
              data-testid={`domain-open-${record.domain}`}
            >
              <ExternalLink className="h-3 w-3" />
              Open site
            </a>
            <button
              onClick={copyLink}
              className="flex h-7 items-center gap-1 rounded-md border border-border px-2.5 text-[11px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
              type="button"
              data-testid={`domain-copy-${record.domain}`}
            >
              {copied ? (
                <span className="text-emerald-500">Copied!</span>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  Copy link
                </>
              )}
            </button>
          </>
        )}
        {!verified && (
          <button
            onClick={handleCheckAgain}
            disabled={busy !== null}
            className="flex h-7 items-center gap-1 rounded-md border border-border px-2.5 text-[11px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary disabled:opacity-50"
            type="button"
            data-testid={`domain-check-${record.domain}`}
          >
            {busy === "check" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Clock className="h-3 w-3" />
            )}
            Check again
          </button>
        )}
        <button
          onClick={handleRemove}
          disabled={busy !== null}
          className="ml-auto flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
          type="button"
          aria-label={`Remove domain ${record.domain}`}
          data-testid={`domain-remove-${record.domain}`}
        >
          {busy === "remove" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <X className="h-3 w-3" />
          )}
          Remove
        </button>
      </div>
    </div>
  );
}
