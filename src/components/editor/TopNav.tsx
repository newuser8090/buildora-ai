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
  Eye,
  Rocket,
  Settings2,
  LayoutTemplate,
  Keyboard,
  History,
  Clock,
  Share2,
  ChevronDown,
  Monitor,
  Smartphone,
} from "lucide-react";
import { openShareDialog } from "@/features/sharing/store/share-ui-store";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useMyBlocksUiStore } from "@/features/my-blocks/store/my-blocks-ui-store";
import { AssetManager } from "@/features/assets/components/AssetManager";
import { saveNowViaController } from "@/features/persistence/services/project-controller";
import { ProjectExportService } from "@/features/projects/services/project-export-service";
import { downloadProjectFile } from "@/features/projects/utils/download-project-file";
import { exportProject as exportSiteZip } from "@/features/export/pipeline/export-pipeline";
import { useDataIntegrationStore } from "@/features/integrations/store/data-integration-store";
import { mapProjectTransferErrorToMessage } from "@/features/projects/types/project-transfer";
import { cn } from "@/utils/cn";
import { EXPORT_SITE_EVENT } from "@/features/guided-builder/constants";
import { CloudSyncStatusControl } from "@/features/cloud-sync/components/CloudSyncStatusControl";
import { AccountMenu } from "@/features/auth/components/AccountMenu";
import { useWorkspaceAccessStore } from "@/features/workspaces/store/workspace-access-store";
import { useWorkspaceHistoryUiStore } from "@/features/workspaces/store/workspace-history-ui-store";
import { PresenceIndicator } from "@/features/workspaces/components/PresenceIndicator";
import { CollabStatusIndicator } from "@/features/collaboration/components/CollabStatusIndicator";
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

  // Phase P14 — collaboration session state for indicators + button gating.
  const wsAccess = useWorkspaceAccessStore((s) => s.access);
  const wsName = useWorkspaceAccessStore((s) => s.workspaceName);
  const wsLeaseHolder = useWorkspaceAccessStore((s) => s.leaseHolderName);
  const isWsReadOnly = wsAccess.mode === "readonly";

  // Phase P15 — version history entry point (workspace projects only).
  const openVersionHistory = () => useWorkspaceHistoryUiStore.getState().openDialog("versions");

  // Phase P8: keep the Publish button honest — "Publish updates" when the
  // project has unpublished changes; it always opens the Launch Center.
  const { publishStatus } = usePublishing();

  const saveStatus = useEditorStore((s) => s.saveStatus);
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
      // Phase P22-J — static snapshot export: runtime records from the data
      // integration provider are baked into the generated site at export time.
      const records = useDataIntegrationStore.getState().records;
      const result = await exportSiteZip(project, { records });
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
    }
  }, [project]);

  return (
    <header className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-black/5 bg-white px-3">
      {/* ---- Left: Brand, File menu, Undo/Redo ---- */}
      <div className="flex items-center gap-1">
        {/* Brand logo — back to dashboard (preserves the back-nav guard). */}
        <button
          onClick={handleBackToDashboard}
          disabled={backNavBusy}
          className="flex h-8 items-center gap-1.5 rounded-lg px-1.5 transition-all duration-200 hover:bg-[#F2F3F5] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          title="Back to Dashboard"
          aria-label="Back to Dashboard"
          type="button"
        >
          {backNavBusy ? (
            <Loader2 className="h-4 w-4 animate-spin text-[#7D2AE8]" />
          ) : (
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#8B3DFF] to-[#7D2AE8]">
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </span>
          )}
        </button>

        {/* File menu — the project-level surface (save / export / settings). */}
        <FileMenu
          onSave={handleSave}
          onExportProject={handleExport}
          onOpenAssets={() => setAssetManagerOpen(true)}
          onOpenBackups={openBackups}
          onOpenShortcuts={openShortcuts}
          onOpenSaveTemplate={openSaveTemplate}
          onOpenSiteSettings={() => useSiteSettingsUiStore.getState().openDialog("basics")}
          showVersionHistory={!!wsName}
          onOpenVersionHistory={openVersionHistory}
          exporting={exportingSite}
          onExportSite={handleExportSite}
          saveBusy={saveStatus === "saving"}
        />

        <div className="mx-1 h-4 w-px bg-black/10" />

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
      </div>

      {/* ---- Center-Left: Viewport switcher (Canva-style tabs) ---- */}
      <ViewportSwitcher />

      {/* ---- Center: inline-editable document title ---- */}
      <div className="mx-2 flex min-w-0 flex-1 justify-center">
        <DocumentTitle />
      </div>

      {/* ---- Right: Preview / Export ZIP / Publish ---- */}
      <div className="flex items-center gap-1">

        {/* Phase P14 — workspace + editing state indicator */}
        {wsName && (
          <div
            className="flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-text-dim"
            data-testid="workspace-editor-context"
          >
            <span className="text-text-muted">{wsName}</span>
            <span aria-hidden="true" className="text-text-dim/40">·</span>
            {isWsReadOnly ? (
              <span className="text-yellow-600 dark:text-yellow-400" data-testid="workspace-editing-indicator">
                {wsAccess.reason === "being-edited" && wsLeaseHolder
                  ? `Being edited by ${wsLeaseHolder}`
                  : wsAccess.reason === "offline"
                    ? "Offline — read only"
                    : "Read only"}
              </span>
            ) : (
              <span className="text-emerald-600 dark:text-emerald-400" data-testid="workspace-editing-indicator">
                Editing
              </span>
            )}
          </div>
        )}

        {/* Phase P15 — live presence (only while a workspace project is open) */}
        {wsName && <PresenceIndicator />}

        {/* Phase P16 — collaboration sync status + remote-change hint */}
        {wsName && <CollabStatusIndicator />}

        <div className="mx-1 h-4 w-px bg-black/10" />

        <button
          data-testid="topnav-my-blocks-button"
          onClick={() => useMyBlocksUiStore.getState().openLibrary()}
          className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm text-[#5b5e69] transition-all duration-200 hover:bg-[#F2F3F5] hover:text-[#0d0f14] active:scale-95"
          title="My saved blocks"
          type="button"
        >
          <BookMarked className="h-4 w-4" />
          <span className="hidden lg:inline text-xs">My Blocks</span>
        </button>

        <button
          data-testid="topnav-preview-button"
          onClick={() => usePreviewStore.getState().openPreview("/")}
          className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm text-[#5b5e69] transition-all duration-200 hover:bg-[#F2F3F5] hover:text-[#0d0f14] active:scale-95"
          title="Preview your website"
          type="button"
        >
          <Eye className="h-4 w-4" />
          <span className="hidden md:inline text-xs">Preview</span>
        </button>

        <button
          data-testid="export-site-button"
          onClick={handleExportSite}
          disabled={exportingSite}
          className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm text-[#5b5e69] transition-all duration-200 hover:bg-[#F2F3F5] hover:text-[#0d0f14] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          title={exportingSite ? "Exporting site..." : "Export website as ZIP"}
          type="button"
        >
          {exportingSite ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Package className="h-4 w-4" />
          )}
          <span className="hidden md:inline text-xs">
            {exportingSite ? "Exporting..." : "Export ZIP"}
          </span>
        </button>

        {/* Phase P12: Share — opens the canonical share surface */}
        <button
          data-testid="topnav-share-button"
          onClick={() => openShareDialog("create")}
          disabled={isWsReadOnly}
          className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm text-[#5b5e69] transition-all duration-200 hover:bg-[#F2F3F5] hover:text-[#0d0f14] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          title={isWsReadOnly ? "Review links are managed by workspace editors" : "Share a read-only review link"}
          type="button"
        >
          <Share2 className="h-4 w-4" />
          <span className="hidden xl:inline text-xs">Share</span>
        </button>

        {/* Stage 1 — the Canva-purple Publish CTA (prominent, gradient). */}
        <button
          data-testid="topnav-publish-button"
          onClick={() => useLaunchCenterStore.getState().openLaunchCenter()}
          disabled={isWsReadOnly}
          className="ml-1 flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#8B3DFF] to-[#7D2AE8] px-3.5 text-sm font-semibold text-white shadow-[0_2px_10px_rgba(125,42,232,0.35)] transition-all duration-200 hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          title={isWsReadOnly ? "Read-only sessions can't publish" : "Check and publish your website"}
          type="button"
        >
          <Rocket className="h-4 w-4" />
          <span className="hidden sm:inline text-xs">
            {publishStatus === "changes-unpublished" ? "Publish updates" : "Publish"}
          </span>
        </button>

        <div className="mx-1 h-4 w-px bg-black/10" />

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

// ---------------------------------------------------------------------------
// FileMenu — the project-level surface (Stage 1 left cluster)
//
// Consolidates the actions the previous chrome spread across the bar:
// save, .buildora.json export, backups, shortcuts, template, site settings.
// Every item calls the exact handler the old surface used — no new mutation
// paths.
// ---------------------------------------------------------------------------

function FileMenu({
  onSave,
  onExportProject,
  onOpenAssets,
  onOpenBackups,
  onOpenShortcuts,
  onOpenSaveTemplate,
  onOpenSiteSettings,
  showVersionHistory,
  onOpenVersionHistory,
  exporting,
  onExportSite,
  saveBusy,
}: {
  onSave: () => void | Promise<void>;
  onExportProject: () => void | Promise<void>;
  onOpenAssets: () => void;
  onOpenBackups: () => void;
  onOpenShortcuts: () => void;
  onOpenSaveTemplate: () => void;
  onOpenSiteSettings: () => void;
  showVersionHistory: boolean;
  onOpenVersionHistory: () => void;
  exporting: boolean;
  onExportSite: () => void;
  saveBusy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const item =
    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-[#3a3d46] transition-colors hover:bg-[#F2F3F5]";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-testid="topnav-file-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium text-[#3a3d46] transition-all duration-200 hover:bg-[#F2F3F5] active:scale-95"
        title="File"
      >
        File
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div
          role="menu"
          data-testid="topnav-file-menu-panel"
          className="absolute left-0 top-full z-50 mt-1 w-60 rounded-xl border border-black/10 bg-white p-1.5 shadow-[0_10px_32px_rgba(0,0,0,0.12)]"
        >
          <button role="menuitem" type="button" className={item} onClick={() => void onSave()} disabled={saveBusy}>
            <Save className="h-4 w-4 text-[#5b5e69]" />
            {saveBusy ? "Saving…" : "Save"}
            <span className="ml-auto text-[11px] text-[#8a8f9c]">Ctrl+S</span>
          </button>
          <button
            role="menuitem"
            type="button"
            data-testid="export-button"
            className={item}
            onClick={() => void onExportProject()}
          >
            <Download className="h-4 w-4 text-[#5b5e69]" />
            Export project (.json)
          </button>
          <button role="menuitem" type="button" className={item} onClick={onExportSite} disabled={exporting}>
            <Package className="h-4 w-4 text-[#5b5e69]" />
            {exporting ? "Exporting…" : "Export site ZIP"}
          </button>
          <div className="my-1 h-px bg-black/5" />
          <button role="menuitem" type="button" className={item} onClick={onOpenAssets}>
            <ImageIcon className="h-4 w-4 text-[#5b5e69]" />
            Assets
          </button>
          <button role="menuitem" type="button" className={item} onClick={onOpenSaveTemplate}>
            <LayoutTemplate className="h-4 w-4 text-[#5b5e69]" />
            Save as template
          </button>
          <button role="menuitem" type="button" className={item} onClick={onOpenSiteSettings}>
            <Settings2 className="h-4 w-4 text-[#5b5e69]" />
            Site settings
          </button>
          <button role="menuitem" type="button" className={item} onClick={onOpenBackups}>
            <History className="h-4 w-4 text-[#5b5e69]" />
            Backups & recovery
          </button>
          {showVersionHistory && (
            <button role="menuitem" type="button" className={item} onClick={onOpenVersionHistory}>
              <Clock className="h-4 w-4 text-[#5b5e69]" />
              Version history
            </button>
          )}
          <div className="my-1 h-px bg-black/5" />
          <button role="menuitem" type="button" className={item} onClick={onOpenShortcuts}>
            <Keyboard className="h-4 w-4 text-[#5b5e69]" />
            Keyboard shortcuts
            <span className="ml-auto text-[11px] text-[#8a8f9c]">Ctrl+K</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ViewportSwitcher — Canva-style responsive tabs (moved from the StatusBar so
// the switcher lives where designers expect it). Same editor-store state and
// the same `viewport-*` testids the e2e specs depend on — only the chrome
// moved.
// ---------------------------------------------------------------------------

function ViewportSwitcher() {
  const viewport = useEditorStore((s) => s.viewport);
  const setViewport = useEditorStore((s) => s.setViewport);

  const OPTIONS = [
    { id: "desktop" as const, label: "Desktop", icon: Monitor, testId: "viewport-desktop" },
    { id: "mobile" as const, label: "Mobile", icon: Smartphone, testId: "viewport-mobile" },
  ];

  return (
    <div
      role="tablist"
      aria-label="Viewport"
      className="ml-2 flex items-center gap-0.5 rounded-lg bg-[#F2F3F5] p-0.5"
    >
      {OPTIONS.map(({ id, label, icon: Icon, testId }) => {
        const active = viewport === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={testId}
            onClick={() => setViewport(id)}
            title={`${label} (${id === "desktop" ? "1440px" : "390px"})`}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-all duration-150",
              active
                ? "bg-white text-[#0d0f14] shadow-sm"
                : "text-[#5b5e69] hover:text-[#0d0f14]",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden md:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DocumentTitle — inline-editable project title with a clean hover state.
// Commits through the site-settings surface (siteName + project name stay in
// sync via the existing updateSiteSettings path — one history entry, no new
// mutation path).
// ---------------------------------------------------------------------------

function DocumentTitle() {
  const project = useEditorStore((s) => s.project);
  const updateSiteSettings = useEditorStore((s) => s.updateSiteSettings);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft !== null) {
      const trimmed = draft.trim();
      if (trimmed && trimmed !== project.name) {
        updateSiteSettings({ siteName: trimmed });
      }
    }
    setDraft(null);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        data-testid="document-title-input"
        autoFocus
        value={draft ?? ""}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setDraft(null);
            setEditing(false);
          }
        }}
        aria-label="Document title"
        className="h-8 w-56 rounded-lg border border-[#7D2AE8]/40 bg-white px-2.5 text-center text-sm font-medium text-[#0d0f14] focus:outline-none focus:ring-2 focus:ring-[#7D2AE8]/15"
      />
    );
  }

  return (
    <button
      type="button"
      data-testid="document-title"
      onClick={() => {
        setDraft(project.name || "");
        setEditing(true);
      }}
      className="max-w-[280px] truncate rounded-lg px-3 py-1.5 text-sm font-medium text-[#0d0f14] transition-colors duration-150 hover:bg-[#F2F3F5]"
      title="Rename document"
    >
      {project.name || "Untitled Project"}
    </button>
  );
}
