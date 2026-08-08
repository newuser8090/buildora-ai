"use client";

// ---------------------------------------------------------------------------
// LaunchCenter — the beginner-first finishing hub (Phase P7)
//
// Sections: overall readiness, what's ready, things worth fixing, preview,
// search & sharing, publish. Never blocks publishing for non-critical
// warnings — only truly invalid export/security/schema problems block.
// ---------------------------------------------------------------------------

import { useEffect } from "react";
import {
  Rocket,
  Eye,
  X,
  CheckCircle2,
  AlertTriangle,
  Info,
  Download,
  Globe,
  ExternalLink,
  Clock,
} from "lucide-react";
import { useLaunchCenterStore } from "../store/launch-center-store";
import { useLaunchReadiness } from "../hooks/useLaunchReadiness";
import { useSiteSettingsUiStore } from "@/features/site-settings/store/site-settings-ui-store";
import { usePreviewStore } from "@/features/preview/store/preview-store";
import { usePublishingStore } from "@/features/publishing/store/publishing-store";
import { usePublishing } from "@/features/publishing/hooks/usePublishing";
import { useDomains } from "@/features/publishing/hooks/useDomains";
import { isSafeDeploymentUrl } from "@/features/publishing/domain/domain-utils";
import { providerLabel } from "@/features/publishing/components/provider-labels";
import { LaunchFindingCard } from "./LaunchFindingCard";
import type { LaunchCheck } from "../types";
import type { DeploymentRecord } from "@/features/publishing/types";

export function LaunchCenter() {
  const open = useLaunchCenterStore((s) => s.open);
  const closeLaunchCenter = useLaunchCenterStore((s) => s.closeLaunchCenter);
  const report = useLaunchReadiness();
  const openSiteSettings = useSiteSettingsUiStore((s) => s.openDialog);
  const openPreview = usePreviewStore((s) => s.openPreview);
  const openPublishDialog = usePublishingStore((s) => s.openPublishDialog);
  const openHistory = usePublishingStore((s) => s.openHistory);
  const deployments = usePublishingStore((s) => s.deployments);
  const { publishStatus } = usePublishing();
  const { primaryDomain } = useDomains();

  const liveDeployments = deployments.filter((d) => d.status === "live");
  const activeDeployment: DeploymentRecord | null =
    liveDeployments.length === 0
      ? null
      : liveDeployments.sort((a, b) =>
          (b.activatedAt ?? b.completedAt ?? b.createdAt).localeCompare(
            a.activatedAt ?? a.completedAt ?? a.createdAt,
          ),
        )[0];
  const liveUrl = activeDeployment
    ? (activeDeployment.productionUrl ??
      (activeDeployment.providerId === "vercel" ? activeDeployment.deploymentUrl : activeDeployment.url))
    : undefined;
  const liveUrlSafe =
    liveUrl && activeDeployment && isSafeDeploymentUrl(liveUrl, activeDeployment.providerId)
      ? liveUrl
      : null;
  const lastPublishTime = activeDeployment
    ? formatPublishTime(activeDeployment.completedAt ?? activeDeployment.activatedAt ?? activeDeployment.createdAt)
    : null;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLaunchCenter();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, closeLaunchCenter]);

  // Guided journey / command palette can open Launch Center directly.
  useEffect(() => {
    const onOpen = () => useLaunchCenterStore.getState().openLaunchCenter();
    window.addEventListener("buildora:open-launch-center", onOpen);
    return () => window.removeEventListener("buildora:open-launch-center", onOpen);
  }, []);

  if (!open) return null;

  const passes = report.checks.filter((c) => c.status === "pass");
  const warnings = report.checks.filter(
    (c) => c.status === "warning" || c.status === "fail",
  );
  const infos = report.checks.filter((c) => c.status === "info");

  const scoreTone =
    report.score >= 75
      ? "text-emerald-400"
      : report.score >= 50
        ? "text-amber-400"
        : "text-red-400";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="launch-center-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeLaunchCenter();
      }}
    >
      <div
        className="mx-4 flex w-full max-w-3xl flex-col gap-5 rounded-2xl border border-border bg-secondary p-6 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15">
              <Rocket className="h-5 w-5 text-accent" />
            </div>
            <div>
              <h2
                id="launch-center-title"
                className="text-lg font-semibold tracking-tight text-text-primary"
              >
                Launch Center
              </h2>
              <p className="text-xs text-text-dim">
                Everything you need to check before your website goes live.
              </p>
            </div>
          </div>
          <button
            onClick={closeLaunchCenter}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary"
            aria-label="Close launch center"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Overall readiness */}
        <div className="flex items-center gap-4 rounded-xl border border-border/60 bg-base p-4">
          <div
            className="relative flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-full"
            style={{
              background: `conic-gradient(var(--accent, #7c5cfc) ${report.score * 3.6}deg, var(--border, #e5e5e5) 0deg)`,
            }}
            role="img"
            aria-label={`Site readiness ${report.score} out of 100`}
            data-testid="launch-score"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-base">
              <span className={`text-lg font-bold ${scoreTone}`}>
                {report.score}
              </span>
            </div>
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-text-primary">
              {report.blocked
                ? "A few things must be fixed before publishing"
                : report.score >= 75
                  ? "Your site is ready to launch"
                  : "A few things are worth checking first"}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              {report.blocked
                ? report.blockers[0] ??
                  "Buildora found a problem that would break your published site."
                : report.score >= 75
                  ? "Looks great! Preview it, then publish when you're ready."
                  : "Fixing the items below makes your site more likely to succeed. You can still publish now — warnings never block you."}
            </p>
            {publishStatus === "changes-unpublished" && (
              <p className="mt-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                You&apos;ve made changes since the last publish.
              </p>
            )}
          </div>
        </div>

        {/* What's ready */}
        {passes.length > 0 && (
          <section>
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              What&apos;s ready
            </h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {passes.slice(0, 10).map((c) => (
                <span
                  key={c.id}
                  className="rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1 text-[11px] text-emerald-700 dark:text-emerald-300"
                >
                  {c.title}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Things worth fixing */}
        {warnings.length > 0 && (
          <section>
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              Things worth fixing
            </h3>
            <div className="mt-2 flex flex-col gap-2">
              {warnings.map((c) => (
                <LaunchFindingCard
                  key={c.id}
                  check={c}
                  onFix={(check) => runFixAction(check, {
                    openSiteSettings,
                    openPreview,
                    closeLaunchCenter,
                  })}
                />
              ))}
            </div>
          </section>
        )}

        {/* Informational notes */}
        {infos.length > 0 && (
          <section>
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-dim">
              <Info className="h-3.5 w-3.5" />
              Good to know
            </h3>
            <div className="mt-2 flex flex-col gap-1.5">
              {infos.map((c) => (
                <div
                  key={c.id}
                  className="rounded-lg border border-border/40 bg-base/50 px-3 py-2 text-[11px] text-text-muted"
                >
                  <span className="font-medium text-text-primary">{c.title}.</span>{" "}
                  {c.explanation}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Phase P8 — current live status */}
        {(activeDeployment || primaryDomain) && (
          <section
            className="rounded-xl border border-border/60 bg-base p-4"
            data-testid="launch-live-status"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {activeDeployment?.providerId === "vercel" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : activeDeployment?.providerId === "mock" ? (
                  <Clock className="h-4 w-4 text-accent" />
                ) : (
                  <Rocket className="h-4 w-4 text-text-dim" />
                )}
                <h3 className="text-sm font-semibold text-text-primary">
                  {activeDeployment
                    ? activeDeployment.providerId === "vercel"
                      ? "Your site is live"
                      : activeDeployment.providerId === "mock"
                        ? "Demo site ready"
                        : "Website files ready"
                    : "Custom domain connected"}
                </h3>
                {activeDeployment && (
                  <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
                    {providerLabel(activeDeployment.providerId)}
                  </span>
                )}
              </div>
              {lastPublishTime && (
                <span className="text-[11px] text-text-dim">
                  Last published {lastPublishTime}
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {liveUrlSafe && (
                <a
                  href={liveUrlSafe}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-accent hover:underline"
                  data-testid="launch-live-url"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="truncate">{liveUrlSafe}</span>
                </a>
              )}
              {primaryDomain && (
                <span className="flex items-center gap-1.5 text-xs text-text-muted">
                  <Globe className="h-3.5 w-3.5 text-text-dim" />
                  {primaryDomain.domain}
                </span>
              )}
            </div>
          </section>
        )}

        {/* Actions */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            onClick={() => {
              // Close the Launch Center first: the preview overlay renders
              // before it in the DOM, so it would otherwise sit underneath
              // this modal and block all pointer events.
              closeLaunchCenter();
              openPreview("/");
            }}
            className="flex h-11 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-medium text-text-primary transition-all duration-200 hover:bg-card hover:border-accent/30 active:scale-[0.98]"
            type="button"
            data-testid="launch-preview"
          >
            <Eye className="h-4 w-4" />
            Preview my website
          </button>
          <button
            onClick={() => {
              closeLaunchCenter();
              openSiteSettings("search");
            }}
            className="flex h-11 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-medium text-text-primary transition-all duration-200 hover:bg-card hover:border-accent/30 active:scale-[0.98]"
            type="button"
          >
            <Download className="h-4 w-4" />
            Search & sharing settings
          </button>
          <button
            onClick={() => {
              closeLaunchCenter();
              openHistory();
            }}
            className="flex h-11 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-medium text-text-primary transition-all duration-200 hover:bg-card hover:border-accent/30 active:scale-[0.98]"
            type="button"
            data-testid="launch-manage-publishing"
          >
            <Download className="h-4 w-4" />
            Manage publishing
          </button>
          <button
            onClick={() => {
              closeLaunchCenter();
              openPublishDialog();
            }}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-[0.98]"
            type="button"
            data-testid="launch-publish"
          >
            <Rocket className="h-4 w-4" />
            {publishStatus === "never-published"
              ? "Publish my website"
              : "Publish updates"}
          </button>
        </div>

        <p className="text-center text-[11px] text-text-dim/70">
          Buildora checks what it can, but automated checks can&apos;t find
          everything. A quick look with fresh eyes is always a good idea.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fix actions — route a check's fixActionId to the right UI
// ---------------------------------------------------------------------------

function formatPublishTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function runFixAction(
  check: LaunchCheck,
  deps: {
    openSiteSettings: (tab?: "basics" | "search" | "icon" | "advanced") => void;
    openPreview: (route?: string) => void;
    closeLaunchCenter: () => void;
  },
): void {
  switch (check.fixActionId) {
    case "open-site-settings":
      // Close the Launch Center first: both dialogs are z-50 overlays, so
      // the settings dialog must not render behind the still-open modal.
      deps.closeLaunchCenter();
      deps.openSiteSettings("basics");
      break;
    case "open-seo-settings":
      deps.closeLaunchCenter();
      deps.openSiteSettings("search");
      break;
    case "open-mobile-preview": {
      deps.closeLaunchCenter();
      deps.openPreview("/");
      window.dispatchEvent(new CustomEvent("buildora:preview-device", { detail: "phone" }));
      break;
    }
    case "open-page-settings":
    case "select-section":
    case "open-broken-link":
    default:
      deps.closeLaunchCenter();
      // Fall back to the preview so the user can see the affected area.
      deps.openPreview("/");
      break;
  }
}
