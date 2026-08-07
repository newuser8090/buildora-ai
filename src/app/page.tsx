// ---------------------------------------------------------------------------
// Dashboard — Project Dashboard page
// ---------------------------------------------------------------------------

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Sparkles,
  Plus,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  AlertCircle,
  RefreshCw,
  Download,
} from "lucide-react";
import { useProjectsDashboard } from "@/features/projects/hooks/useProjectsDashboard";
import { ProjectCard } from "@/features/projects/components/ProjectCard";
import { ImportProjectDialog } from "@/features/projects/components/ImportProjectDialog";
import { NewProjectDialog } from "@/features/templates/components/NewProjectDialog";
import { useProjectController } from "@/features/persistence/hooks/useProjectController";
import { downloadProjectFile } from "@/features/projects/utils/download-project-file";
import { ConfirmDialog } from "@/features/projects/components/ConfirmDialog";
import { RenameDialog } from "@/features/projects/components/RenameDialog";
import type { ProjectSortMode, DashboardProject } from "@/features/projects/types";
import { cn } from "@/utils/cn";
import { useGuidedBuilderStore } from "@/features/guided-builder/store/guided-builder-store";
import { useGuidedBuilderInit } from "@/features/guided-builder/hooks/useGuidedBuilderInit";
import { OnboardingDialog } from "@/features/guided-builder/components/OnboardingDialog";
import { CloudSyncStatusControl } from "@/features/cloud-sync/components/CloudSyncStatusControl";
import { AccountMenu } from "@/features/auth/components/AccountMenu";
import type {
  OnboardingProjectCategory,
  OnboardingSelections,
} from "@/features/guided-builder/types";
import { useDashboardPublishStatuses } from "@/features/publishing/hooks/useDashboardPublishStatuses";

// Default project name for the onboarding category.
const ONBOARDING_DEFAULT_NAMES: Record<OnboardingProjectCategory, string> = {
  business: "My Business",
  portfolio: "My Portfolio",
  store: "My Store",
  restaurant: "My Restaurant",
  personal: "My Personal Page",
  event: "My Event",
  other: "My Project",
};

// ---------------------------------------------------------------------------
// Sort options
// ---------------------------------------------------------------------------

const SORT_OPTIONS: { value: ProjectSortMode; label: string }[] = [
  { value: "last-edited", label: "Last edited" },
  { value: "recently-created", label: "Recently created" },
  { value: "name-asc", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
];

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const {
    projects,
    isLoading,
    isRefreshing,
    operation,
    searchQuery,
    sortMode,
    error,
    activeProjectId,
    loadProjects,
    createProjectFromTemplate,
    openProject,
    discardAndOpenProject,
    renameProject,
    duplicateProject,
    deleteProject,
    togglePin,
    setSearchQuery,
    setSortMode,
    clearError,
    parseImport,
    commitImport,
    exportProjectById,
    regenerateThumbnail,
    regeneratingId,
  } = useProjectsDashboard();

  // ---- Dialog state ----
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DashboardProject | null>(null);
  const [renameTarget, setRenameTarget] = useState<DashboardProject | null>(null);
  const [exportingProjectId, setExportingProjectId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // StrictMode-safe: re-set to true on every effect setup so a dev-mode
  // simulated unmount/remount never permanently flips the guard to false
  // (which would suppress post-async feedback like export/regenerate errors).
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  // Phase N: first-run guided onboarding (new users / empty dashboard).
  useGuidedBuilderInit();
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const setOnboardingOpenStore = useGuidedBuilderStore((s) => s.setOnboardingOpen);

  const handleStartGuidedSetup = useCallback(() => {
    setOnboardingOpenStore(true);
    setOnboardingOpen(true);
  }, [setOnboardingOpenStore]);

  const handleOnboardingClose = useCallback(() => {
    useGuidedBuilderStore.getState().markOnboardingSkipped();
    setOnboardingOpen(false);
  }, []);

  /** Create the project through the existing template/controller flow and
   *  record the experience-mode preference from the comfort choice. The
   *  onboarding-complete flag is only set AFTER a successful create — a failed
   *  creation keeps the dialog open with its error message visible. */
  const handleOnboardingComplete = useCallback(
    async (selections: OnboardingSelections): Promise<{ ok: boolean; error?: string }> => {
      const templateId = "template-blank";
      const name = ONBOARDING_DEFAULT_NAMES[selections.category];
      const result = await createProjectFromTemplate(templateId, name);
      if (!result.ok) return { ok: false, error: result.error };
      // Success: record the preference and close the dialog.
      useGuidedBuilderStore.getState().setOnboardingCompleted(selections);
      setOnboardingOpen(false);
      return { ok: true };
    },
    [createProjectFromTemplate],
  );

  const handleOnboardingStartFromTemplate = useCallback(
    (selections: OnboardingSelections) => {
      // Record the mode preference, then hand off to the template gallery.
      useGuidedBuilderStore.getState().setOnboardingCompleted(selections);
      setOnboardingOpen(false);
      setNewProjectOpen(true);
    },
    [],
  );
  const [showDiscardDialog, setShowDiscardDialog] = useState<{ projectId: string; projectName: string } | null>(null);
  const [operationLoading, setOperationLoading] = useState(false);
  const [thumbnailError, setThumbnailError] = useState<string | null>(null);

  // Initialize the persistence controller on the dashboard route (the editor
  // initializes it via EditorProvider; the dashboard needs it for the
  // template-creation flow and first-run empty state).
  useProjectController();

  // Phase P7: derived publish status per project card.
  const publishStatuses = useDashboardPublishStatuses(
    projects.map((p) => ({ id: p.id, revision: p.revision })),
  );

  // ---- Open project with failed-flush handling ----
  const handleOpen = useCallback(
    async (projectId: string) => {
      clearError();
      await openProject(projectId);
      // If there's a save-before-transition error, show discard dialog
      // The hook sets error which we can detect
    },
    [openProject, clearError],
  );

  // ---- Discard and open ----
  const handleDiscardAndOpen = useCallback(async () => {
    if (!showDiscardDialog) return;
    setOperationLoading(true);
    await discardAndOpenProject(showDiscardDialog.projectId);
    setShowDiscardDialog(null);
    setOperationLoading(false);
  }, [showDiscardDialog, discardAndOpenProject]);

  // ---- Delete ----
  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setOperationLoading(true);
    await deleteProject(deleteTarget.id);
    setDeleteTarget(null);
    setOperationLoading(false);
  }, [deleteTarget, deleteProject]);

  // ---- Duplicate ----
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  // ---- Export project ----
  const handleExport = useCallback(
    async (projectId: string) => {
      if (exportingProjectId) return;
      setExportingProjectId(projectId);
      setExportError(null);

      const result = await exportProjectById(projectId);
      // Stale export result after unmount produces no feedback.
      if (!mountedRef.current) return;
      setExportingProjectId(null);

      if (!result.ok) {
        // Serialization / load failures map to a UI error.
        setExportError(result.error.message);
        return;
      }

      // Trigger download
      const dlResult = downloadProjectFile(result.filename, result.content);
      if (!mountedRef.current) return;
      if (!dlResult.ok) {
        // Download failure maps to a UI error.
        setExportError(dlResult.error.message);
      }
    },
    [exportProjectById, exportingProjectId],
  );

  // ---- Regenerate preview ----
  // Surface a non-blocking error when manual regeneration fails. The card
  // itself shows the busy badge while regeneration runs; on failure we keep
  // the existing thumbnail/placeholder and show a dismissible message.
  const handleRegeneratePreview = useCallback(
    async (projectId: string) => {
      // Clear prior feedback so a fresh attempt starts clean.
      setThumbnailError(null);
      const result = await regenerateThumbnail(projectId);
      if (!mountedRef.current) return;
      if (!result.ok) {
        setThumbnailError(
          result.error.message ?? "Failed to regenerate the preview. Please try again.",
        );
      }
    },
    [regenerateThumbnail],
  );

  const handleDuplicate = useCallback(
    async (projectId: string) => {
      if (duplicateLoading || operation?.type === "duplicating") return;
      setDuplicateLoading(true);
      await duplicateProject(projectId);
      setDuplicateLoading(false);
    },
    [duplicateProject, duplicateLoading, operation],
  );

  // ---- Rename ----
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const handleRenameConfirm = useCallback(
    async (newName: string) => {
      if (!renameTarget || renameLoading) return;
      setRenameLoading(true);
      setRenameError(null);
      const result = await renameProject(renameTarget.id, newName);
      setRenameLoading(false);
      if (result.success) {
        setRenameTarget(null);
      } else {
        setRenameError(result.error ?? "Rename failed");
      }
    },
    [renameTarget, renameLoading, renameProject],
  );

  // Note: save-before-transition error is handled by the error banner below,
  // which shows "Discard unsaved changes and continue" and "Retry" buttons.

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-base">
      {/* ---- Header ---- */}
      <header className="flex items-center justify-between border-b border-border bg-secondary px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-text-primary">
              Buildora
            </h1>
            <p className="text-xs text-text-dim">AI Website Builder</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setImportDialogOpen(true)}
            className="flex h-9 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95"
            type="button"
          >
            <Download className="h-4 w-4" />
            Import Project
          </button>
          <button
            onClick={() => setNewProjectOpen(true)}
            className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95"
            type="button"
          >
            <Plus className="h-4 w-4" />
            New Project
          </button>

          <div className="mx-1 h-4 w-px bg-border" />

          {/* Phase P6: cloud sync status + account menu */}
          <CloudSyncStatusControl />
          <AccountMenu />
        </div>
      </header>

      {/* ---- Main content ---- */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* ---- Toolbar ---- */}
        <div className="flex flex-col gap-3 border-b border-border bg-secondary px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-dim" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search projects..."
              className="h-9 w-full rounded-lg border border-border bg-base pl-9 pr-3 text-sm text-text-primary placeholder:text-text-dim/50 transition-all duration-200 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20"
              aria-label="Search projects"
            />
          </div>

          <div className="flex items-center gap-3">
            {/* Project count */}
            <span className="text-xs text-text-dim">
              {projects.length} project{projects.length !== 1 ? "s" : ""}
            </span>

            {/* Refresh */}
            <button
              onClick={() => loadProjects(true)}
              disabled={isRefreshing}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Refresh project list"
              type="button"
            >
              <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
            </button>

            {/* Sort */}
            <div className="relative">
              <button
                onClick={() => setShowSortMenu(!showSortMenu)}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-text-dim transition-all duration-200 hover:bg-card hover:text-text-primary"
                aria-label={`Sort by ${SORT_OPTIONS.find((o) => o.value === sortMode)?.label ?? "Last edited"}`}
                type="button"
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
                {SORT_OPTIONS.find((o) => o.value === sortMode)?.label}
              </button>

              {showSortMenu && (
                <div
                  className="absolute right-0 top-10 z-40 w-44 rounded-lg border border-border bg-card py-1 shadow-elevated"
                  role="menu"
                  onMouseLeave={() => setShowSortMenu(false)}
                >
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => { setSortMode(opt.value); setShowSortMenu(false); }}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-base",
                        sortMode === opt.value
                          ? "text-accent"
                          : "text-text-primary",
                      )}
                      role="menuitem"
                      type="button"
                    >
                      {sortMode === opt.value && (
                        opt.value === "name-asc" || opt.value === "name-desc"
                          ? <ArrowUp className="h-3 w-3" />
                          : <ArrowDown className="h-3 w-3" />
                      )}
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ---- Thumbnail error toast ---- */}
        {thumbnailError && (
          <div className="mx-6 mt-3 flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3" role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />
            <div className="flex-1">
              <p className="text-sm text-red-300">{thumbnailError}</p>
            </div>
            <button
              onClick={() => setThumbnailError(null)}
              className="text-xs text-text-dim underline hover:no-underline"
              type="button"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* ---- Export error toast ---- */}
        {exportError && (
          <div className="mx-6 mt-3 flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-400" />
            <div className="flex-1">
              <p className="text-sm text-yellow-300">{exportError}</p>
            </div>
            <button
              onClick={() => setExportError(null)}
              className="text-xs text-text-dim underline hover:no-underline"
              type="button"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* ---- Error banner ---- */}
        {error && (
          <div className="mx-6 mt-3 flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />
            <div className="flex-1">
              <p className="text-sm text-red-300">{error.message}</p>
              <div className="mt-2 flex items-center gap-3">
                {error.retryable && (
                  <button
                    onClick={() => { clearError(); loadProjects(true); }}
                    className="text-xs font-medium text-red-400 underline hover:no-underline"
                    type="button"
                  >
                    Retry
                  </button>
                )}
                {error.code === "SAVE_BEFORE_TRANSITION_FAILED" && projects.length > 0 && (
                  <button
                    onClick={() => {
                      const target = projects.find(p => p.id !== activeProjectId);
                      if (target) {
                        setShowDiscardDialog({ projectId: target.id, projectName: target.name });
                        clearError();
                      }
                    }}
                    className="text-xs font-medium text-yellow-400 underline hover:no-underline"
                    type="button"
                  >
                    Discard unsaved changes and continue
                  </button>
                )}
                <button
                  onClick={clearError}
                  className="text-xs text-text-dim underline hover:no-underline"
                  type="button"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ---- Project grid ---- */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {/* Loading state */}
          {isLoading && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-xl border border-border/60 bg-card"
                >
                  <div className="h-28 rounded-t-xl bg-base" />
                  <div className="p-3">
                    <div className="h-4 w-3/4 rounded bg-base" />
                    <div className="mt-2 h-3 w-1/2 rounded bg-base" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && projects.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              {searchQuery.trim() ? (
                <>
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-card">
                    <Search className="h-7 w-7 text-text-dim" />
                  </div>
                  <h2 className="mt-4 text-lg font-semibold text-text-primary">
                    No projects found
                  </h2>
                  <p className="mt-1 text-sm text-text-muted">
                    No projects match &quot;{searchQuery.trim()}&quot;
                  </p>
                  <button
                    onClick={() => setSearchQuery("")}
                    className="mt-4 text-sm font-medium text-accent hover:text-accent-hover"
                    type="button"
                  >
                    Clear search
                  </button>
                </>
              ) : (
                <>
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-card">
                    <Sparkles className="h-7 w-7 text-text-dim" />
                  </div>
                  <h2 className="mt-4 text-lg font-semibold text-text-primary">
                    Welcome to Buildora
                  </h2>
                  <p className="mt-1 text-sm text-text-muted">
                    Create a new project or import an existing one to get started.
                  </p>
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    <button
                      onClick={handleStartGuidedSetup}
                      data-testid="start-guided-setup"
                      className="flex h-10 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95"
                      type="button"
                    >
                      <Sparkles className="h-4 w-4" />
                      Start guided setup
                    </button>
                    <button
                      onClick={() => setNewProjectOpen(true)}
                      className="flex h-10 items-center gap-2 rounded-xl border border-border px-5 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95"
                      type="button"
                    >
                      <Plus className="h-4 w-4" />
                      New Project
                    </button>
                    <button
                      onClick={() => setImportDialogOpen(true)}
                      className="flex h-10 items-center gap-2 rounded-xl border border-border px-5 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95"
                      type="button"
                    >
                      <Download className="h-4 w-4" />
                      Import Project
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Project grid */}
          {!isLoading && projects.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  activeProjectId={activeProjectId}
                  operation={operation}
                  onOpen={handleOpen}
                  onRename={(pid) => {
                    const p = projects.find((pj) => pj.id === pid);
                    if (p) { setRenameTarget(p); setRenameError(null); }
                  }}
                  onDuplicate={(pid) => handleDuplicate(pid)}
                  onDelete={(id) => {
                    const p = projects.find((pj) => pj.id === id);
                    if (p) setDeleteTarget(p);
                  }}
                  onTogglePin={togglePin}
                  onExport={handleExport}
                  onRegeneratePreview={handleRegeneratePreview}
                  isRegeneratingPreview={regeneratingId === project.id}
                  publishStatus={publishStatuses[project.id]}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* ---- Delete confirmation dialog ---- */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Project"
        message={
          deleteTarget
            ? `Are you sure you want to delete "${deleteTarget.name}"? This action cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
        isLoading={operationLoading}
      />

      {/* ---- Rename dialog ---- */}
      <RenameDialog
        open={renameTarget !== null}
        currentName={renameTarget?.name ?? ""}
        onConfirm={handleRenameConfirm}
        onCancel={() => { setRenameTarget(null); setRenameError(null); }}
        isLoading={renameLoading}
        error={renameError}
      />

      {/* ---- Discard and continue dialog ---- */}
      <ConfirmDialog
        open={showDiscardDialog !== null}
        title="Discard Unsaved Changes?"
        message={
          showDiscardDialog
            ? `You have unsaved changes in your current project. Opening "${showDiscardDialog.projectName}" will discard those unsaved changes. This action cannot be undone.`
            : ""
        }
        confirmLabel="Discard Changes"
        destructive
        onConfirm={handleDiscardAndOpen}
        onCancel={() => setShowDiscardDialog(null)}
        isLoading={operationLoading}
      />

      {/* ---- Import Project Dialog ---- */}
      <ImportProjectDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        onParse={parseImport}
        onCommit={commitImport}
        existingNames={projects.map((p) => p.name)}
      />

      {/* ---- New Project Dialog ---- */}
      <NewProjectDialog
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreate={createProjectFromTemplate}
      />

      {/* ---- First-run onboarding (Phase N) ---- */}
      <OnboardingDialog
        open={onboardingOpen}
        onClose={handleOnboardingClose}
        onComplete={handleOnboardingComplete}
        onStartFromTemplate={handleOnboardingStartFromTemplate}
      />
    </div>
  );
}
