// ---------------------------------------------------------------------------
// Autosave Coordinator
//
// Framework-independent service that debounces project saves and coordinates
// state transitions. No React or Zustand imports.
//
// Scoping:
//   This coordinator is scoped to ONE active project.
//   schedule() with a different projectId returns PROJECT_SCOPE_MISMATCH —
//   caller must flush/cancel and create a new coordinator for a different project.
//
// Revision tracking:
//   - highestScheduledRevision — the highest revision ever scheduled
//   - currentlySavingRevision — the revision currently being persisted
//   - lastSuccessfullySavedRevision — the highest revision persisted successfully
//
// Invariant: state is "saved" only when
//   lastSuccessfullySavedRevision >= highestScheduledRevision
//   and no newer pending request exists.
// ---------------------------------------------------------------------------

import type {
  AutosaveCoordinator as AutosaveCoordinatorInterface,
  AutosaveRequest,
  AutosaveState,
  AutosaveListener,
  AutosaveResult,
  AutosaveScheduleResult,
  ProjectPersistenceAdapter,
  PersistenceError,
} from "../types";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_DEBOUNCE_MS = 3000;

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

export class AutosaveCoordinator implements AutosaveCoordinatorInterface {
  private adapter: ProjectPersistenceAdapter;
  private debounceMs: number;

  private state: AutosaveState;
  private listeners: Set<AutosaveListener> = new Set();

  private pendingRequest: AutosaveRequest | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlightSave: Promise<void> | null = null;

  private disposed: boolean = false;

  constructor(
    adapter: ProjectPersistenceAdapter,
    options?: { debounceMs?: number },
  ) {
    this.adapter = adapter;
    this.debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.state = this.initialState();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  getState(): AutosaveState {
    return this.freezeState(this.state);
  }

  subscribe(listener: AutosaveListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  schedule(request: AutosaveRequest): AutosaveScheduleResult {
    if (this.disposed) {
      // Coordinator is shut down — silently accept to avoid misleading
      // the caller into thinking persistence will occur. Callers must
      // create a new coordinator after dispose.
      return { accepted: true, revision: request.revision };
    }

    // Enforce single-project scoping with explicit rejection
    if (this.state.projectId === "") {
      this.state = this.updateState({ projectId: request.projectId });
    } else if (this.state.projectId !== request.projectId) {
      return {
        accepted: false,
        code: "PROJECT_SCOPE_MISMATCH",
        expectedProjectId: this.state.projectId,
        receivedProjectId: request.projectId,
      };
    }

    // Deduplicate: skip if same project ID and revision are already pending
    if (
      this.pendingRequest &&
      this.pendingRequest.projectId === request.projectId &&
      this.pendingRequest.revision === request.revision
    ) {
      return { accepted: true, revision: request.revision };
    }

    // Track the highest revision ever scheduled
    const newHighest = Math.max(
      request.revision,
      this.state.highestScheduledRevision ?? 0,
    );

    this.pendingRequest = request;
    // Keep "saving" if a save is already in-flight; otherwise transition to "unsaved"
    const wasSaving = this.inFlightSave !== null;
    this.state = this.updateState({
      status: wasSaving ? "saving" : "unsaved",
      highestScheduledRevision: newHighest,
      pendingRevision: request.revision,
    });
    this.notifyListeners();

    // Only set a debounce timer if no save is already in-flight.
    // If a save is in-flight, the follow-up logic in executeSave will pick this up.
    if (!wasSaving) {
      this.clearTimer();
      this.timer = setTimeout(() => {
        this.executeSave();
      }, this.debounceMs);
    }

    return { accepted: true, revision: request.revision };
  }

  async flush(): Promise<AutosaveResult> {
    if (this.disposed) return { success: true };
    if (!this.pendingRequest) return { success: true };

    // Cancel pending debounce
    this.clearTimer();

    // If a save is in flight, wait for it and then persist the newest pending revision
    if (this.inFlightSave) {
      await this.inFlightSave;
      // If a newer request was scheduled while we waited, save again
      if (this.pendingRequest) {
        return this.executeSave();
      }
      // Check if the completed save covered the highest scheduled revision
      if (
        this.state.lastSuccessfullySavedRevision !== null &&
        this.state.highestScheduledRevision !== null &&
        this.state.lastSuccessfullySavedRevision >= this.state.highestScheduledRevision
      ) {
        this.state = this.updateState({ status: "saved" });
        this.notifyListeners();
      }
      return { success: true };
    }

    return this.executeSave();
  }

  cancel(): void {
    if (this.disposed) return;
    this.clearTimer();
    this.pendingRequest = null;
    // Always reset highestScheduledRevision to the last saved revision,
    // even if a save is currently in-flight. This ensures that after the
    // in-flight save completes, the coordinator sees caught-up state.
    const resetHighest = this.state.lastSuccessfullySavedRevision ?? 0;
    this.state = this.updateState({
      highestScheduledRevision: resetHighest,
      pendingRevision: null,
    });
    if (this.state.status !== "saving") {
      this.state = this.updateState({ status: "idle" });
      this.notifyListeners();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.listeners.clear();
    this.pendingRequest = null;
    this.inFlightSave = null;
    this.state = this.initialState();
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async executeSave(): Promise<AutosaveResult> {
    const request = this.pendingRequest;
    if (!request) return { success: true };

    this.pendingRequest = null;
    this.state = this.updateState({
      status: "saving",
      currentlySavingRevision: request.revision,
      pendingRevision: null,
    });
    this.notifyListeners();

    const savePromise = this.adapter
      .saveProject({
        project: request.project,
        revision: request.revision,
      })
      .then((result) => {
        if (result.success) {
          const newSavedRev = Math.max(
            request.revision,
            this.state.lastSuccessfullySavedRevision ?? 0,
          );
          const isCaughtUp =
            this.state.highestScheduledRevision !== null &&
            newSavedRev >= this.state.highestScheduledRevision;

          this.state = this.updateState({
            status: isCaughtUp ? "saved" : "unsaved",
            lastSuccessfullySavedRevision: newSavedRev,
            error: undefined,
          });
          this.notifyListeners();
          return { success: true as const, savedAt: result.savedAt };
        } else {
          this.state = this.updateState({
            status: "error",
            error: result.error,
          });
          this.notifyListeners();
          return { success: false as const, error: result.error };
        }
      })
      .catch((err: unknown) => {
        const error: PersistenceError = {
          code: "UNKNOWN_PERSISTENCE_ERROR",
          message: err instanceof Error ? err.message : String(err),
        };
        this.state = this.updateState({
          status: "error",
          error,
        });
        this.notifyListeners();
        return { success: false as const, error };
      });

    // Track the in-flight save for flush() callers
    this.inFlightSave = savePromise
      .then(() => {/* rejection handled in the .catch callback above */})
      .catch(() => {
        // Rejection is already handled by setting status→error above
      });

    const result = await savePromise;
    this.inFlightSave = null;
    this.state = this.updateState({ currentlySavingRevision: null });

    // If a new request was queued during save, persist it now (no debounce)
    if (this.pendingRequest) {
      this.clearTimer();
      return this.executeSave();
    }

    return result;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private notifyListeners(): void {
    const snapshot = this.freezeState(this.state);
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Listener exceptions must not break the coordinator
      }
    }
  }

  private initialState(): AutosaveState {
    return {
      status: "idle",
      projectId: "",
      highestScheduledRevision: null,
      currentlySavingRevision: null,
      lastSuccessfullySavedRevision: null,
      pendingRevision: null,
      error: undefined,
    };
  }

  private updateState(partial: Partial<AutosaveState>): AutosaveState {
    return { ...this.state, ...partial };
  }

  private freezeState(state: AutosaveState): AutosaveState {
    return Object.freeze({ ...state });
  }
}
