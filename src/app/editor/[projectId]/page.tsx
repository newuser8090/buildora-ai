// ---------------------------------------------------------------------------
// Editor Page — /editor/[projectId]
//
// Loads the editor with the specified project. If the project does not exist,
// shows a recoverable error state. Handles failed-flush protection when
// navigating away from the current active project.
// ---------------------------------------------------------------------------

"use client";

import { useEffect, useRef, useState } from "react";
import { useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import type { TemplateCategory } from "@/features/templates/types";
import { TopNav } from "@/components/editor/TopNav";
import { PageTabs } from "@/components/editor/PageTabs";
import { LeftSidebar } from "@/components/editor/LeftSidebar";
import { Canvas } from "@/components/editor/Canvas";
import { RightSidebar } from "@/components/editor/RightSidebar";
import { StatusBar } from "@/components/editor/StatusBar";
import { EditorProvider } from "@/components/editor/EditorProvider";
import { AddSectionDialog } from "@/features/editor/components/AddSectionDialog";
import { useEditorUiStore } from "@/features/editor/ui/editor-ui-store";
import { CommandPalette } from "@/features/guided-builder/components/CommandPalette";
import { TryGuidedBanner } from "@/features/guided-builder/components/TryGuidedBanner";
import { CodeImportDialog } from "@/features/code-import/components/CodeImportDialog";
import { MyBlocksRoot } from "@/features/my-blocks/components/MyBlocksRoot";
import { MyBlockDndProvider } from "@/features/my-blocks/drag/MyBlockDndProvider";
import { PreviewShell } from "@/features/preview/components/PreviewShell";
import { SiteSettingsDialog } from "@/features/site-settings/components/SiteSettingsDialog";
import { LaunchCenter } from "@/features/launch-readiness/components/LaunchCenter";
import { PublishDialog } from "@/features/publishing/components/PublishDialog";
import { getProjectController } from "@/features/persistence/services/project-controller";
import { ensureProjectController } from "@/features/persistence/hooks/useProjectController";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { ProjectTransitionResult } from "@/features/persistence/types";
import { RecoveryDialog } from "@/features/recovery/components/RecoveryDialog";
import { getRecoveryService } from "@/features/recovery/services/recovery-service";
import { useRecoveryUiStore } from "@/features/recovery/store/recovery-ui-store";
import dynamic from "next/dynamic";
import { KeyboardShortcutsDialog } from "@/features/help/components/KeyboardShortcutsDialog";
import { useCopilotMemory } from "@/features/ai-copilot/hooks/useCopilotMemory";
import { useShareSnapshotSync } from "@/features/sharing/hooks/useShareSnapshotSync";
import { openShareDialog } from "@/features/sharing/store/share-ui-store";

// Phase P14 — Team Workspaces & Controlled Collaboration
import { useWorkspaceEditorAccess } from "@/features/workspaces/hooks/useWorkspaceEditorAccess";
import { CollaborationDialogs } from "@/features/workspaces/components/CollaborationDialogs";

// Phase P10 — AI Copilot panel. Lazy-loaded: normal editor interactions have
// zero dependency on AI (opening/editing/saving work with the provider down).
const CopilotPanel = dynamic(
  () =>
    import("@/features/ai-copilot/components/CopilotPanel").then(
      (m) => m.CopilotPanel,
    ),
  { ssr: false },
);

// Phase P12 — Share dialog (lazy-loaded: sharing is never on the manual-edit
// hot path and editor startup must not depend on sharing APIs).
const ShareDialog = dynamic(
  () =>
    import("@/features/sharing/components/ShareDialog").then(
      (m) => m.ShareDialog,
    ),
  { ssr: false },
);
import { useHelpUiStore } from "@/features/help/store/help-ui-store";
import { SaveAsTemplateDialog } from "@/features/personal-templates/components/SaveAsTemplateDialog";
import { usePersonalTemplatesUiStore } from "@/features/personal-templates/store/personal-templates-ui-store";
import { getPersonalTemplateService } from "@/features/personal-templates/services/personal-template-service";
import { ActionFeedbackHost } from "@/features/feedback/components/ActionFeedbackHost";
import { Loader2, AlertCircle, ArrowLeft, Plus, History } from "lucide-react";

// ---------------------------------------------------------------------------
// Editor Page
// ---------------------------------------------------------------------------

export default function EditorPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = typeof params?.projectId === "string" ? params.projectId : null;

  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error" | "not-found">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  // Retry tick — bumped when the controller is not yet available so the
  // effect re-runs and retries. (A plain setLoadState("loading") is a no-op
  // when the state is already "loading", which would leave the editor stuck
  // on "Opening project..." forever.)
  const [retryTick, setRetryTick] = useState(0);
  // Phase P9 — recovery: when a project fails to load (e.g. a corrupted
  // write), offer last-known-good backups instead of a dead end.
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const initializedRef = useRef(false);
  // Tracks the in-flight openProject() transition so a React StrictMode
  // double-invoke (setup → cleanup → setup) can REUSE the same promise
  // instead of issuing a duplicate controller transition. Keyed by projectId
  // so a client-side route change to another project starts a fresh open.
  const openProjectRef = useRef<{
    projectId: string;
    promise: Promise<ProjectTransitionResult>;
  } | null>(null);

  const isHydrated = useEditorStore((s) => s.isHydrated);
  const activeProjectId = useEditorStore((s) => s.activeProjectId);

  useEffect(() => {
    if (!projectId || initializedRef.current) return;
    initializedRef.current = true;

    // Direct loads (e.g. a page refresh on /editor/[projectId]) may mount
    // before the useProjectController hook ever ran — the controller is
    // normally created by the dashboard or EditorProvider (which only mounts
    // AFTER the project loads). Bootstrap the singleton here so a fresh
    // editor load can open its project without waiting forever.
    let controller: ReturnType<typeof getProjectController> = null;
    try {
      controller = getProjectController() ?? ensureProjectController();
    } catch {
      controller = null;
    }

    if (!controller) {
      // Controller still unavailable (e.g. persistence bootstrap failed
      // transiently) — wait and retry. Bumping retryTick forces a re-render
      // so this effect re-runs instead of parking on "Opening project...".
      const retryTimer = setTimeout(() => {
        initializedRef.current = false;
        setRetryTick((t) => t + 1);
      }, 300);
      return () => {
        clearTimeout(retryTimer);
        // StrictMode-safe: reset the guard on cleanup so a dev-mode simulated
        // unmount/remount can re-schedule the retry instead of being swallowed.
        initializedRef.current = false;
      };
    }

    // Check if this project is already active
    if (activeProjectId === projectId) {
      // Use setTimeout to avoid set-state-in-effect lint rule. The ref is
      // reset in the cleanup so React StrictMode's double-invoke (dev) can
      // re-schedule the timer — the simulated unmount clears the first one,
      // and without the reset the guard would swallow the second invocation
      // and the editor would stay on "Opening project..." forever.
      const timer = setTimeout(() => setLoadState("loaded"), 0);
      return () => {
        clearTimeout(timer);
        initializedRef.current = false;
      };
    }

    // Open the project through the controller.
    //
    // StrictMode-safe: React dev double-invokes effects (setup → cleanup →
    // setup). The simulated cleanup cancels the first run's continuation, so
    // the second setup must re-attach to the SAME in-flight transition (kept
    // in openProjectRef) rather than calling openProject() again — that would
    // be a duplicate controller transition. The guard is also reset so the
    // second setup is not swallowed. Without this, the (single) openProject()
    // result is discarded and the editor stays on "Opening project..." forever.
    let cancelled = false;
    const inFlight = openProjectRef.current;
    const promise =
      inFlight && inFlight.projectId === projectId
        ? inFlight.promise
        : controller.openProject(projectId);
    openProjectRef.current = { projectId, promise };

    promise
      .then((result) => {
        if (cancelled) return;
        if (openProjectRef.current?.projectId === projectId) {
          openProjectRef.current = null;
        }
        if (result.success) {
          setLoadState("loaded");
        } else if (result.code === "PROJECT_LOAD_FAILED") {
          // Distinguish a genuinely missing project from a corrupted record:
          // a record that exists but fails validation can be recovered from a
          // last-known-good backup. The raw record is preserved — never
          // overwritten without explicit confirmation.
          if (result.error?.code === "PROJECT_NOT_FOUND") {
            setLoadState("not-found");
          } else {
            setLoadState("error");
            setLoadError(
              result.error?.message ?? "This project could not be opened.",
            );
            void getRecoveryService()
              .listSnapshots(projectId)
              .then((res) => {
                if (res.ok && res.snapshots.length > 0) {
                  setRecoveryAvailable(true);
                  setRecoveryOpen(true);
                }
              })
              .catch(() => {
                // Recovery is best-effort — never throw from the load path.
              });
          }
        } else if (result.code === "SAVE_BEFORE_TRANSITION_FAILED") {
          setLoadState("error");
          setLoadError("Cannot switch projects — there are unsaved changes. Please save or discard before continuing.");
        } else {
          setLoadState("error");
          setLoadError(result.error?.message ?? "Failed to open project");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (openProjectRef.current?.projectId === projectId) {
          openProjectRef.current = null;
        }
        setLoadState("error");
        setLoadError(err instanceof Error ? err.message : "Failed to open project");
      });

    return () => {
      cancelled = true;
      // StrictMode-safe: reset the guard so the simulated remount re-runs and
      // re-attaches to the reused promise. Real unmounts still cancel the
      // continuation (no state updates after unmount).
      initializedRef.current = false;
    };
  }, [projectId, activeProjectId, retryTick]);

  // ---- Not found state ----
  if (loadState === "not-found") {
    return (
      <div className="flex h-dvh items-center justify-center bg-base">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-card">
            <AlertCircle className="h-7 w-7 text-text-dim" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-text-primary">Project Not Found</h2>
          <p className="mt-1 text-sm text-text-muted">
            The project you are looking for does not exist or was deleted.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              onClick={() => router.push("/")}
              className="flex h-9 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-card hover:text-text-primary"
              type="button"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </button>
            {isHydrated && (
              <button
                onClick={() => router.push(`/editor/${activeProjectId}`)}
                className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover"
                type="button"
              >
                Open Active Project
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---- Loading state ----
  if (loadState === "loading" || !isHydrated) {
    return (
      <div className="flex h-dvh items-center justify-center bg-base">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-accent" />
          <p className="mt-4 text-sm text-text-muted">Opening project...</p>
        </div>
      </div>
    );
  }

  // ---- Error state ----
  if (loadState === "error") {
    return (
      <div className="flex h-dvh items-center justify-center bg-base">
        <div className="max-w-md text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-card">
            <AlertCircle className="h-7 w-7 text-red-400" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-text-primary">Could Not Open Project</h2>
          <p className="mt-2 text-sm text-text-muted">{loadError}</p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              onClick={() => router.push("/")}
              className="flex h-9 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-card hover:text-text-primary"
              type="button"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </button>
            <button
              onClick={() => {
                initializedRef.current = false;
                setLoadState("loading");
                setLoadError(null);
              }}
              className="flex h-9 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-card hover:text-text-primary"
              type="button"
            >
              <Plus className="h-4 w-4" />
              Retry
            </button>
            {recoveryAvailable && (
              <button
                onClick={() => setRecoveryOpen(true)}
                className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover"
                type="button"
                data-testid="recovery-open-button"
              >
                <History className="h-4 w-4" />
                Restore from backup
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---- Loaded: render editor ----
  return (
    <>
      <EditorProvider>
        <EditorShell />
      </EditorProvider>
      {/* Phase P9 — recovery prompt mounted at the page level so it can also
          appear on the load-failure screen. */}
      <RecoveryDialog
        open={recoveryOpen}
        projectId={projectId}
        projectName={projectId ?? undefined}
        onClose={() => setRecoveryOpen(false)}
        onRestored={() => {
          // The backup was saved through the persistence path — reload the
          // editor so the restored project hydrates cleanly.
          window.location.reload();
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// EditorShell — the editor chrome plus the shared Add Section dialog
// ---------------------------------------------------------------------------

function EditorShell() {
  // Phase P11 — bounded per-project Copilot memory: loads on project
  // hydration, debounced-saves conversation/style changes, never touches
  // project state. Mounted once so it survives the panel closing.
  useCopilotMemory();

  // Phase P14 — workspace editor session: access resolution, edit lease,
  // server saves with optimistic concurrency, authorization-loss handling.
  useWorkspaceEditorAccess();

  // Phase P12 — keeps shared projections fresh after edits (best-effort,
  // inert when no active shares exist or offline).
  useShareSnapshotSync();

  // Phase P12 — dashboard "Manage sharing" arrives as /editor/[id]?share=1
  // and opens the canonical share dialog once, then cleans the URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("share") !== "1") return;
    url.searchParams.delete("share");
    window.history.replaceState(null, "", url.toString());
    openShareDialog("create");
  }, []);

  const project = useEditorStore((s) => s.project);
  const selectedPageId = useEditorStore((s) => s.selectedPageId);
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);
  const open = useEditorUiStore((s) => s.addSectionDialog.open);

  // Phase P9 — mounted dialogs for help, personal templates, and recovery.
  const shortcutsOpen = useHelpUiStore((s) => s.shortcutsDialogOpen);
  const closeShortcuts = useHelpUiStore((s) => s.closeShortcutsDialog);
  const saveDialog = usePersonalTemplatesUiStore((s) => s.saveDialog);
  const closeSaveDialog = usePersonalTemplatesUiStore((s) => s.closeSaveDialog);
  const recovery = useRecoveryUiStore();

  const handleSaveAsTemplate = useCallback(
    async (input: { name: string; description: string; category: TemplateCategory; tags: string[] }) => {
      if (!saveDialog.project) {
        return {
          ok: false as const,
          error: { code: "PERSONAL_TEMPLATE_INVALID_INPUT" as const, message: "No project selected." },
        };
      }
      const result = await getPersonalTemplateService().saveAsTemplate({
        project: saveDialog.project,
        name: input.name,
        description: input.description,
        category: input.category,
        tags: input.tags,
      });
      return result;
    },
    [saveDialog.project],
  );

  const activePage =
    project.pages.find((p) => p.id === selectedPageId) ?? project.pages[0];

  return (
    <MyBlockDndProvider>
      <TopNav />
      <PageTabs />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <LeftSidebar />
        <Canvas />
        <RightSidebar />
      </div>
      <StatusBar />

      {/* Shared Add Section dialog — mounted once so both the structure
          panel and the empty canvas can open it. */}
      {open && activePage ? (
        <AddSectionDialog
          pageId={activePage.id}
          selectedSectionId={selectedSectionId}
          existingSections={activePage.sections}
        />
      ) : null}

      {/* Phase N: beginner command palette (Ctrl/Cmd+K) + Try Guided banner */}
      <CommandPalette />
      <TryGuidedBanner />

      {/* Phase P3: Import Studio — one canonical dialog for every entry point */}
      <CodeImportDialog />

      {/* Phase P4: My Blocks — shared library + save/rename/delete/import dialogs */}
      <MyBlocksRoot />

      {/* Phase P7: visitor preview, site settings, launch center, publishing */}
      <PreviewShell />
      <SiteSettingsDialog />
      <LaunchCenter />
      <PublishDialog />

      {/* Phase P10: AI Copilot — the canonical Copilot surface */}
      <CopilotPanel />

      {/* Phase P12: Share — the canonical share-management surface */}
      <ShareDialog />

      {/* Phase P14: collaboration session dialogs + read-only banner */}
      <CollaborationDialogs />

      {/* Phase P9: help, personal templates, recovery, feedback */}
      <KeyboardShortcutsDialog open={shortcutsOpen} onClose={closeShortcuts} />
      <ActionFeedbackHost />
      <SaveAsTemplateDialog
        open={saveDialog.open}
        project={saveDialog.project}
        onClose={closeSaveDialog}
        onSave={handleSaveAsTemplate}
      />
      <RecoveryDialog
        open={recovery.open}
        projectId={recovery.projectId}
        projectName={project.name}
        onClose={recovery.closeRecovery}
        onRestored={() => window.location.reload()}
      />
    </MyBlockDndProvider>
  );
}
