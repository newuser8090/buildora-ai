// ---------------------------------------------------------------------------
// ProjectController
//
// Owns orchestration between the Zustand editor store, AutosaveCoordinator,
// and IndexedDbProjectAdapter. Framework-independent (no React imports).
//
// Flow:
//   UI → Zustand Store → ProjectController → AutosaveCoordinator → Adapter → IndexedDB
//
// Zustand remains the SINGLE SOURCE OF TRUTH.
// Persistence is only a storage layer.
//
// Lifecycle transitions (create/open/switch/delete) return structured
// ProjectTransitionResult. A failed flush of a dirty project blocks
// any transition — unsaved edits are NEVER silently discarded.
// ---------------------------------------------------------------------------

import { useEditorStore } from "@/features/editor/store/editor-store";
import { scheduleThumbnailForSave, removeThumbnailForProject } from "@/features/thumbnails/services/thumbnail-save-bridge";
import { lazyCopilotMemoryCleanup } from "@/features/ai-copilot/memory/services/lazy-cleanup";
import { AutosaveCoordinator } from "./autosave-coordinator";
import type {
  ProjectPersistenceAdapter,
  AutosaveCoordinator as AutosaveCoordinatorInterface,
  PersistenceError,
  AutosaveState,
  ProjectTransitionResult,
  ProjectSummaryResult,
} from "../types";
import type { Project } from "@/types/project";
import { INITIAL_REVISION, AUTOSAVE_DEBOUNCE_MS } from "../constants";
import { validateProjectName } from "@/features/projects/utils/validate-project-name";
import { TemplateProjectFactory } from "@/features/templates/services/template-project-factory";
import { registerDefaultTemplates } from "@/features/templates/registry/register-default-templates";
import { recordPerf } from "@/features/perf/perf-instrumentation";

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class ProjectController {
  private adapter: ProjectPersistenceAdapter;
  private coordinator: AutosaveCoordinatorInterface | null = null;
  private unsubStore: (() => void) | null = null;
  private coordinatorUnsub: (() => void) | null = null;

  private _hydrated: boolean = false;
  private _suppressNextDirty: boolean = false;

  /**
   * Schedule thumbnail generation for the currently active project AFTER a
   * successful persisted save. Uses a deep-cloned snapshot of the project so
   * no stale live reference is captured. Safe no-op when thumbnail
   * infrastructure is unavailable — a thumbnail failure must never affect
   * saveStatus, revision, or dirty state.
   */
  private _scheduleThumbnailAfterSave(): void {
    try {
      const store = useEditorStore.getState();
      if (!store.project || !store.project.id) return;
      const snapshot: Project = JSON.parse(JSON.stringify(store.project));
      scheduleThumbnailForSave({
        project: snapshot,
        projectId: snapshot.id,
        revision: store.revision,
      });
    } catch {
      // Never break the save flow.
    }
  }

  /**
   * Phase P9 — after a successful persisted save, capture a bounded
   * last-known-good recovery snapshot (cooldown-gated; non-blocking). A
   * backup failure must never affect saveStatus, revision, or dirty state.
   */
  private _scheduleRecoveryAfterSave(): void {
    try {
      const store = useEditorStore.getState();
      if (!store.project || !store.project.id) return;
      const snapshot: Project = JSON.parse(JSON.stringify(store.project));
      void (async () => {
        const { getRecoveryService } = await import(
          "@/features/recovery/services/recovery-service"
        );
        await getRecoveryService().capture({
          project: snapshot,
          revision: store.revision,
          reason: "autosave",
        });
      })().catch(() => {
        // Never break the save flow.
      });
    } catch {
      // Never break the save flow.
    }
  }

  /** Guard: one in-flight initialization */
  private initializationPromise: Promise<void> | null = null;
  /** Guard: one in-flight transition (create/open/switch/delete) at a time */
  private transitionPromise: Promise<ProjectTransitionResult<unknown>> | null = null;
  /** True while a transition is actively running */
  private _transitioning: boolean = false;

  constructor(adapter: ProjectPersistenceAdapter) {
    this.adapter = adapter;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    _controllerInstance = this;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  get isHydrated(): boolean {
    return this._hydrated;
  }

  get isTransitioning(): boolean {
    return this._transitioning;
  }

  // -----------------------------------------------------------------------
  // Initialize
  // -----------------------------------------------------------------------

  /**
   * Initialize the controller: restore active project or create blank one.
   * Idempotent and concurrency-safe — repeated calls return the same promise.
   */
  async initialize(): Promise<void> {
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = this._doInitialize().finally(() => {
      this.initializationPromise = null;
    });

    return this.initializationPromise;
  }

  private async _doInitialize(): Promise<void> {
    try {
      useEditorStore.getState().setSaveStatus("hydrating");

      const activeResult = await this.adapter.getActiveProjectId();

      if (activeResult.success && activeResult.projectId) {
        await this._hydrateExistingProject(activeResult.projectId);
      } else if (this._hydrated) {
        // Already hydrated (e.g. repeated initialize on a first-run workspace
        // with nothing persisted) — keep the existing in-memory project.
        useEditorStore.getState().setSaveStatus("idle");
      } else {
        // No active project. Distinguish a true first run (no stored projects)
        // from a recovery scenario (stored projects but a missing active pointer).
        const listResult = await this.adapter.listProjects().catch(() => null);
        const hasStoredProjects =
          !!listResult?.success && listResult.projects.length > 0;

        if (hasStoredProjects) {
          // Stored projects exist but no active pointer — fall back to creating
          // a fresh persisted project (legacy behavior, preserves existing data).
          await this._createFreshProject();
        } else {
          // True first run: hydrate an in-memory blank workspace WITHOUT
          // persisting anything. No database records are created merely by
          // opening the app; the dashboard shows an empty state instead.
          this._createBlankProject();
          this._hydrated = true;
        }
      }
    } catch (err) {
      const error: PersistenceError = {
        code: "UNKNOWN_PERSISTENCE_ERROR",
        message: err instanceof Error ? err.message : "Failed to initialize persistence",
      };

      // Fallback: create a blank recovery workspace in memory
      this._createBlankProject();
      this._hydrated = true;

      // Set hydration error AFTER blank project (hydrateProject resets it)
      useEditorStore.getState().setHydrationError(error);
      useEditorStore.getState().setSaveStatus("error");
    }
  }

  // -----------------------------------------------------------------------
  // Create Project
  // -----------------------------------------------------------------------

  /**
   * Create a brand-new project and persist it immediately.
   * Returns SAVE_BEFORE_TRANSITION_FAILED if the current dirty project
   * cannot be flushed. The active project remains unchanged.
   */
  async createProject(): Promise<ProjectTransitionResult<{ projectId: string }>> {
    const prep = await this._prepareForProjectTransition();
    if (!prep.success) return prep as ProjectTransitionResult<{ projectId: string }>;

    const project = this._generateBlankProject();
    const revision = INITIAL_REVISION;

    return this._runTransition<{ projectId: string }>(async () => {
      // Persist the new project first
      const saveResult = await this.adapter.saveProject({ project, revision });
      if (!saveResult.success) {
        return { success: false, code: "PROJECT_CREATE_FAILED", error: saveResult.error };
      }

      // Set as active — failure must not hydrate the store
      const activeResult = await this.adapter.setActiveProjectId(project.id);
      if (!activeResult.success) {
        return { success: false, code: "ACTIVE_PROJECT_UPDATE_FAILED", error: activeResult.error };
      }

      this._suppressNextDirty = true;
      useEditorStore.getState().hydrateProject(project, revision);
      useEditorStore.getState().setLastSavedAt(revision === 1 ? new Date().toISOString() : null);

      this._createCoordinator();
      this._subscribeCoordinator();
      this._subscribeStore();

      this._hydrated = true;
      // Schedule thumbnail generation after the first successful persisted
      // creation (non-blocking; never affects saveStatus).
      this._scheduleThumbnailAfterSave();
      return { success: true, data: { projectId: project.id } };
    });
  }

  // -----------------------------------------------------------------------
  // Create Project From Template
  // -----------------------------------------------------------------------

  /**
   * Create a project from a registered template and persist + activate it.
   *
   * Lifecycle (Phase F):
   *   1. flush current dirty project (blocked if flush fails)
   *   2. build the template project in memory (pure factory — never saves)
   *   3. persist the new project
   *   4. set it as active
   *   5. hydrate the Zustand store, start a fresh autosave coordinator
   *   6. return the new projectId — navigation happens only on success
   *
   * On any failure the current active project is left untouched.
   */
  async createProjectFromTemplate(request: {
    templateId: string;
    projectName: string;
  }): Promise<ProjectTransitionResult<{ projectId: string }>> {
    // Default templates must be registered exactly once (idempotent).
    registerDefaultTemplates();

    // Phase P9: personal templates are stored locally and build a fresh
    // Project with brand-new IDs. Deployments/domains/sync state are never
    // copied (they live outside ProjectSchema).
    const personal = await this._createFromPersonalTemplateIfApplicable(
      request.templateId,
      request.projectName,
    );
    if (personal) return personal;

    // Build the project in memory FIRST — pure and deterministic, never
    // touches persistence. Any factory failure (TEMPLATE_NOT_FOUND,
    // INVALID_PROJECT_NAME, TEMPLATE_VALIDATION_FAILED, …) returns before
    // _prepareForProjectTransition, so the current active project's autosave
    // coordinator and store subscription are never torn down. This guarantees
    // no partial active-state changes on failure.
    const factory = new TemplateProjectFactory();
    const created = factory.createProjectFromTemplate({
      templateId: request.templateId,
      projectName: request.projectName,
    });
    if (!created.ok) {
      // Surface the structured template error (TEMPLATE_NOT_FOUND,
      // INVALID_PROJECT_NAME, …) through the transition result so callers can
      // distinguish cause without exposing a raw stack trace.
      return {
        success: false,
        code: "PROJECT_CREATE_FAILED",
        error: {
          code: "UNKNOWN_PERSISTENCE_ERROR",
          message: created.error.message,
          cause: created.error.code,
          retryable: created.error.code === "TEMPLATE_NOT_FOUND" ? false : true,
        },
      };
    }

    const prep = await this._prepareForProjectTransition();
    if (!prep.success) return prep as ProjectTransitionResult<{ projectId: string }>;

    const project = created.project;
    const revision = INITIAL_REVISION;

    return this._runTransition<{ projectId: string }>(async () => {
      // Persist the new project first
      const saveResult = await this.adapter.saveProject({ project, revision });
      if (!saveResult.success) {
        return { success: false, code: "PROJECT_CREATE_FAILED", error: saveResult.error };
      }

      // Set as active — failure must not hydrate the store
      const activeResult = await this.adapter.setActiveProjectId(project.id);
      if (!activeResult.success) {
        return { success: false, code: "ACTIVE_PROJECT_UPDATE_FAILED", error: activeResult.error };
      }

      this._suppressNextDirty = true;
      useEditorStore.getState().hydrateProject(project, revision);
      useEditorStore.getState().setLastSavedAt(revision === 1 ? new Date().toISOString() : null);

      this._createCoordinator();
      this._subscribeCoordinator();
      this._subscribeStore();

      this._hydrated = true;
      // Template-based creation: schedule after the first successful persisted save.
      this._scheduleThumbnailAfterSave();
      return { success: true, data: { projectId: project.id } };
    });
  }

  /**
   * Phase P9 — resolve a personal-template creation request to the same
   * persist + activate lifecycle as built-ins. Returns null when the
   * templateId is not a personal template.
   */
  private async _createFromPersonalTemplateIfApplicable(
    templateId: string,
    projectName: string,
  ): Promise<ProjectTransitionResult<{ projectId: string }> | null> {
    if (!templateId.startsWith("personal-")) return null;

    const prep = await this._prepareForProjectTransition();
    if (!prep.success) return prep as ProjectTransitionResult<{ projectId: string }>;

    let project: Project;
    try {
      const { getPersonalTemplateService } = await import(
        "@/features/personal-templates/services/personal-template-service"
      );
      const created = await getPersonalTemplateService().createProjectFromPersonalTemplate(
        templateId,
        projectName,
      );
      if (!created.ok) {
        return {
          success: false,
          code: "PROJECT_CREATE_FAILED",
          error: {
            code: "UNKNOWN_PERSISTENCE_ERROR",
            message: created.error.message,
            cause: created.error.code,
            retryable: created.error.code === "PERSONAL_TEMPLATE_NOT_FOUND" ? false : true,
          },
        };
      }
      project = created.project;
    } catch (err) {
      return {
        success: false,
        code: "PROJECT_CREATE_FAILED",
        error: {
          code: "UNKNOWN_PERSISTENCE_ERROR",
          message: "This template could not be used.",
          cause: err instanceof Error ? err.message : String(err),
        },
      };
    }

    const revision = INITIAL_REVISION;
    return this._runTransition<{ projectId: string }>(async () => {
      const saveResult = await this.adapter.saveProject({ project, revision });
      if (!saveResult.success) {
        return { success: false, code: "PROJECT_CREATE_FAILED", error: saveResult.error };
      }

      const activeResult = await this.adapter.setActiveProjectId(project.id);
      if (!activeResult.success) {
        return { success: false, code: "ACTIVE_PROJECT_UPDATE_FAILED", error: activeResult.error };
      }

      this._suppressNextDirty = true;
      useEditorStore.getState().hydrateProject(project, revision);
      useEditorStore.getState().setLastSavedAt(revision === 1 ? new Date().toISOString() : null);

      this._createCoordinator();
      this._subscribeCoordinator();
      this._subscribeStore();

      this._hydrated = true;
      this._scheduleThumbnailAfterSave();
      return { success: true, data: { projectId: project.id } };
    });
  }

  // -----------------------------------------------------------------------
  // Open Project
  // -----------------------------------------------------------------------

  /**
   * Open an existing project from persistence.
   * Blocks if the current dirty project cannot be flushed first.
   */
  async openProject(projectId: string): Promise<ProjectTransitionResult> {
    const prep = await this._prepareForProjectTransition();
    if (!prep.success) return prep;

    return this._runTransition(async () => {
      const result = await this.adapter.loadProject(projectId);

      if (!result.success) {
        useEditorStore.getState().setPersistenceError(result.error);
        useEditorStore.getState().setSaveStatus("error");
        return transitionError("PROJECT_LOAD_FAILED", result.error, projectId);
      }

      // Hydrate the editor store with the loaded project
      this._suppressNextDirty = true;
      useEditorStore.getState().hydrateProject(result.project, result.revision);
      useEditorStore.getState().setLastSavedAt(result.savedAt);

      // Phase P9 — transient performance measurement (block count is a safe
      // deterministic operation count; never wall-clock-asserted in tests).
      try {
        recordPerf("editor-hydration", 0, {
          count: result.project.pages.reduce(
            (n, p) => n + p.sections.length,
            0,
          ),
          detail: "open-project",
        });
      } catch {
        // Instrumentation is best-effort.
      }

      // Start fresh coordinator
      this._createCoordinator();
      this._subscribeCoordinator();
      this._subscribeStore();

      this._hydrated = true;
      return { success: true };
    });
  }

  // -----------------------------------------------------------------------
  // Switch Project
  // -----------------------------------------------------------------------

  /**
   * Switch between projects — flush current, load new, resume autosave.
   * Blocks if the current dirty project cannot be flushed first.
   */
  async switchProject(projectId: string): Promise<ProjectTransitionResult> {
    return this.openProject(projectId);
  }

  // -----------------------------------------------------------------------
  // List projects
  // -----------------------------------------------------------------------

  /**
   * List all stored project summaries (lightweight, no full deserialization).
   */
  async listProjects(): Promise<ProjectSummaryResult> {
    return this.adapter.listProjects();
  }

  // -----------------------------------------------------------------------
  // Rename active project
  // -----------------------------------------------------------------------

  /**
   * Rename the currently active project through the full controller lifecycle.
   *
   * - Validates using the canonical validateProjectName()
   * - Updates the Zustand project reference
   * - Increments revision exactly once
   * - Marks dirty
   * - Schedules autosave
   *
   * For inactive project renames, use ProjectService directly.
   */
  async renameActiveProject(newName: string): Promise<ProjectTransitionResult<{ name: string }>> {
    const store = useEditorStore.getState();
    const project = store.project;

    if (!project || !project.id) {
      return { success: false, code: "PROJECT_LOAD_FAILED", error: { code: "PROJECT_NOT_FOUND", message: "No active project to rename." } };
    }

    // Use the canonical shared validator
    const validation = validateProjectName(newName);
    if (!validation.valid) {
      return {
        success: false,
        code: "PROJECT_LOAD_FAILED",
        error: { code: "INVALID_PROJECT_NAME", message: validation.error! },
      };
    }

    const trimmed = validation.valid ? newName.trim() : "";

    // Update the live project in Zustand (this triggers the store subscription
    // which increments revision, marks dirty, and schedules autosave)
    const updatedProject = {
      ...project,
      name: trimmed,
      updatedAt: new Date().toISOString(),
    };

    store.setProject(updatedProject);

    return { success: true, data: { name: trimmed } };
  }

  // -----------------------------------------------------------------------
  // Discard and open
  // -----------------------------------------------------------------------

  /**
   * Open a project discarding unsaved changes.
   *
   * This is an explicit opt-in flow for abandoning unsaved edits.
   * The current dirty project is NOT flushed — in-memory edits are
   * intentionally abandoned. The old coordinator is disposed.
   *
   * Must be explicitly called — never automatic.
   */
  async discardAndOpenProject(projectId: string): Promise<ProjectTransitionResult> {
    const result = await this.adapter.loadProject(projectId);
    if (!result.success) {
      useEditorStore.getState().setPersistenceError(result.error);
      useEditorStore.getState().setSaveStatus("error");
      return transitionError("PROJECT_LOAD_FAILED", result.error, projectId);
    }

    // Discard current state — clean up coordinator and store subscription
    this._cleanupCoordinator();
    this._unsubscribeStore();

    // Hydrate with the target project (discards unsaved edits)
    this._suppressNextDirty = true;
    useEditorStore.getState().hydrateProject(result.project, result.revision);
    useEditorStore.getState().setLastSavedAt(result.savedAt);

    // Start fresh coordinator
    this._createCoordinator();
    this._subscribeCoordinator();
    this._subscribeStore();

    this._hydrated = true;
    return { success: true };
  }

  // -----------------------------------------------------------------------
  // Save
  // -----------------------------------------------------------------------

  /**
   * Manual save — flush the autosave coordinator immediately.
   */
  async saveNow(): Promise<{ success: boolean; savedAt?: string; error?: PersistenceError }> {
    if (!this.coordinator) {
      return { success: true };
    }

    try {
      const result = await this.coordinator.flush();
      if (result.success) {
        // Use revision-aware save: only mark saved when coordinator confirms
        // the persisted revision caught up with the store revision.
        const cState = this.coordinator.getState();
        const store = useEditorStore.getState();
        if (
          cState.lastSuccessfullySavedRevision !== null &&
          cState.lastSuccessfullySavedRevision >= store.revision
        ) {
          store.markSaved(result.savedAt);
        } else {
          store.setSaveStatus("unsaved");
        }
      } else {
        useEditorStore.getState().setPersistenceError(result.error);
        useEditorStore.getState().setSaveStatus("error");
      }
      return result;
    } catch (err) {
      const error = toControllerError(err);
      useEditorStore.getState().setPersistenceError(error);
      useEditorStore.getState().setSaveStatus("error");
      return { success: false, error };
    }
  }

  // -----------------------------------------------------------------------
  // Delete Project
  // -----------------------------------------------------------------------

  /**
   * Delete a project from storage.
   *
   * SAFE ORDER for active project:
   *   1. flush current project (blocked if it fails)
   *   2. create and persist replacement project
   *   3. set replacement as active
   *   4. remove old project
   *   5. hydrate replacement
   *
   * This guarantees the application always has a recoverable active project,
   * even if the delete itself fails midway.
   */
  async deleteProject(projectId: string): Promise<ProjectTransitionResult> {
    const store = useEditorStore.getState();
    const isActive = projectId === store.activeProjectId;

    if (!isActive) {
      // Non-active project — just remove it
      try {
        const result = await this.adapter.removeProject(projectId);
        if (!result.success) {
          useEditorStore.getState().setPersistenceError(result.error);
          return transitionError("PROJECT_DELETE_FAILED", result.error, projectId);
        }
        // Non-blocking thumbnail cleanup — must never block the delete or
        // make a deleted project reappear.
        removeThumbnailForProject(projectId);
        // Phase P11 — best-effort removal of the project's Copilot memory.
        void lazyCopilotMemoryCleanup(projectId);
        return { success: true };
      } catch (err) {
        const error = toControllerError(err, projectId);
        useEditorStore.getState().setPersistenceError(error);
        return transitionError("PROJECT_DELETE_FAILED", error, projectId);
      }
    }

    // --- Active project: safe order ---
    const prep = await this._prepareForProjectTransition();
    if (!prep.success) return prep;

    return this._runTransition(async () => {
      // Step 1: Create replacement project first
      const replacement = this._generateBlankProject();
      const replaceRevision = INITIAL_REVISION;

      const saveResult = await this.adapter.saveProject({
        project: replacement,
        revision: replaceRevision,
      });
      if (!saveResult.success) {
        return transitionError("PROJECT_CREATE_FAILED", saveResult.error);
      }

      const activeResult = await this.adapter.setActiveProjectId(replacement.id);
      if (!activeResult.success) {
        return transitionError("ACTIVE_PROJECT_UPDATE_FAILED", activeResult.error, replacement.id);
      }

      // Step 2: Now safe to remove the old project
      const removeResult = await this.adapter.removeProject(projectId);
      if (!removeResult.success) {
        // Replacement is active but old project removal failed — log the error
        // but don't block the UI since the replacement is already active
        useEditorStore.getState().setPersistenceError(removeResult.error);
      } else {
        // Non-blocking thumbnail cleanup for the deleted project.
        removeThumbnailForProject(projectId);
        // Phase P11 — best-effort removal of the project's Copilot memory.
        void lazyCopilotMemoryCleanup(projectId);
      }

      // Step 3: Hydrate the replacement
      this._suppressNextDirty = true;
      useEditorStore.getState().hydrateProject(replacement, replaceRevision);
      useEditorStore.getState().setLastSavedAt(new Date().toISOString());

      this._createCoordinator();
      this._subscribeCoordinator();
      this._subscribeStore();
      this._hydrated = true;

      return { success: true };
    });
  }

  // -----------------------------------------------------------------------
  // Retry Save
  // -----------------------------------------------------------------------

  /**
   * Retry a failed save operation. The current dirty project is preserved.
   */
  async retrySave(): Promise<void> {
    const store = useEditorStore.getState();

    if (this.coordinator && store.project.id) {
      this.coordinator.schedule({
        project: store.project,
        projectId: store.project.id,
        revision: store.revision,
      });
      await this.saveNow();
    } else if (store.project.id) {
      try {
        const result = await this.adapter.saveProject({
          project: store.project,
          revision: store.revision,
        });
        if (result.success) {
          useEditorStore.getState().markSaved();
          useEditorStore.getState().setRevision(result.revision);
        } else {
          useEditorStore.getState().setPersistenceError(result.error);
          useEditorStore.getState().setSaveStatus("error");
        }
      } catch (err) {
        const error = toControllerError(err, store.project.id);
        useEditorStore.getState().setPersistenceError(error);
        useEditorStore.getState().setSaveStatus("error");
      }
    }
  }

  // -----------------------------------------------------------------------
  // Shutdown
  // -----------------------------------------------------------------------

  /**
   * Shutdown the controller — dispose coordinator, unsubscribe store.
   * Flushes the current project if dirty. If flush fails, disposal
   * still proceeds (the app is shutting down).
   */
  async shutdown(): Promise<void> {
    if (this.coordinator) {
      try {
        await this.coordinator.flush();
      } catch {
        // App is shutting down — swallow flush errors
      }
    }
    this._cleanupCoordinator();
    this._unsubscribeStore();
    this.adapter.close();
    this._hydrated = false;
  }

  // -----------------------------------------------------------------------
  // Internal — Project transition helpers
  // -----------------------------------------------------------------------

  /**
   * Prepare for a project transition by flushing the current dirty project.
   *
   * - If dirty → flush is required; blocks transition if flush fails
   * - If saving → await completion first
   * - If clean → dispose directly
   * - On failure → preserve current state, return SAVE_BEFORE_TRANSITION_FAILED
   */
  private async _prepareForProjectTransition(): Promise<ProjectTransitionResult> {
    if (this._transitioning) {
      return {
        success: false,
        code: "TRANSITION_IN_PROGRESS",
      };
    }

    if (!this.coordinator) {
      // No coordinator yet — nothing to flush
      return { success: true };
    }

    const store = useEditorStore.getState();

    // Clean project — just dispose directly
    if (!store.isDirty) {
      this._cleanupCoordinator();
      this._unsubscribeStore();
      return { success: true };
    }

    // Dirty or saving — must flush before transition
    try {
      const result = await this.coordinator.flush();
      if (!result.success) {
        // Flush failed — preserve current state
        useEditorStore.getState().setPersistenceError(result.error);
        useEditorStore.getState().setSaveStatus("error");
        return {
          success: false,
          code: "SAVE_BEFORE_TRANSITION_FAILED",
          error: result.error,
        };
      }
      // Flush succeeded — cleanup
      this._cleanupCoordinator();
      this._unsubscribeStore();
      return { success: true };
    } catch (err) {
      const error = toControllerError(err);
      useEditorStore.getState().setPersistenceError(error);
      useEditorStore.getState().setSaveStatus("error");
      return {
        success: false,
        code: "SAVE_BEFORE_TRANSITION_FAILED",
        error,
      };
    }
  }

  /**
   * Run a transition callback inside the serialization guard.
   * Prevents overlapping transitions.
   */
  private async _runTransition<T>(
    fn: () => Promise<ProjectTransitionResult<T>>,
  ): Promise<ProjectTransitionResult<T>> {
    if (this.transitionPromise) {
      await this.transitionPromise;
      return {
        success: false,
        code: "TRANSITION_IN_PROGRESS",
      } as ProjectTransitionResult<T>;
    }

    this._transitioning = true;

    const promise = fn().finally(() => {
      this._transitioning = false;
      this.transitionPromise = null;
    });

    this.transitionPromise = promise;
    return promise;
  }

  // -----------------------------------------------------------------------
  // Internal — Coordinator lifecycle
  // -----------------------------------------------------------------------

  private _createCoordinator(): void {
    this._cleanupCoordinator();
    this.coordinator = new AutosaveCoordinator(this.adapter, {
      debounceMs: AUTOSAVE_DEBOUNCE_MS,
    });
  }

  private _subscribeCoordinator(): void {
    if (!this.coordinator) return;

    // Clean up any previous subscription
    if (this.coordinatorUnsub) {
      this.coordinatorUnsub();
      this.coordinatorUnsub = null;
    }

    this.coordinatorUnsub = this.coordinator.subscribe((state: AutosaveState) => {
      const store = useEditorStore.getState();

      switch (state.status) {
        case "saving":
          store.setSaveStatus("saving");
          break;
        case "saved": {
          // Revision-aware save: only mark saved when the coordinator confirms
          // that the highest saved revision is >= the store's revision.
          if (
            state.lastSuccessfullySavedRevision !== null &&
            state.lastSuccessfullySavedRevision >= store.revision &&
            state.projectId === store.activeProjectId
          ) {
            store.markSaved();
            // Autosave/manual-save success → schedule thumbnail generation
            // (non-blocking; a thumbnail failure never changes saveStatus).
            this._scheduleThumbnailAfterSave();
            this._scheduleRecoveryAfterSave();
          }
          break;
        }
        case "error":
          store.setPersistenceError(state.error ?? null);
          store.setSaveStatus("error");
          break;
        case "unsaved":
          store.setDirty(true);
          break;
        case "idle":
          if (store.saveStatus === "saving" || store.saveStatus === "unsaved") {
            store.setSaveStatus("idle");
          }
          break;
      }
    });
  }

  private _cleanupCoordinator(): void {
    if (this.coordinatorUnsub) {
      this.coordinatorUnsub();
      this.coordinatorUnsub = null;
    }
    if (this.coordinator) {
      this.coordinator.dispose();
      this.coordinator = null;
    }
  }

  // -----------------------------------------------------------------------
  // Internal — Store subscription
  // -----------------------------------------------------------------------

  private _subscribeStore(): void {
    this._unsubscribeStore();

    // Track the previous project reference for change detection
    let previousProject = useEditorStore.getState().project;

    this.unsubStore = useEditorStore.subscribe((state) => {
      const project = state.project;
      if (project === previousProject) return;
      previousProject = project;

      if (!this._hydrated) return;

      if (this._suppressNextDirty) {
        this._suppressNextDirty = false;
        return;
      }

      // Project changed — increment revision and schedule autosave
      const store = useEditorStore.getState();
      const newRevision = store.revision + 1;
      store.setRevision(newRevision);

      if (!store.isDirty && store.project.id) {
        store.setDirty(true);
      }

      if (this.coordinator && store.project.id) {
        this.coordinator.schedule({
          project: store.project,
          projectId: store.project.id,
          revision: newRevision,
        });
      }
    });

    // Reset suppress flag: any pending suppress was set before this subscription
    // was registered, and the hydration's set() has already fired.
    this._suppressNextDirty = false;
  }

  private _unsubscribeStore(): void {
    if (this.unsubStore) {
      this.unsubStore();
      this.unsubStore = null;
    }
  }

  // -----------------------------------------------------------------------
  // Internal — Hydration & project creation
  // -----------------------------------------------------------------------

  private _createBlankProject(): void {
    const project = this._generateBlankProject();
    this._suppressNextDirty = true;
    useEditorStore.getState().hydrateProject(project, 0);
    useEditorStore.getState().setSaveStatus("idle");
  }

  private _generateBlankProject(): Project {
    const now = new Date().toISOString();
    return {
      id: generateProjectId(),
      name: "Untitled Project",
      theme: createDefaultTheme(),
      pages: [
        {
          id: generateProjectId(),
          title: "Home",
          slug: "/",
          sections: [],
        },
      ],
      assets: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  private async _hydrateExistingProject(projectId: string): Promise<void> {
    const start = performance.now();
    const result = await this.adapter.loadProject(projectId);
    try {
      recordPerf("editor-hydration", performance.now() - start, {
        count: result.success
          ? result.project.pages.reduce((n, p) => n + p.sections.length, 0)
          : 0,
        detail: "initial-hydrate",
      });
    } catch {
      // Instrumentation is best-effort.
    }

    if (!result.success) {
      // If the project doesn't exist in storage, create a fresh one
      await this._createFreshProject();
      // Set hydration error AFTER fresh project (hydrateProject resets it)
      useEditorStore.getState().setHydrationError(result.error);
      return;
    }

    this._suppressNextDirty = true;
    useEditorStore.getState().hydrateProject(result.project, result.revision);
    // Use adapter-provided savedAt timestamp
    useEditorStore.getState().setLastSavedAt(result.savedAt);

    this._createCoordinator();
    this._subscribeCoordinator();
    this._subscribeStore();

    this._hydrated = true;
    useEditorStore.getState().setSaveStatus("saved");
  }

  private async _createFreshProject(): Promise<void> {
    const project = this._generateBlankProject();
    const revision = INITIAL_REVISION;

    await this.adapter.saveProject({ project, revision });
    await this.adapter.setActiveProjectId(project.id);

    this._suppressNextDirty = true;
    useEditorStore.getState().hydrateProject(project, revision);

    this._createCoordinator();
    this._subscribeCoordinator();
    this._subscribeStore();

    this._hydrated = true;
  }

  // -----------------------------------------------------------------------
  // Exposed for testing
  // -----------------------------------------------------------------------

  getCoordinator(): AutosaveCoordinatorInterface | null {
    return this.coordinator;
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor
// ---------------------------------------------------------------------------

let _controllerInstance: ProjectController | null = null;

export function getProjectController(): ProjectController | null {
  return _controllerInstance;
}

export function setProjectController(controller: ProjectController): void {
  _controllerInstance = controller;
}

/** Convenience: flush the coordinator on the active controller. */
export async function saveNowViaController(): Promise<{ success: boolean; error?: PersistenceError }> {
  const ctrl = _controllerInstance;
  if (!ctrl) return { success: false, error: { code: "UNKNOWN_PERSISTENCE_ERROR", message: "Controller not initialized" } };
  return ctrl.saveNow();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let projectIdCounter = 0;

function generateProjectId(): string {
  projectIdCounter++;
  return `proj-${Date.now()}-${projectIdCounter}`;
}

function createDefaultTheme() {
  return {
    palette: {
      background: "#ffffff",
      foreground: "#0a0a0a",
      primary: "#7c5cfc",
      primaryForeground: "#ffffff",
      secondary: "#f5f5f5",
      secondaryForeground: "#0a0a0a",
      muted: "#f5f5f5",
      mutedForeground: "#737373",
      accent: "#7c5cfc",
      accentForeground: "#ffffff",
      border: "#e5e5e5",
      card: "#ffffff",
      cardForeground: "#000000",
    },
    typography: {
      fontFamily: "Geist, system-ui, sans-serif",
      headingFont: "Geist, system-ui, sans-serif",
      baseSize: "16px",
      scale: 1.25,
    },
    spacing: {
      sectionPadding: "6rem 0",
      containerMaxWidth: "1120px",
      gap: "1.5rem",
    },
    radius: {
      sm: "0.375rem",
      md: "0.5rem",
      lg: "0.75rem",
      xl: "1rem",
      full: "9999px",
    },
    shadows: {
      sm: "0 1px 2px rgba(0,0,0,0.05)",
      md: "0 4px 6px rgba(0,0,0,0.07)",
      lg: "0 10px 15px rgba(0,0,0,0.1)",
      xl: "0 20px 25px rgba(0,0,0,0.15)",
    },
  };
}

function toControllerError(
  err: unknown,
  _projectId?: string,
): PersistenceError {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    return err as PersistenceError;
  }
  return {
    code: "UNKNOWN_PERSISTENCE_ERROR",
    message: err instanceof Error ? err.message : String(err),
    projectId: _projectId,
  };
}

function transitionError(
  code: Extract<ProjectTransitionResult, { success: false }>["code"],
  error?: PersistenceError,
  _projectId?: string,
): ProjectTransitionResult {
  return {
    success: false,
    code,
    error: error ?? { code: "UNKNOWN_PERSISTENCE_ERROR", message: "Unknown error", projectId: _projectId },
  };
}
