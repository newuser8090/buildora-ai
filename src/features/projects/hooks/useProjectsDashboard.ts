// ---------------------------------------------------------------------------
// useProjectsDashboard — dashboard state management hook
// ---------------------------------------------------------------------------

"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { getProjectController } from "@/features/persistence/services/project-controller";
import { DashboardMetadataService } from "../services/dashboard-metadata-service";
import { ProjectService } from "../services/project-service";
import { filterProjects } from "../utils/filter-projects";
import { sortProjects } from "../utils/sort-projects";
import { ProjectImportService } from "../services/project-import-service";
import { ProjectExportService } from "../services/project-export-service";
import {
  useDashboardThumbnails,
  type DashboardThumbnailState,
} from "@/features/thumbnails/hooks/useDashboardThumbnails";
import {
  getThumbnailStorage,
  getThumbnailGenerationService,
} from "@/features/thumbnails/services/thumbnail-save-bridge";
import type { ThumbnailError } from "@/features/thumbnails/types";
import type { ImportProjectPreview, ProjectTransferError } from "../types/project-transfer";
import type {
  DashboardProject,
  ProjectSortMode,
  DashboardOperation,
  ProjectDashboardError,
} from "../types";
import { mapPersistenceErrorToDashboard } from "../types";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface DashboardState {
  projects: DashboardProject[];
  filteredProjects: DashboardProject[];
  isLoading: boolean;
  isRefreshing: boolean;
  operation: DashboardOperation;
  searchQuery: string;
  sortMode: ProjectSortMode;
  /** Phase P9 — archived view toggle. */
  showArchived: boolean;
  error: ProjectDashboardError | null;
  activeProjectId: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useProjectsDashboard() {
  const router = useRouter();
  const activeProjectId = useEditorStore((s) => s.activeProjectId);

  const [state, setState] = useState<DashboardState>({
    projects: [],
    filteredProjects: [],
    isLoading: true,
    isRefreshing: false,
    operation: null,
    searchQuery: "",
    sortMode: "last-edited",
    showArchived: false,
    error: null,
    activeProjectId,
  });

  // ---- Thumbnails ----
  // Loaded independently of the project list so cards render placeholders
  // first and upgrade to real thumbnails asynchronously.
  const { thumbnails, reload: reloadThumbnail } = useDashboardThumbnails(state.projects);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  // Ref-based busy guard: read synchronously so two rapid clicks (before a
  // re-render) can never start two generations.
  const regeneratingRef = useRef(false);
  const loadedRef = useRef(false);

  // ---- Mount guard & operation tokens ----
  const isMountedRef = useRef(true);
  const operationSeqRef = useRef(0);

  useEffect(() => {
    // StrictMode-safe: re-set on every setup so a dev-mode simulated
    // unmount/remount never permanently flips the guard to false (which
    // would make every operation token stale and block all actions).
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /** Allocate a new operation token — older tokens become stale. */
  function nextToken(): number {
    return ++operationSeqRef.current;
  }

  /** True only if the component is still mounted AND the token is current. */
  function isCurrentOp(token: number): boolean {
    return isMountedRef.current && token === operationSeqRef.current;
  }

  // -----------------------------------------------------------------------
  // Load projects
  // -----------------------------------------------------------------------

  const loadProjects = useCallback(async (refresh = false) => {
    const controller = getProjectController();
    if (!controller) return;

    if (refresh) {
      setState((prev) => ({ ...prev, isRefreshing: true }));
    } else {
      setState((prev) => ({ ...prev, isLoading: true }));
    }

    try {
      // Use the controller's built-in listProjects method or ProjectService
      // For Phase D, the controller exposes a dedicated listProjects API
      const result = await controller.listProjects();
      if (!result.success) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          isRefreshing: false,
          error: mapPersistenceErrorToDashboard(result.error),
        }));
        return;
      }

      const store = useEditorStore.getState();
      const ctrl = getProjectController();

      // Load pin + archive metadata through the adapter's metadata API
      let pinMap = new Map<string, boolean>();
      let archivedMap = new Map<string, boolean>();
      if (ctrl) {
        try {
          // Access adapter through a typed controller-level API
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const metaService = new DashboardMetadataService((ctrl as any).adapter);
          pinMap = await metaService.getPinMap(result.projects.map((p) => p.id));
          archivedMap = await metaService.getArchivedMap(result.projects.map((p) => p.id));
        } catch {
          // Pin/archive metadata unavailable — proceed without them
        }
      }

      const transformed: DashboardProject[] = result.projects.map((p) => ({
        id: p.id,
        name: p.name,
        revision: p.revision,
        createdAt: p.createdAt || p.savedAt,
        updatedAt: p.updatedAt,
        savedAt: p.savedAt,
        isActive: p.id === store.activeProjectId,
        isPinned: pinMap.get(p.id) ?? false,
        isArchived: archivedMap.get(p.id) ?? false,
        pageCount: p.pageCount,
        assetCount: p.assetCount,
      }));

      setState((prev) => ({
        ...prev,
        projects: transformed,
        isLoading: false,
        isRefreshing: false,
        error: null,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        isRefreshing: false,
        error: {
          code: "PROJECT_LIST_FAILED",
          message: err instanceof Error ? err.message : "Failed to load projects",
          retryable: true,
        },
      }));
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (!loadedRef.current) {
      loadedRef.current = true;
      loadProjects();
    }
  }, [loadProjects]);

  // -----------------------------------------------------------------------
  // Filter + sort (using pure utilities)
  // -----------------------------------------------------------------------

  const filteredProjects = useMemo(() => {
    // Phase P9: archived projects are hidden from the main grid.
    const visible = state.showArchived
      ? state.projects.filter((p) => p.isArchived)
      : state.projects.filter((p) => !p.isArchived);
    const filtered = filterProjects(visible, state.searchQuery);
    const sorted = sortProjects(filtered, state.sortMode);
    return sorted.map((p) => {
      const t: DashboardThumbnailState | undefined = thumbnails[p.id];
      return {
        ...p,
        thumbnailUrl: t?.url ?? null,
        thumbnailStatus: t?.status ?? ("missing" as const),
        thumbnailRevision: t?.revision ?? null,
      };
    });
  }, [state.projects, state.searchQuery, state.sortMode, state.showArchived, thumbnails]);

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  /** Create a new project and navigate to editor */
  const createProject = useCallback(async () => {
    const controller = getProjectController();
    if (!controller) return;

    setState((prev) => ({
      ...prev,
      operation: { type: "creating" },
      error: null,
    }));

    const token = nextToken();

    try {
      const result = await controller.createProject();
      if (!isCurrentOp(token)) return;

      if (result.success && result.data) {
        const projectId = result.data.projectId;
        await loadProjects(true);
        if (!isCurrentOp(token)) return;
        router.push(`/editor/${projectId}`);
      } else {
        const err: ProjectDashboardError = {
          code: "PROJECT_CREATE_FAILED",
          message: "Failed to create project",
          retryable: true,
        };
        if (isCurrentOp(token)) {
          setState((prev) => ({ ...prev, operation: null, error: err }));
        }
      }
    } catch (err) {
      if (isCurrentOp(token)) {
        setState((prev) => ({
          ...prev,
          operation: null,
          error: {
            code: "PROJECT_CREATE_FAILED",
            message: err instanceof Error ? err.message : "Failed to create project",
            retryable: true,
          },
        }));
      }
    }
  }, [router, loadProjects]);

  /**
   * Create a project from a registered template and navigate to the editor.
   *
   * Persistence/activation happen inside the controller; the dashboard only
   * refreshes the list and navigates — both guarded by the operation token so
   * a stale completion can never navigate after unmount or a newer operation.
   */
  const createProjectFromTemplate = useCallback(
    async (
      templateId: string,
      projectName: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const controller = getProjectController();
      if (!controller) {
        return { ok: false, error: "Controller not initialized" };
      }

      setState((prev) => ({
        ...prev,
        operation: { type: "creating" },
        error: null,
      }));

      const token = nextToken();

      try {
        const result = await controller.createProjectFromTemplate({
          templateId,
          projectName,
        });
        if (!isCurrentOp(token)) {
          return { ok: false, error: "Operation superseded" };
        }

        if (!result.success) {
          const err: ProjectDashboardError = {
            code: "PROJECT_CREATE_FAILED",
            message: result.error?.message ?? "Failed to create project from template",
            retryable: true,
          };
          setState((prev) => ({ ...prev, operation: null, error: err }));
          return { ok: false, error: err.message };
        }

        if (!result.data) {
          const err: ProjectDashboardError = {
            code: "PROJECT_CREATE_FAILED",
            message: "Failed to create project from template",
            retryable: true,
          };
          setState((prev) => ({ ...prev, operation: null, error: err }));
          return { ok: false, error: err.message };
        }

        const projectId = result.data.projectId;
        await loadProjects(true);
        if (!isCurrentOp(token)) {
          return { ok: false, error: "Operation superseded" };
        }
        setState((prev) => ({ ...prev, operation: null }));
        router.push(`/editor/${projectId}`);
        return { ok: true };
      } catch (err) {
        if (isCurrentOp(token)) {
          setState((prev) => ({
            ...prev,
            operation: null,
            error: {
              code: "PROJECT_CREATE_FAILED",
              message: err instanceof Error ? err.message : "Failed to create project from template",
              retryable: true,
            },
          }));
        }
        return { ok: false, error: err instanceof Error ? err.message : "Failed to create project from template" };
      }
    },
    [router, loadProjects],
  );

  /** Open a project (handles flush failure) */
  const openProject = useCallback(
    async (projectId: string) => {
      const controller = getProjectController();
      if (!controller) return;

      setState((prev) => ({
        ...prev,
        operation: { type: "opening", projectId },
        error: null,
      }));

    const token = nextToken();

    try {
      const result = await controller.openProject(projectId);
      if (!isCurrentOp(token)) return;

      if (result.success) {
        await loadProjects(true);
        if (!isCurrentOp(token)) return;
        router.push(`/editor/${projectId}`);
      } else if (result.code === "SAVE_BEFORE_TRANSITION_FAILED") {
        setState((prev) => ({
          ...prev,
          operation: null,
          error: {
            code: "SAVE_BEFORE_TRANSITION_FAILED",
            message: "Save the current project before switching, or discard unsaved changes.",
            retryable: true,
          },
        }));
      } else {
        setState((prev) => ({
          ...prev,
          operation: null,
          error: {
            code: "PROJECT_OPEN_FAILED",
            message: result.error?.message ?? "Failed to open project",
            retryable: true,
          },
        }));
      }
    } catch (err) {
      if (isCurrentOp(token)) {
        setState((prev) => ({
          ...prev,
          operation: null,
          error: {
            code: "PROJECT_OPEN_FAILED",
            message: err instanceof Error ? err.message : "Failed to open project",
            retryable: true,
          },
        }));
      }
    }
    },
    [router, loadProjects],
  );

  /** Open project discarding unsaved changes */
  const discardAndOpenProject = useCallback(
    async (projectId: string) => {
      const controller = getProjectController();
      if (!controller) return;

      setState((prev) => ({
        ...prev,
        operation: { type: "opening", projectId },
        error: null,
      }));

      const token = nextToken();

      try {
        // Use the controller's discardAndOpenProject API
        const result = await controller.discardAndOpenProject(projectId);
        if (!isCurrentOp(token)) return;

        if (!result.success) {
          setState((prev) => ({
            ...prev,
            operation: null,
            error: {
              code: "PROJECT_OPEN_FAILED",
              message: result.error?.message ?? "Failed to load project",
              retryable: true,
            },
          }));
          return;
        }

        await loadProjects(true);
        if (!isCurrentOp(token)) return;
        router.push(`/editor/${projectId}`);
      } catch (err) {
        if (isCurrentOp(token)) {
          setState((prev) => ({
            ...prev,
            operation: null,
            error: {
              code: "PROJECT_OPEN_FAILED",
              message: err instanceof Error ? err.message : "Failed to open project",
              retryable: true,
            },
          }));
        }
      }
    },
    [router, loadProjects],
  );

  /** Delete a project */
  const deleteProject = useCallback(
    async (projectId: string) => {
      const controller = getProjectController();
      if (!controller) return;

      setState((prev) => ({
        ...prev,
        operation: { type: "deleting", projectId },
        error: null,
      }));

    const token = nextToken();

    try {
      const result = await controller.deleteProject(projectId);
      if (!isCurrentOp(token)) return;

      if (result.success) {
        await loadProjects(true);
        if (!isCurrentOp(token)) return;
        if (projectId === activeProjectId) {
          // Active project was deleted — navigate to dashboard
          router.push("/");
        }
      } else {
        setState((prev) => ({
          ...prev,
          operation: null,
          error: {
            code: "PROJECT_DELETE_FAILED",
            message: result.error?.message ?? "Failed to delete project",
            retryable: true,
          },
        }));
      }
    } catch (err) {
      if (isCurrentOp(token)) {
        setState((prev) => ({
          ...prev,
          operation: null,
          error: {
            code: "PROJECT_DELETE_FAILED",
            message: err instanceof Error ? err.message : "Failed to delete project",
            retryable: true,
          },
        }));
      }
    }
    },
    [router, loadProjects, activeProjectId],
  );

  /** Toggle pin — persists through adapter metadata API */
  const togglePin = useCallback(
    async (projectId: string) => {
      // Read current state from the projects list
      const currentProject = state.projects.find((p) => p.id === projectId);
      const newPinned = !(currentProject?.isPinned ?? false);

      const token = nextToken();

      // Optimistic update
      setState((prev) => ({
        ...prev,
        projects: prev.projects.map((p) =>
          p.id === projectId ? { ...p, isPinned: newPinned } : p,
        ),
        operation: { type: "pinning", projectId },
      }));

      try {
        const controller = getProjectController();
        if (!controller) {
          if (!isCurrentOp(token)) return;
          // Rollback
          setState((prev) => ({
            ...prev,
            projects: prev.projects.map((p) =>
              p.id === projectId ? { ...p, isPinned: !newPinned } : p,
            ),
          }));
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const metaService = new DashboardMetadataService((controller as any).adapter);
        const result = await metaService.setPinned(projectId, newPinned);
        if (!result.success) {
          if (!isCurrentOp(token)) return;
          // Rollback on failure
          setState((prev) => ({
            ...prev,
            projects: prev.projects.map((p) =>
              p.id === projectId ? { ...p, isPinned: !newPinned } : p,
            ),
            error: {
              code: "PROJECT_PIN_FAILED",
              message: "Failed to update pin state",
              retryable: true,
            },
          }));
        }
      } catch {
        if (!isCurrentOp(token)) return;
        // Rollback on failure
        setState((prev) => ({
          ...prev,
          projects: prev.projects.map((p) =>
            p.id === projectId ? { ...p, isPinned: !newPinned } : p,
          ),
        }));
      } finally {
        if (isCurrentOp(token)) {
          setState((prev) => ({ ...prev, operation: null }));
        }
      }
    },
    [state.projects],
  );

  /** Set search query */
  const setSearchQuery = useCallback((query: string) => {
    setState((prev) => ({ ...prev, searchQuery: query }));
  }, []);

  /** Set sort mode */
  const setSortMode = useCallback((mode: ProjectSortMode) => {
    setState((prev) => ({ ...prev, sortMode: mode }));
  }, []);

  /** Rename a project (active through controller, inactive through ProjectService) */
  const renameProject = useCallback(
    async (projectId: string, newName: string): Promise<{ success: boolean; error?: string }> => {
      const controller = getProjectController();
      if (!controller) return { success: false, error: "Controller not initialized" };

      const store = useEditorStore.getState();
      const isActive = projectId === store.activeProjectId;

      setState((prev) => ({
        ...prev,
        operation: { type: "renaming", projectId },
        error: null,
      }));

      const token = nextToken();

      try {
        if (isActive) {
          // Use controller lifecycle for active project rename
          const result = await controller.renameActiveProject(newName);
          if (!isCurrentOp(token)) return { success: false, error: "Operation superseded" };
          if (!result.success) {
            const msg = result.error?.message ?? "Failed to rename project";
            setState((prev) => ({
              ...prev,
              operation: null,
              error: { code: "PROJECT_RENAME_FAILED", message: msg, retryable: true },
            }));
            return { success: false, error: msg };
          }
          // Phase P9: renameActiveProject only updates the in-memory store and
          // schedules a DEBOUNCED autosave. Flush now so the refreshed list
          // (read straight from IndexedDB) shows the new name instead of a
          // stale record.
          const flush = await controller.saveNow();
          if (!isCurrentOp(token)) return { success: false, error: "Operation superseded" };
          if (!flush.success) {
            const msg = flush.error?.message ?? "Failed to save renamed project";
            setState((prev) => ({
              ...prev,
              operation: null,
              error: { code: "PROJECT_RENAME_FAILED", message: msg, retryable: true },
            }));
            return { success: false, error: msg };
          }
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const service = new ProjectService((controller as any).adapter);
          const result = await service.renameProject(projectId, newName);
          if (!isCurrentOp(token)) return { success: false, error: "Operation superseded" };
          if (!result.success) {
            const msg = result.error?.message ?? "Failed to rename project";
            setState((prev) => ({
              ...prev,
              operation: null,
              error: { code: "PROJECT_RENAME_FAILED", message: msg, retryable: true },
            }));
            return { success: false, error: msg };
          }
        }

        await loadProjects(true);
        if (!isCurrentOp(token)) return { success: false, error: "Operation superseded" };
        setState((prev) => ({ ...prev, operation: null }));
        return { success: true };
      } catch (err) {
        if (isCurrentOp(token)) {
          setState((prev) => ({
            ...prev,
            operation: null,
            error: { code: "PROJECT_RENAME_FAILED", message: err instanceof Error ? err.message : "Rename failed", retryable: true },
          }));
        }
        return { success: false, error: err instanceof Error ? err.message : "Rename failed" };
      }
    },
    [loadProjects],
  );

  /** Parse an imported file — returns preview */
  const parseImport = useCallback(
    async (text: string, filename: string): Promise<
      | { ok: true; preview: ImportProjectPreview }
      | { ok: false; error: ProjectTransferError }
    > => {
      const controller = getProjectController();
      if (!controller) {
        return {
          ok: false,
          error: { code: "UNKNOWN_TRANSFER_ERROR", message: "Controller not initialized" },
        };
      }
      const importService = new ProjectImportService();
      return importService.parse(text, filename);
    },
    [],
  );

  /** Commit an imported preview */
  const commitImport = useCallback(
    async (preview: ImportProjectPreview, finalName: string): Promise<
      | { ok: true; projectId: string }
      | { ok: false; error: ProjectTransferError }
    > => {
      const controller = getProjectController();
      if (!controller) {
        return {
          ok: false,
          error: { code: "UNKNOWN_TRANSFER_ERROR", message: "Controller not initialized" },
        };
      }

      const token = nextToken();
      setState((prev) => ({
        ...prev,
        operation: { type: "importing", token },
        error: null,
      }));

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const service = new ProjectService((controller as any).adapter);
        const existingNames = state.projects.map((p) => p.name);
        const result = await service.commitImportedProject(preview, existingNames, {
          name: finalName,
          preserveCreatedAt: true,
        });

        if (!isCurrentOp(token)) {
          return { ok: false, error: { code: "UNKNOWN_TRANSFER_ERROR", message: "Operation superseded" } };
        }

        if (!result.ok) {
          setState((prev) => ({ ...prev, operation: null, error: { code: "PROJECT_CREATE_FAILED", message: result.error.message, retryable: true } }));
          return result;
        }

        // Refresh project list
        await loadProjects(true);
        if (!isCurrentOp(token)) {
          return { ok: false, error: { code: "UNKNOWN_TRANSFER_ERROR", message: "Operation superseded" } };
        }

        setState((prev) => ({ ...prev, operation: null }));
        return { ok: true, projectId: result.project.id };
      } catch (err) {
        if (isCurrentOp(token)) {
          setState((prev) => ({ ...prev, operation: null, error: { code: "PROJECT_CREATE_FAILED", message: err instanceof Error ? err.message : "Failed to save imported project", retryable: true } }));
        }
        return { ok: false, error: { code: "IMPORT_SAVE_FAILED", message: err instanceof Error ? err.message : "Failed to save imported project", cause: err } };
      }
    },
    [state.projects, loadProjects],
  );

  /** Export a project from the dashboard */
  const exportProjectById = useCallback(
    async (projectId: string): Promise<
      | { ok: true; filename: string; content: string }
      | { ok: false; error: ProjectTransferError }
    > => {
      const controller = getProjectController();
      if (!controller) {
        return {
          ok: false,
          error: { code: "UNKNOWN_TRANSFER_ERROR", message: "Controller not initialized" },
        };
      }

      const token = nextToken();
      setState((prev) => ({
        ...prev,
        operation: { type: "exporting", projectId, token },
        error: null,
      }));

      try {
        // Load the full project
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const loadFullResult = await (controller as any).adapter.loadProject(projectId);
        if (!isCurrentOp(token)) {
          return { ok: false, error: { code: "UNKNOWN_TRANSFER_ERROR", message: "Operation superseded" } };
        }

        if (!loadFullResult.success) {
          setState((prev) => ({
            ...prev,
            operation: null,
            error: { code: "PROJECT_OPEN_FAILED", message: loadFullResult.error?.message ?? "Failed to load project", retryable: true },
          }));
          return { ok: false, error: { code: "EXPORT_SERIALIZATION_FAILED", message: loadFullResult.error?.message ?? "Failed to load project", cause: loadFullResult.error } };
        }

        const exportService = new ProjectExportService();
        const exportResult = exportService.exportProject(loadFullResult.project);

        if (!isCurrentOp(token)) {
          return { ok: false, error: { code: "UNKNOWN_TRANSFER_ERROR", message: "Operation superseded" } };
        }

        if (!exportResult.ok) {
          setState((prev) => ({
            ...prev,
            operation: null,
            error: { code: "PROJECT_DUPLICATE_FAILED", message: exportResult.error.message, retryable: true },
          }));
          return exportResult;
        }

        setState((prev) => ({ ...prev, operation: null }));
        return { ok: true, filename: exportResult.filename, content: exportResult.content };
      } catch (err) {
        if (isCurrentOp(token)) {
          setState((prev) => ({ ...prev, operation: null, error: { code: "PROJECT_DUPLICATE_FAILED", message: err instanceof Error ? err.message : "Export failed", retryable: true } }));
        }
        return { ok: false, error: { code: "EXPORT_SERIALIZATION_FAILED", message: err instanceof Error ? err.message : "Export failed", cause: err } };
      }
    },
    [],
  );

  /** Duplicate a project */
  const duplicateProject = useCallback(
    async (projectId: string): Promise<{ success: boolean; error?: string; projectId?: string }> => {
      const controller = getProjectController();
      if (!controller) return { success: false, error: "Controller not initialized" };

      setState((prev) => ({
        ...prev,
        operation: { type: "duplicating", projectId },
        error: null,
      }));

      const token = nextToken();

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const service = new ProjectService((controller as any).adapter);
        const existingNames = state.projects.map((p) => p.name);
        const result = await service.duplicateProject(projectId, existingNames);
        if (!isCurrentOp(token)) return { success: false, error: "Operation superseded" };
        if (!result.success) {
          const msg = result.error?.message ?? "Failed to duplicate project";
          setState((prev) => ({
            ...prev,
            operation: null,
            error: { code: "PROJECT_DUPLICATE_FAILED", message: msg, retryable: true },
          }));
          return { success: false, error: msg };
        }

        await loadProjects(true);
        if (!isCurrentOp(token)) return { success: false, error: "Operation superseded" };
        setState((prev) => ({ ...prev, operation: null }));
        return { success: true, projectId: result.project.id };
      } catch (err) {
        if (isCurrentOp(token)) {
          setState((prev) => ({
            ...prev,
            operation: null,
            error: { code: "PROJECT_DUPLICATE_FAILED", message: err instanceof Error ? err.message : "Duplicate failed", retryable: true },
          }));
        }
        return { success: false, error: err instanceof Error ? err.message : "Duplicate failed" };
      }
    },
    [state.projects, loadProjects],
  );

  /** Set the archived-view toggle (Phase P9). */
  const setShowArchived = useCallback((show: boolean) => {
    setState((prev) => ({ ...prev, showArchived: show }));
  }, []);

  /**
   * Archive or restore a project (Phase P9).
   *
   * Archive hides the project from the main grid (metadata flag only — the
   * project record and its remote deployments are never deleted). Restore
   * brings it back. Optimistic update with rollback on failure.
   */
  const setProjectArchived = useCallback(
    async (projectId: string, isArchived: boolean) => {
      const controller = getProjectController();
      if (!controller) {
        setState((prev) => ({
          ...prev,
          error: {
            code: "PROJECT_ARCHIVE_FAILED",
            message: "Controller not initialized",
            retryable: true,
          },
        }));
        return { success: false } as const;
      }

      const token = nextToken();
      setState((prev) => ({
        ...prev,
        projects: prev.projects.map((p) =>
          p.id === projectId ? { ...p, isArchived } : p,
        ),
        operation: { type: "archiving", projectId },
      }));

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const metaService = new DashboardMetadataService((controller as any).adapter);
        const result = await metaService.setArchived(projectId, isArchived);
        if (!isCurrentOp(token)) return { success: true } as const;
        if (!result.success) {
          // Rollback the optimistic flag.
          setState((prev) => ({
            ...prev,
            projects: prev.projects.map((p) =>
              p.id === projectId ? { ...p, isArchived: !isArchived } : p,
            ),
            error: {
              code: "PROJECT_ARCHIVE_FAILED",
              message: result.error.message ?? "Failed to update archive state",
              retryable: true,
            },
          }));
          return { success: false } as const;
        }
        return { success: true } as const;
      } catch (err) {
        if (isCurrentOp(token)) {
          setState((prev) => ({
            ...prev,
            projects: prev.projects.map((p) =>
              p.id === projectId ? { ...p, isArchived: !isArchived } : p,
            ),
            error: {
              code: "PROJECT_ARCHIVE_FAILED",
              message: err instanceof Error ? err.message : "Failed to update archive state",
              retryable: true,
            },
          }));
        }
        return { success: false } as const;
      } finally {
        if (isCurrentOp(token)) {
          setState((prev) => ({ ...prev, operation: null }));
        }
      }
    },
    [],
  );

  /** Clear error */
  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  /**
   * Manually regenerate a project's thumbnail.
   *
   * Policy:
   *   - loads the FULL persisted project (never the dashboard summary)
   *   - generates from the PERSISTED revision (active dirty projects reflect
   *     their last saved state unless the user saves first — documented)
   *   - repeated clicks blocked while one regeneration is running
   *   - does NOT mark the project dirty, change revision, or change updatedAt
   *   - failure maps to a non-blocking error (card shows error state)
   */
  const regenerateThumbnail = useCallback(
    async (projectId: string): Promise<{ ok: true } | { ok: false; error: ThumbnailError }> => {
      const controller = getProjectController();
      if (!controller) {
        return {
          ok: false,
          error: {
            code: "RENDER_TARGET_UNAVAILABLE",
            message: "Thumbnail generation is not available.",
            retryable: true,
          },
        };
      }

      if (regeneratingRef.current) return { ok: false, error: { code: "RENDER_FAILED", message: "A thumbnail is already being generated.", retryable: true } };

      regeneratingRef.current = true;
      setRegeneratingId(projectId);
      const token = nextToken();

      try {
        // Load the full persisted project.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const loadResult = await (controller as any).adapter.loadProject(projectId);
        if (!isCurrentOp(token)) {
          return { ok: false, error: { code: "GENERATION_CANCELLED", message: "Regeneration was cancelled.", retryable: true } };
        }
        if (!loadResult.success) {
          const err: ThumbnailError = {
            code: "PROJECT_NOT_FOUND",
            message: loadResult.error?.message ?? "Project could not be loaded.",
            projectId,
            retryable: false,
          };
          return { ok: false, error: err };
        }

        const storage = getThumbnailStorage();
        const generation = getThumbnailGenerationService();
        if (!storage || !generation) {
          return {
            ok: false,
            error: { code: "RENDER_TARGET_UNAVAILABLE", message: "Thumbnail generation is not available.", retryable: true },
          };
        }

        const result = await generation.generate({
          project: loadResult.project,
          revision: loadResult.revision,
        });
        if (!isCurrentOp(token)) {
          return { ok: false, error: { code: "GENERATION_CANCELLED", message: "Regeneration was cancelled.", retryable: true } };
        }
        if (!result.ok) return { ok: false, error: result.error };

        const saveResult = await storage.saveThumbnail(result.record);
        if (!isCurrentOp(token)) {
          return { ok: false, error: { code: "GENERATION_CANCELLED", message: "Regeneration was cancelled.", retryable: true } };
        }
        if (!saveResult.success) return { ok: false, error: saveResult.error };

        // Invalidate the dashboard cache so the freshly generated thumbnail
        // appears without a full remount (revision/updatedAt are unchanged
        // by regeneration, so the hook needs an explicit reload).
        reloadThumbnail(projectId);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: "UNKNOWN_THUMBNAIL_ERROR",
            message: "Thumbnail generation failed. Please try again.",
            projectId,
            retryable: true,
            cause: err instanceof Error ? err.message : String(err),
          },
        };
      } finally {
        // Always clear the busy flags, even if the operation was superseded,
        // so a stale token can never permanently block future regenerations.
        regeneratingRef.current = false;
        setRegeneratingId(null);
      }
    },
    [reloadThumbnail],
  );

  return {
    projects: filteredProjects,
    allProjects: state.projects,
    isLoading: state.isLoading,
    isRefreshing: state.isRefreshing,
    operation: state.operation,
    searchQuery: state.searchQuery,
    sortMode: state.sortMode,
    showArchived: state.showArchived,
    setShowArchived,
    setProjectArchived,
    error: state.error,
    activeProjectId: state.activeProjectId,
    loadProjects,
    createProject,
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
  };
}
