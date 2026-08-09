"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Undo2,
  Redo2,
  Save,
  Download,
  Package,
  BookMarked,
  Loader2,
  ImageIcon,
  ArrowLeft,
  Eye,
  Rocket,
  Settings2,
  LayoutTemplate,
  Keyboard,
  History,
  Bot,
  Share2,
} from "lucide-react";
import { openCopilotPanel } from "@/features/ai-copilot/store/copilot-store";
import { openShareDialog } from "@/features/sharing/store/share-ui-store";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useMyBlocksUiStore } from "@/features/my-blocks/store/my-blocks-ui-store";
import { AssetManager } from "@/features/assets/components/AssetManager";
import { saveNowViaController } from "@/features/persistence/services/project-controller";
import { ProjectExportService } from "@/features/projects/services/project-export-service";
import { downloadProjectFile } from "@/features/projects/utils/download-project-file";
import { exportProject as exportSiteZip } from "@/features/export/pipeline/export-pipeline";
import { mapProjectTransferErrorToMessage } from "@/features/projects/types/project-transfer";
import { cn } from "@/utils/cn";
import { ExperienceModeSwitcher } from "@/features/guided-builder/components/ExperienceModeSwitcher";
import { EXPORT_SITE_EVENT } from "@/features/guided-builder/constants";
import { CloudSyncStatusControl } from "@/features/cloud-sync/components/CloudSyncStatusControl";
import { AccountMenu } from "@/features/auth/components/AccountMenu";
import { usePreviewStore } from "@/features/preview/store/preview-store";
import { useLaunchCenterStore } from "@/features/launch-readiness/store/launch-center-store";
import { useSiteSettingsUiStore } from "@/features/site-settings/store/site-settings-ui-store";
import { usePublishing } from "@/features/publishing/hooks/usePublishing";
import { usePublishingStore } from "@/features/publishing/store/publishing-store";
import { usePersonalTemplatesUiStore } from "@/features/personal-templates/store/personal-templates-ui-store";
import { useHelpUiStore } from "@/features/help/store/help-ui-store";
import { useRecoveryUiStore } from "@/features/recovery/store/recovery-ui-store";
import { notifyActionFeedback } from "@/features/feedback/action-feedback";

const iconButton =
  "flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95";

const iconButtonDisabled =
  "flex h-8 w-8 items-center justify-center rounded-lg text-text-dim/30 cursor-not-allowed";

export function TopNav() {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportingSite, setExportingSite] = useState(false);
  const [exportSiteError, setExportSiteError] = useState<string | null>(null);
  const [assetManagerOpen, setAssetManagerOpen] = useState(false);
  const copyNotice = usePublishingStore((s) => s.copyNotice);

  // Phase P9 — save this project as a personal template (from the editor).
  const openSaveTemplate = () => {
    usePersonalTemplatesUiStore.getState().openSaveDialog(project);
  };
  const openShortcuts = () => useHelpUiStore.getState().openShortcutsDialog();
  const openBackups = () => useRecoveryUiStore.getState().openRecovery(project.id);

  // Guards double exports even before React re-renders the disabled state.
  const exportingRef = useRef(false);
  const exportingSiteRef = useRef(false);

  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.canUndo());
  const canRedo = useEditorStore((s) => s.canRedo());
  const project = useEditorStore((s) => s.project);

  // Phase P8: keep the Publish button honest — "Publish updates" when the
  // project has unpublished changes; it always opens the Launch Center.
  const { publishStatus } = usePublishing();

  const saveStatus = useEditorStore((s) => s.saveStatus);
  const isHydrated = useEditorStore((s) => s.isHydrated);
  const isDirty = useEditorStore((s) => s.isDirty);

  const router = useRouter();

  const handleSave = useCallback(async () => {
    await saveNowViaController();
  }, []);

  // Mount guard for back-navigation. StrictMode-safe: the ref is re-set to
  // true on every effect setup so a dev-mode simulated unmount/remount does
  // not permanently flip it to false (which would block back-navigation).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [backNavBusy, setBackNavBusy] = useState(false);
  const [backNavError, setBackNavError] = useState<string | null>(null);
  const [showDiscardBackNav, setShowDiscardBackNav] = useState(false);

  const handleBackToDashboard = useCallback(async () => {
    if (!mountedRef.current || backNavBusy) return;

    if (isDirty) {
      setBackNavBusy(true);
      setBackNavError(null);
      const result = await saveNowViaController();
      if (!mountedRef.current) return;
      setBackNavBusy(false);

      if (!result.success) {
        // Save failed — block navigation and show options
        setBackNavError("Failed to save. Retry or discard unsaved changes.");
        return;
      }
    }

    if (!mountedRef.current) return;
    router.push("/");
  }, [isDirty, router, backNavBusy]);

  const handleDiscardBackToDashboard = useCallback(() => {
    if (!mountedRef.current) return;
    setShowDiscardBackNav(true);
  }, []);

  const handleConfirmDiscardBackNav = useCallback(async () => {
    if (!mountedRef.current) return;
    setShowDiscardBackNav(false);
    setBackNavError(null);
    router.push("/");
  }, [router]);

  // ---- Export the site as a multi-page ZIP ----
  const handleExportSite = useCallback(async () => {
    // Generates one route file per page (app/<slug>/page.tsx), per-page
    // metadata, cross-page internal links, and downloads the ZIP.
    if (exportingSiteRef.current) return;
    exportingSiteRef.current = true;

    if (!project || !project.id) {
      exportingSiteRef.current = false;
      setExportSiteError("No active project to export.");
      return;
    }

    setExportSiteError(null);
    setExportingSite(true);

    // Yield so a second synchronous click in the same tick is blocked by the
    // exportingSiteRef guard.
    await Promise.resolve();

    try {
      const result = await exportSiteZip(project);
      if (!mountedRef.current) return;
      if (!result.success) {
        setExportSiteError(result.error ?? "Site export failed");
      }
    } catch (err) {
      if (mountedRef.current) {
        setExportSiteError(err instanceof Error ? err.message : "Site export failed");
      }
    } finally {
      exportingSiteRef.current = false;
      if (mountedRef.current) {
        setExportingSite(false);
      }
    }
  }, [project]);

  // Phase N: the command palette / guided coach can request a site export.
  useEffect(() => {
    const onExportRequested = () => {
      void handleExportSite();
    };
    window.addEventListener(EXPORT_SITE_EVENT, onExportRequested);
    return () => window.removeEventListener(EXPORT_SITE_EVENT, onExportRequested);
  }, [handleExportSite]);

  // ---- Export current project as .buildora.json ----
  const handleExport = useCallback(async () => {
    // Export the current in-memory state (even if dirty).
    // Does not force persistence first.
    // Does not mark the project saved.
    // Does not change revision or dirty state.
    if (exportingRef.current) return;
    exportingRef.current = true;

    if (!project || !project.id) {
      exportingRef.current = false;
      // No-project state maps to a structured transfer error.
      setExportError(
        mapProjectTransferErrorToMessage({
          code: "PROJECT_NOT_FOUND",
          message: "No active project to export.",
        }),
      );
      return;
    }

    setExportError(null);
    setExporting(true);

    // Yield so a second synchronous click in the same tick is blocked by the
    // exportingRef guard (and an unmount before completion skips feedback).
    await Promise.resolve();

    try {
      const exportService = new ProjectExportService();
      const result = exportService.exportProject(project);

      if (!mountedRef.current) return;

      if (!result.ok) {
        setExportError(result.error.message);
        return;
      }

      const downloadResult = downloadProjectFile(result.filename, result.content);
      if (!mountedRef.current) return;
      if (!downloadResult.ok) {
        setExportError(downloadResult.error.message);
      }
    } catch (err) {
      if (mountedRef.current) {
        setExportError(err instanceof Error ? err.message : "Export failed");
      }
    } finally {
      exportingRef.current = false;
      if (mountedRef.current) {
        setExporting(false);
      }
    }
  }, [project]);

  return (
    <header className="flex h-12 items-center gap-3 border-b border-border bg-secondary px-4">
      {/* ---- Left: Brand + Project ---- */}
      <div className="flex items-center gap-3">
        {/* Back to dashboard */}
        <button
          onClick={handleBackToDashboard}
          disabled={backNavBusy}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          title="Back to Dashboard"
          aria-label="Back to Dashboard"
          type="button"
        >
          {backNavBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowLeft className="h-4 w-4" />
          )}
        </button>

        <div className="h-4 w-px bg-border" />

        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent">
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-text-primary">
            Buildora
          </span>
        </div>

        <div className="h-4 w-px bg-border" />

        <div className="flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors duration-200 hover:bg-card">
          <span className="text-sm text-text-muted transition-colors duration-200">
            {project.name || "Untitled Project"}
          </span>
        </div>
      </div>

      {/* ---- Spacer ---- */}
      <div className="flex-1" />

      {/* ---- Actions ---- */}
      <div className="flex items-center gap-1">
        <div className="mr-1.5">
          <ExperienceModeSwitcher />
        </div>
        <button
          data-testid="undo-button"
          className={cn(canUndo ? iconButton : iconButtonDisabled)}
          onClick={() => {
            undo();
            notifyActionFeedback("Change undone", {
              actionLabel: "Redo",
              onAction: () => useEditorStore.getState().redo(),
            });
          }}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          type="button"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          data-testid="redo-button"
          className={cn(canRedo ? iconButton : iconButtonDisabled)}
          onClick={() => {
            redo();
            notifyActionFeedback("Change restored", {
              actionLabel: "Undo",
              onAction: () => useEditorStore.getState().undo(),
            });
          }}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
          type="button"
        >
          <Redo2 className="h-4 w-4" />
        </button>

        <div className="mx-1.5 h-4 w-px bg-border" />

        <button
          onClick={() => setAssetManagerOpen(true)}
          className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm text-text-dim transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95"
          title="Manage assets"
          type="button"
        >
          <ImageIcon className="h-4 w-4" />
          <span className="hidden sm:inline text-xs">Assets</span>
        </button>

        <button
          data-testid="topnav-my-blocks-button"
          onClick={() => useMyBlocksUiStore.getState().openLibrary()}
          className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm text-text-dim transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95"
          title="My saved blocks"
          type="button"
        >
          <BookMarked className="h-4 w-4" />
          <span className="hidden sm:inline text-xs">My Blocks</span>
        </button>

        <button
          data-testid="topnav-save-button"
          onClick={handleSave}
          disabled={saveStatus === "saving" || saveStatus === "hydrating" || !isHydrated}
          className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm text-text-dim transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          title={saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Save (Ctrl+S)"}
          type="button"
        >
          {saveStatus === "saving" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          <span className="hidden sm:inline text-xs">
            {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Save"}
          </span>
        </button>

        <button
          data-testid="export-site-button"
          onClick={handleExportSite}
          disabled={exportingSite}
          className="flex h-8 items-center gap-2 rounded-lg bg-primary/10 px-2.5 text-sm text-primary transition-all duration-200 hover:bg-primary/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          title={exportingSite ? "Exporting site..." : "Export website as ZIP"}
          type="button"
        >
          {exportingSite ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Package className="h-4 w-4" />
          )}
          <span className="hidden sm:inline text-xs">
            {exportingSite ? "Exporting..." : "Export Site"}
          </span>
        </button>

        <button
          data-testid="export-button"
          onClick={handleExport}
          disabled={exporting}
          className="flex h-8 items-center gap-2 rounded-lg bg-primary/10 px-2.5 text-sm text-primary transition-all duration-200 hover:bg-primary/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          title={exporting ? "Exporting..." : "Export project as .buildora.json"}
          type="button"
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          <span className="hidden sm:inline text-xs">
            {exporting ? "Exporting..." : "Export"}
          </span>
        </button>

        {/* Phase P7: Preview + Publish — the primary finishing actions */}
        <button
          data-testid="topnav-preview-button"
          onClick={() => usePreviewStore.getState().openPreview("/")}
          className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm text-text-dim transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95"
          title="Preview your website"
          type="button"
        >
          <Eye className="h-4 w-4" />
          <span className="hidden sm:inline text-xs">Preview</span>
        </button>

        <button
          data-testid="topnav-publish-button"
          onClick={() => useLaunchCenterStore.getState().openLaunchCenter()}
          className="flex h-8 items-center gap-2 rounded-lg bg-accent px-3 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95"
          title="Check and publish your website"
          type="button"
        >
          <Rocket className="h-4 w-4" />
          <span className="hidden sm:inline text-xs">
            {publishStatus === "changes-unpublished" ? "Publish updates" : "Publish"}
          </span>
        </button>

        {/* Phase P12: Share — opens the canonical share surface */}
        <button
          data-testid="topnav-share-button"
          onClick={() => openShareDialog("create")}
          className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm text-text-dim transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95"
          title="Share a read-only review link"
          type="button"
        >
          <Share2 className="h-4 w-4" />
          <span className="hidden sm:inline text-xs">Share</span>
        </button>

        {/* Phase P10: AI Copilot — opens the canonical Copilot panel */}
        <button
          data-testid="topnav-copilot-button"
          onClick={openCopilotPanel}
          className="flex h-8 items-center gap-2 rounded-lg bg-accent/10 px-2.5 text-sm text-accent transition-all duration-200 hover:bg-accent/20 active:scale-95"
          title="Open the AI Copilot (Ctrl/⌘+Shift+A)"
          type="button"
        >
          <Bot className="h-4 w-4" />
          <span className="hidden sm:inline text-xs">Copilot</span>
        </button>

        {/* Phase P9: save-as-template + help + backups */}
        <button
          data-testid="topnav-save-template-button"
          onClick={openSaveTemplate}
          className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm text-text-dim transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95"
          title="Save this project as a template"
          type="button"
        >
          <LayoutTemplate className="h-4 w-4" />
          <span className="hidden sm:inline text-xs">Template</span>
        </button>
        <button
          data-testid="topnav-help-button"
          onClick={openShortcuts}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95"
          title="Keyboard shortcuts and help (Ctrl/⌘+K for commands)"
          aria-label="Keyboard shortcuts and help"
          type="button"
        >
          <Keyboard className="h-4 w-4" />
        </button>
        <button
          data-testid="topnav-recovery-button"
          onClick={openBackups}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95"
          title="Backups and recovery"
          aria-label="Backups and recovery"
          type="button"
        >
          <History className="h-4 w-4" />
        </button>

        <button
          data-testid="topnav-site-settings-button"
          onClick={() => useSiteSettingsUiStore.getState().openDialog("basics")}
          className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm text-text-dim transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95"
          title="Site settings"
          type="button"
        >
          <Settings2 className="h-4 w-4" />
          <span className="hidden xl:inline text-xs">Settings</span>
        </button>

        <div className="mx-1.5 h-4 w-px bg-border" />

        {/* Phase P6: cloud sync status + account menu */}
        <CloudSyncStatusControl />
        <AccountMenu />
      </div>

      {/* ---- Export site error toast ---- */}
      {exportSiteError && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-lg">
          <p className="font-medium">Site export failed</p>
          <p className="mt-1 text-xs text-red-600">{exportSiteError}</p>
          <button
            onClick={() => setExportSiteError(null)}
            className="mt-2 text-xs font-medium text-red-700 underline hover:no-underline"
            type="button"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ---- Export error toast ---- */}
      {exportError && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-lg">
          <p className="font-medium">Export failed</p>
          <p className="mt-1 text-xs text-red-600">{exportError}</p>
          <button
            onClick={() => setExportError(null)}
            className="mt-2 text-xs font-medium text-red-700 underline hover:no-underline"
            type="button"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ---- Asset Manager modal ---- */}
      {assetManagerOpen && (
        <AssetManager onClose={() => setAssetManagerOpen(false)} />
      )}

      {/* ---- Phase P8: transient "Link copied." announcement ---- */}
      {copyNotice && (
        <div
          className="fixed bottom-16 left-1/2 z-[70] -translate-x-1/2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-medium text-emerald-600 dark:text-emerald-400 shadow-elevated"
          role="status"
          data-testid="publish-copy-notice"
        >
          {copyNotice}
        </div>
      )}

      {/* ---- Back-nav error toast ---- */}
      {backNavError && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300 shadow-lg">
          <p>{backNavError}</p>
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={() => { setBackNavError(null); handleBackToDashboard(); }}
              className="text-xs font-medium underline hover:no-underline"
              type="button"
            >
              Retry Save
            </button>
            <button
              onClick={handleDiscardBackToDashboard}
              className="text-xs font-medium text-red-400 underline hover:no-underline"
              type="button"
            >
              Discard Changes
            </button>
            <button
              onClick={() => setBackNavError(null)}
              className="text-xs text-text-dim underline hover:no-underline"
              type="button"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ---- Discard confirmation dialog ---- */}
      {showDiscardBackNav && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="discard-back-title"
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-elevated">
            <h3 id="discard-back-title" className="text-lg font-semibold text-text-primary">
              Discard Unsaved Changes?
            </h3>
            <p className="mt-2 text-sm text-text-muted leading-relaxed">
              You have unsaved changes in the editor. Returning to the dashboard will discard those changes. This action cannot be undone.
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowDiscardBackNav(false)}
                className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-card hover:text-text-primary"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDiscardBackNav}
                className="flex h-9 items-center rounded-lg bg-red-600 px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-red-500"
                type="button"
              >
                Discard Changes
              </button>
            </div>
          </div>
        </div>
      )}

    </header>
  );
}
