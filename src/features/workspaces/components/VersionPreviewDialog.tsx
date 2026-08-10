"use client";

// ---------------------------------------------------------------------------
// Phase P15 — VersionPreviewDialog
//
// Read-only preview of an older version. Renders the version SNAPSHOT directly
// (never replaces the active project), with a clear "Viewing version from …"
// banner and a Return-to-current-version action. Page switching works within
// the snapshot only; internal links navigate, everything else is inert.
//
// The outer shell renders nothing when closed and mounts the inner preview
// fresh (keyed by version id) on every open — so loading/error state derives
// at mount and the lazy snapshot fetch only commits state after awaited calls.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, ShieldAlert, X, Eye } from "lucide-react";
import { getWorkspaceProvider, WorkspaceService } from "../services/workspace-service";
import { useWorkspaceHistoryUiStore } from "../store/workspace-history-ui-store";
import { useWorkspaceAccessStore } from "../store/workspace-access-store";
import type { ProjectVersionFull, ProjectVersionMeta } from "../types";
import { absoluteTime } from "../utils/time";
import { computePageRoutes } from "@/features/routing/routes";
import { VisitorPageView } from "@/features/preview/components/VisitorPageView";

export function VersionPreviewDialog() {
  const previewVersion = useWorkspaceHistoryUiStore((s) => s.previewVersion);
  if (!previewVersion) return null;
  return <VersionPreviewDialogInner key={previewVersion.id} version={previewVersion} />;
}

function VersionPreviewDialogInner({ version }: { version: ProjectVersionMeta }) {
  const setPreviewVersion = useWorkspaceHistoryUiStore((s) => s.setPreviewVersion);
  const workspaceId = useWorkspaceAccessStore((s) => s.workspaceId);

  // Loading starts true (a fetch begins immediately on mount below); if the
  // workspace backend or id is missing, the fetch is a no-op and the panel
  // falls through to the empty state. State commits only happen inside the
  // async callbacks after the awaited fetch — never synchronously in the
  // effect body.
  const [full, setFull] = useState<ProjectVersionFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState("/");
  const prevFocusRef = useRef<HTMLElement | null>(null);

  // Fetch the snapshot lazily — only when previewing (once per open/mount).
  useEffect(() => {
    if (!workspaceId) return;
    const provider = getWorkspaceProvider();
    if (!provider) return;
    let cancelled = false;
    const service = new WorkspaceService(provider);
    void service
      .fetchProjectVersion(workspaceId, version.projectId, version.id)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setFull(result.value);
          setRoute("/");
        } else {
          setError(result.error.message);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError("This version couldn't be loaded.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, version]);

  // Escape + focus management (only while mounted = only while open).
  useEffect(() => {
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setPreviewVersion(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      prevFocusRef.current?.focus();
      prevFocusRef.current = null;
    };
  }, [setPreviewVersion]);

  const routes = useMemo(
    () => (full ? computePageRoutes(full.project.pages) : []),
    [full],
  );
  const activePage =
    routes.find((r) => r.routeUrl === route)?.page ?? routes[0]?.page ?? null;

  return (
    <div
      className="fixed inset-0 z-[65] flex flex-col bg-secondary"
      role="dialog"
      aria-modal="true"
      aria-label="Version preview"
      data-testid="version-preview"
    >
      {/* Toolbar */}
      <div className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-border bg-base px-3">
        <button
          onClick={() => setPreviewVersion(null)}
          data-testid="version-preview-return"
          className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
          type="button"
        >
          <ArrowLeft className="h-4 w-4" />
          Return to current version
        </button>
        <div className="mx-1 h-4 w-px bg-border" />
        <span
          className="flex items-center gap-1.5 rounded-md bg-yellow-500/10 px-2.5 py-1 text-[11px] font-medium text-yellow-600 dark:text-yellow-400"
          data-testid="version-preview-banner"
        >
          <Eye className="h-3.5 w-3.5" />
          Viewing version from {absoluteTime(version.createdAt)}
        </span>
        {full && (
          <select
            value={route}
            onChange={(e) => setRoute(e.target.value)}
            aria-label="Switch page in this version"
            className="h-8 rounded-lg border border-border bg-base px-2 text-xs text-text-primary focus:border-accent/40 focus:outline-none"
          >
            {routes.map((r) => (
              <option key={r.routeUrl} value={r.routeUrl}>
                {r.page.title}
              </option>
            ))}
          </select>
        )}
        <div className="flex-1" />
        <span className="text-[11px] text-text-dim">Read-only preview</span>
        <button
          onClick={() => setPreviewVersion(null)}
          aria-label="Close version preview"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary"
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Preview frame */}
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto p-4 sm:p-6">
        {loading ? (
          <div className="flex items-center gap-2 py-16 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading this version…
          </div>
        ) : error ? (
          <div className="flex max-w-md items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        ) : full && activePage ? (
          <div className="min-h-full w-full max-w-4xl overflow-hidden rounded-xl border border-border/60 bg-white shadow-card">
            <div className="min-h-full overflow-y-auto" style={{ maxHeight: "calc(100vh - 6.5rem)" }}>
              <VisitorPageView project={full.project} page={activePage} />
            </div>
          </div>
        ) : (
          <div className="py-16 text-sm text-text-muted">This version has no pages to preview.</div>
        )}
      </div>
    </div>
  );
}
