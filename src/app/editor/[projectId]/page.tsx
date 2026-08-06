// ---------------------------------------------------------------------------
// Editor Page — /editor/[projectId]
//
// Loads the editor with the specified project. If the project does not exist,
// shows a recoverable error state. Handles failed-flush protection when
// navigating away from the current active project.
// ---------------------------------------------------------------------------

"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
import { getProjectController } from "@/features/persistence/services/project-controller";
import { ensureProjectController } from "@/features/persistence/hooks/useProjectController";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { ProjectTransitionResult } from "@/features/persistence/types";
import { Loader2, AlertCircle, ArrowLeft, Plus } from "lucide-react";

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
          setLoadState("not-found");
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
              className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover"
              type="button"
            >
              <Plus className="h-4 w-4" />
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Loaded: render editor ----
  return (
    <EditorProvider>
      <EditorShell />
    </EditorProvider>
  );
}

// ---------------------------------------------------------------------------
// EditorShell — the editor chrome plus the shared Add Section dialog
// ---------------------------------------------------------------------------

function EditorShell() {
  const project = useEditorStore((s) => s.project);
  const selectedPageId = useEditorStore((s) => s.selectedPageId);
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);
  const open = useEditorUiStore((s) => s.addSectionDialog.open);

  const activePage =
    project.pages.find((p) => p.id === selectedPageId) ?? project.pages[0];

  return (
    <>
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
    </>
  );
}
