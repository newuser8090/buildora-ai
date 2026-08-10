"use client";

// ---------------------------------------------------------------------------
// Phase P15 — VersionHistoryDialog
//
// Editor "History" surface for workspace projects. Metadata-only version list
// (snapshots are never fetched for the list), grouped Today/Yesterday/Earlier,
// with per-role actions (Preview for everyone; Copy for owner/editor; Restore
// for owner only) and a manual "Save version" checkpoint (editors/owner with
// an active edit lease). A second tab shows project activity from the same
// underlying service — one history model, two views.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { History, Save, X, Clock, Eye, Copy, RotateCcw, Loader2, ShieldAlert } from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useWorkspaceAccessStore } from "../store/workspace-access-store";
import { useWorkspaceHistoryUiStore } from "../store/workspace-history-ui-store";
import { useProjectVersionHistory } from "../hooks/useProjectVersionHistory";
import type { ProjectVersionMeta } from "../types";
import { absoluteTime, relativeTime, timeBucket } from "../utils/time";
import { WorkspaceActivityPanel } from "./WorkspaceActivityPanel";
import { reasonLabel } from "./version-labels";

const BUCKET_LABELS: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  earlier: "Earlier",
};

export function VersionHistoryDialog() {
  const {
    dialogOpen,
    activeTab,
    setActiveTab,
    closeDialog,
    setPreviewVersion,
    setRestoreVersion,
    setCopyVersion,
  } = useWorkspaceHistoryUiStore();

  const workspaceId = useWorkspaceAccessStore((s) => s.workspaceId);
  const role = useWorkspaceAccessStore((s) => s.role);
  const accessMode = useWorkspaceAccessStore((s) => s.access.mode);
  const projectId = useEditorStore((s) => s.activeProjectId);
  const projectName = useEditorStore((s) => s.project.name);
  const isDirty = useEditorStore((s) => s.isDirty);

  const {
    versions,
    loading,
    error,
    createCheckpoint,
  } = useProjectVersionHistory(workspaceId, projectId, { active: dialogOpen });

  const [checkpointLabel, setCheckpointLabel] = useState("");
  const [checkpointBusy, setCheckpointBusy] = useState(false);
  const [checkpointError, setCheckpointError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  const canCopy = role === "owner" || role === "editor";
  const canRestore = role === "owner";
  const canCheckpoint = canCopy && accessMode === "editable";

  // Escape closes; focus the dialog on mount and restore on unmount.
  useEffect(() => {
    if (!dialogOpen) return;
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeDialog();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      prevFocusRef.current?.focus();
      prevFocusRef.current = null;
    };
  }, [dialogOpen, closeDialog]);

  const handleCheckpoint = useCallback(async () => {
    if (!canCheckpoint || checkpointBusy || isDirty) return;
    setCheckpointBusy(true);
    setCheckpointError(null);
    const result = await createCheckpoint(checkpointLabel.trim() || undefined);
    setCheckpointBusy(false);
    if (!result.ok) {
      setCheckpointError(result.error ?? "Couldn't save the version.");
    } else {
      setCheckpointLabel("");
    }
  }, [canCheckpoint, checkpointBusy, isDirty, checkpointLabel, createCheckpoint]);

  if (!dialogOpen || !workspaceId || !projectId) return null;

  const buckets: Array<{ key: string; label: string; items: ProjectVersionMeta[] }> = [
    { key: "today", label: BUCKET_LABELS.today, items: [] },
    { key: "yesterday", label: BUCKET_LABELS.yesterday, items: [] },
    { key: "earlier", label: BUCKET_LABELS.earlier, items: [] },
  ];
  for (const version of versions) {
    const bucket = timeBucket(version.createdAt);
    buckets.find((b) => b.key === bucket)?.items.push(version);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Version history for ${projectName}`}
      onClick={closeDialog}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        data-testid="version-history-dialog"
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-elevated outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <History className="h-4 w-4 text-accent" />
          <h2 className="flex-1 text-sm font-semibold text-text-primary">
            History
            <span className="ml-2 font-normal text-text-dim">— {projectName}</span>
          </h2>
          <button
            onClick={closeDialog}
            aria-label="Close history"
            data-testid="version-history-close"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-border px-4 pt-2">
          {(
            [
              { id: "versions", label: "Versions" },
              { id: "activity", label: "Activity" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              aria-pressed={activeTab === tab.id}
              data-testid={`history-tab-${tab.id}`}
              className={`rounded-t-lg border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-accent text-accent"
                  : "border-transparent text-text-muted hover:text-text-primary"
              }`}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {activeTab === "activity" ? (
            <WorkspaceActivityPanel
              workspaceId={workspaceId}
              projectId={projectId}
              projectNames={{ [projectId]: projectName }}
              compact
            />
          ) : (
            <>
              {/* Manual checkpoint */}
              <div className="mb-4 flex items-center gap-2">
                <input
                  value={checkpointLabel}
                  onChange={(e) => setCheckpointLabel(e.target.value.slice(0, 80))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleCheckpoint();
                  }}
                  placeholder="Label (optional) — e.g. Before homepage redesign"
                  disabled={!canCheckpoint || isDirty}
                  data-testid="version-checkpoint-input"
                  aria-label="Version label"
                  className="h-9 flex-1 rounded-lg border border-border bg-base px-3 text-sm text-text-primary placeholder:text-text-dim/50 focus:border-accent/40 focus:outline-none disabled:opacity-50"
                />
                <button
                  onClick={() => void handleCheckpoint()}
                  disabled={!canCheckpoint || isDirty || checkpointBusy}
                  data-testid="version-checkpoint-button"
                  title={
                    !canCheckpoint
                      ? "Only editors can save versions"
                      : isDirty
                        ? "Save your changes first"
                        : "Save the current state as a version"
                  }
                  className="flex h-9 items-center gap-2 rounded-lg bg-accent px-3 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                  type="button"
                >
                  {checkpointBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save version
                </button>
              </div>
              {checkpointError && (
                <p className="mb-3 text-xs text-red-400">{checkpointError}</p>
              )}
              {isDirty && canCheckpoint && (
                <p className="mb-3 text-[11px] text-text-dim">
                  Tip: versions capture the saved state — save your changes first.
                </p>
              )}

              {/* List */}
              {loading && versions.length === 0 ? (
                <div className="flex items-center gap-2 py-10 text-sm text-text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading versions…
                </div>
              ) : error && versions.length === 0 ? (
                <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-3 text-sm text-red-300">
                  <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  {error}
                </div>
              ) : versions.length === 0 ? (
                <div className="py-10 text-center">
                  <Clock className="mx-auto h-6 w-6 text-text-dim" />
                  <p className="mt-2 text-sm text-text-muted">
                    No versions yet. Versions are saved when changes are saved or
                    published.
                  </p>
                </div>
              ) : (
                buckets
                  .filter((b) => b.items.length > 0)
                  .map((bucket) => (
                    <section key={bucket.key} className="mb-5 last:mb-0">
                      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-dim">
                        {bucket.label}
                      </h3>
                      <ul className="flex flex-col" data-testid="version-list">
                        {bucket.items.map((version) => (
                          <li
                            key={version.id}
                            data-testid="version-entry"
                            className="flex items-center gap-3 border-b border-border/60 py-2.5 last:border-b-0"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm text-text-primary">
                                {reasonLabel(version)}
                              </p>
                              <p
                                className="mt-0.5 text-[11px] text-text-dim"
                                title={absoluteTime(version.createdAt)}
                              >
                                {version.createdByName ?? "A teammate"} · {relativeTime(version.createdAt)} · v{version.revision}
                              </p>
                            </div>
                            <div className="flex flex-shrink-0 items-center gap-1">
                              <button
                                onClick={() => setPreviewVersion(version)}
                                data-testid={`version-preview-${version.id}`}
                                title="Preview this version"
                                aria-label={`Preview version ${version.revision}`}
                                className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
                                type="button"
                              >
                                <Eye className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Preview</span>
                              </button>
                              {canCopy && (
                                <button
                                  onClick={() => setCopyVersion(version)}
                                  data-testid={`version-copy-${version.id}`}
                                  title="Create a copy from this version"
                                  className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
                                  type="button"
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                  <span className="hidden sm:inline">Copy</span>
                                </button>
                              )}
                              {canRestore && (
                                <button
                                  onClick={() => setRestoreVersion(version)}
                                  data-testid={`version-restore-${version.id}`}
                                  title="Restore this version"
                                  className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
                                  type="button"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                  <span className="hidden sm:inline">Restore</span>
                                </button>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
