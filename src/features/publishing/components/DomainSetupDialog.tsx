"use client";

// ---------------------------------------------------------------------------
// DomainSetupDialog — the beginner custom-domain flow (Phase P8)
//
//   1. Enter your domain (example.com — no https:// needed)
//   2. Buildora attaches it with the hosting provider
//   3. Show exactly what needs to change (DNS records)
//   4. "Check again" (and gentle auto-poll while open)
//   5. Verified → "Your domain is connected."
//
// DNS management stays with the user's registrar; Buildora only attaches,
// explains, and checks. Polling is bounded to the dialog being open.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Globe, CheckCircle2, Loader2, Copy, Rocket } from "lucide-react";
import { usePublishingStore } from "../store/publishing-store";
import { usePublishing } from "../hooks/usePublishing";
import { useDomains } from "../hooks/useDomains";
import { validateDomainInput } from "../domain/domain-utils";
import { DomainInstructions } from "./DomainInstructions";
import { DomainStatusCard } from "./DomainStatusCard";
import type { DeploymentDomainRecord } from "../domain/types";

const POLL_INTERVAL_MS = 4_000;

export function DomainSetupDialog() {
  const open = usePublishingStore((s) => s.domainDialogOpen);
  const closeDialog = usePublishingStore((s) => s.closeDomainDialog);
  const deployments = usePublishingStore((s) => s.deployments);
  const { publishStatus } = usePublishing();
  const {
    domains,
    loading,
    supportsDomains,
    attach,
    refreshStatus,
    remove,
  } = useDomains();

  const [input, setInput] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const busyRef = useRef(false);

  const hasLiveVercelDeployment = useMemo(
    () => deployments.some((d) => d.providerId === "vercel" && d.status === "live"),
    [deployments],
  );

  // Gentle validation while typing (only after the user has typed something).
  const liveValidation = useMemo(() => {
    if (input.trim().length === 0) return { valid: true as const };
    return validateDomainInput(input);
  }, [input]);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDialog();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, closeDialog]);

  // Bounded auto-poll for pending domains while the dialog is open. The
  // interval itself is created whenever the dialog opens and stays alive; each
  // tick reads the LATEST pending list from the ref (never a stale capture).
  // This matters because a domain is usually attached AFTER the dialog is open
  // — an effect that bailed out early on the initial empty list would never
  // start polling the newly attached domain.
  const pendingRef = useRef<DeploymentDomainRecord[]>([]);
  useEffect(() => {
    pendingRef.current = domains.filter((d) => d.status === "pending" || d.status === "misconfigured");
  }, [domains]);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => {
      const target = pendingRef.current[0];
      if (target && !busyRef.current) {
        void refreshStatus(target);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [open, refreshStatus]);

  const handleAttach = useCallback(async () => {
    if (attaching || !supportsDomains) return;
    setAttachError(null);
    setValidationError(null);
    const validation = validateDomainInput(input);
    if (!validation.valid) {
      setValidationError(validation.error ?? "Enter a valid domain.");
      return;
    }
    setAttaching(true);
    busyRef.current = true;
    try {
      const result = await attach(input);
      if (!result.ok) {
        setAttachError(result.error.message);
        return;
      }
      setInput("");
    } finally {
      setAttaching(false);
      busyRef.current = false;
    }
  }, [attaching, supportsDomains, input, attach]);

  const copyPrimaryLink = useCallback(async () => {
    const primary = domains.find((d) => d.status === "verified");
    if (!primary) return;
    try {
      await navigator.clipboard.writeText(`https://${primary.domain}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — buttons still work
    }
  }, [domains]);

  if (!open) return null;

  const verifiedDomains = domains.filter((d) => d.status === "verified");
  const pendingDomains = domains.filter((d) => d.status !== "verified");
  const primary = domains.find((d) => d.primary) ?? verifiedDomains[0];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="domain-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeDialog();
      }}
    >
      <div className="mx-4 flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-secondary shadow-elevated">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15">
              <Globe className="h-4 w-4 text-accent" />
            </div>
            <div>
              <h2
                id="domain-dialog-title"
                className="text-sm font-semibold text-text-primary"
              >
                Connect your own domain
              </h2>
              <p className="mt-0.5 text-xs text-text-dim">
                Use your own address — like example.com — for your site.
              </p>
            </div>
          </div>
          <button
            onClick={closeDialog}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary"
            aria-label="Close domain dialog"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!supportsDomains ? (
            <p className="text-sm text-text-muted">
              Custom domains aren&apos;t available for this publishing option.
            </p>
          ) : !hasLiveVercelDeployment ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <Rocket className="h-9 w-9 text-text-dim/40" />
              <p className="max-w-xs text-sm text-text-muted">
                Publish your site first — your domain connects to your live
                site.
              </p>
              <p className="text-xs text-text-dim">
                {publishStatus === "never-published"
                  ? "You haven&apos;t published yet."
                  : "Publish with Vercel to unlock custom domains."}
              </p>
            </div>
          ) : (
            <>
              {/* Success banner */}
              {verifiedDomains.length > 0 && (
                <div
                  className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3"
                  data-testid="domain-success"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                      Your domain is connected.
                    </p>
                    <p className="mt-0.5 text-xs text-text-dim">
                      {primary ? (
                        <a
                          href={`https://${primary.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:underline"
                          data-testid="domain-success-open"
                        >
                          {primary.domain}
                        </a>
                      ) : (
                        "Open your site below."
                      )}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 gap-1.5">
                    <button
                      onClick={copyPrimaryLink}
                      className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
                      type="button"
                      data-testid="domain-success-copy"
                    >
                      {copied ? (
                        <span className="text-emerald-500">Copied!</span>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Copy
                        </>
                      )}
                    </button>
                    <button
                      onClick={closeDialog}
                      className="flex h-7 items-center rounded-md bg-accent px-2.5 text-[11px] font-medium text-white transition-colors hover:bg-accent-hover"
                      type="button"
                      data-testid="domain-success-done"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}

              {/* Input */}
              <div className="mt-4">
                <label
                  htmlFor="domain-input"
                  className="text-xs font-medium text-text-primary"
                >
                  Your domain
                </label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    id="domain-input"
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      setValidationError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleAttach();
                    }}
                    placeholder="example.com"
                    className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-base px-3 text-sm text-text-primary placeholder:text-text-dim/50 transition-all focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20"
                    data-testid="domain-input"
                    aria-describedby="domain-helper domain-validation"
                    aria-invalid={!liveValidation.valid || !!validationError}
                  />
                  <button
                    onClick={handleAttach}
                    disabled={attaching || !liveValidation.valid}
                    className="flex h-10 flex-shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:opacity-50"
                    type="button"
                    data-testid="domain-attach"
                  >
                    {attaching ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Globe className="h-4 w-4" />
                    )}
                    Connect
                  </button>
                </div>
                <p id="domain-helper" className="mt-1.5 text-[11px] text-text-dim">
                  Enter just the domain — no https:// needed.
                </p>
                {(!liveValidation.valid || validationError) && (
                  <p id="domain-validation" className="mt-1 text-[11px] text-amber-500">
                    {validationError ?? liveValidation.error}
                  </p>
                )}
                {attachError && (
                  <p className="mt-1.5 text-[11px] text-red-400" data-testid="domain-attach-error">
                    {attachError}
                  </p>
                )}
              </div>

              {/* Pending domain → instructions */}
              {pendingDomains.map((record) => (
                <div key={record.id} className="mt-4 flex flex-col gap-2">
                  <DomainStatusCard
                    record={record}
                    onCheckAgain={refreshStatus}
                    onRemove={remove}
                  />
                  {record.verification && record.verification.length > 0 && (
                    <DomainInstructions
                      instructions={record.verification}
                      domain={record.domain}
                    />
                  )}
                </div>
              ))}

              {/* Verified domains */}
              {verifiedDomains.map((record) => (
                <div key={record.id} className="mt-3">
                  <DomainStatusCard
                    record={record}
                    onCheckAgain={refreshStatus}
                    onRemove={remove}
                  />
                </div>
              ))}

              {loading && domains.length === 0 && (
                <p className="mt-4 text-xs text-text-dim">Loading domains…</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
