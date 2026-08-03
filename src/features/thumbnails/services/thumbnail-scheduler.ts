// ---------------------------------------------------------------------------
// ThumbnailScheduler
//
// Framework-independent scheduler that debounces thumbnail generation after
// successful project saves. No React, no Zustand.
//
// Behavior:
//   - debounces after each schedule() (default THUMBNAIL_DEBOUNCE_MS)
//   - latest revision wins for a project
//   - one project generation at a time (serialized pipeline)
//   - a stale generation result (revision overtaken while rendering) is
//     dropped — never persisted, never notified as "ready"
//   - persistence happens through the injected storage adapter which also
//     enforces atomic stale-write protection
//   - generation errors are non-blocking and retryable
//   - cancel() removes pending work; dispose() prevents UI notifications
//
// Public state is returned as immutable snapshots.
// ---------------------------------------------------------------------------

import { THUMBNAIL_DEBOUNCE_MS } from "../constants";
import type {
  GenerateThumbnailResult,
  ProjectThumbnailStorageAdapter,
  ThumbnailError,
} from "../types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ThumbnailSchedulerPhase =
  | "idle"
  | "queued"
  | "rendering"
  | "saving"
  | "ready"
  | "error";

export interface ThumbnailScheduleRequest {
  project: import("@/types/project").Project;
  projectId: string;
  revision: number;
}

export interface ThumbnailSchedulerState {
  phase: ThumbnailSchedulerPhase;
  /** Project currently being processed (or last processed). */
  projectId: string | null;
  /** Revision of the in-flight/latest scheduled request. */
  revision: number | null;
  /** Revision of the last successfully persisted thumbnail. */
  lastCompletedRevision: number | null;
  /** Non-blocking error surfaced to subscribers (last error). */
  error?: ThumbnailError;
}

export interface ThumbnailScheduleResult {
  success: boolean;
  projectId?: string;
  revision?: number;
  error?: ThumbnailError;
}

export type ThumbnailSchedulerListener = (state: ThumbnailSchedulerState) => void;

/**
 * Completion notification payload. Published ONLY after the storage write
 * transaction has fully committed, so the record is guaranteed readable from
 * a separate connection when a subscriber acts on it.
 */
export interface ThumbnailReadyInfo {
  projectId: string;
  revision: number;
}

export type ThumbnailReadyListener = (info: ThumbnailReadyInfo) => void;

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export class ThumbnailScheduler {
  private storage: ProjectThumbnailStorageAdapter;
  private generate: (request: ThumbnailScheduleRequest) => Promise<GenerateThumbnailResult>;
  private debounceMs: number;
  private now: () => string;

  private state: ThumbnailSchedulerState;
  private listeners: Set<ThumbnailSchedulerListener> = new Set();
  private readyListeners: Set<ThumbnailReadyListener> = new Set();

  private pending: Map<string, ThumbnailScheduleRequest> = new Map();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  /** Project whose generation is currently running (not overwritten by newer schedules). */
  private inFlightProjectId: string | null = null;
  private disposed = false;

  /**
   * Projects cancelled while work was in-flight (e.g. project deleted). An
   * in-flight generation for a cancelled project must never persist its
   * result — otherwise a deleted project's thumbnail could reappear.
   */
  private cancelled = new Set<string>();

  constructor(options: {
    storage: ProjectThumbnailStorageAdapter;
    generate: (request: ThumbnailScheduleRequest) => Promise<GenerateThumbnailResult>;
    debounceMs?: number;
    now?: () => string;
  }) {
    this.storage = options.storage;
    this.generate = options.generate;
    this.debounceMs = options.debounceMs ?? THUMBNAIL_DEBOUNCE_MS;
    this.now = options.now ?? (() => new Date().toISOString());
    this.state = this.initialState();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  getState(): ThumbnailSchedulerState {
    return this.freezeState(this.state);
  }

  subscribe(listener: ThumbnailSchedulerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Subscribe to thumbnail-completion notifications.
   *
   * The listener fires with { projectId, revision } ONLY after a genuine new
   * thumbnail write has committed to storage (the adapter resolves
   * saveThumbnail on tx.oncomplete). It does NOT fire for:
   *   - generation/save failures (never a ready state)
   *   - STALE_REVISION rejections (a newer record already exists — the
   *     dashboard's own read path already finds it)
   *   - deduplicated saves (the identical record already existed)
   *   - superseded/stale results that were dropped
   *
   * Returns an unsubscribe function. Safe when disposed (no-ops).
   */
  subscribeReady(listener: ThumbnailReadyListener): () => void {
    this.readyListeners.add(listener);
    return () => {
      this.readyListeners.delete(listener);
    };
  }

  /**
   * Schedule thumbnail generation for a project after a successful save.
   * Latest revision wins per project. Debounced.
   */
  schedule(request: ThumbnailScheduleRequest): void {
    if (this.disposed) return;
    if (!request.project || !request.projectId) return;

    // A fresh schedule un-cancels the project (e.g. the same project is saved
    // again after a delete-cancel that did not actually complete).
    this.cancelled.delete(request.projectId);

    const existing = this.pending.get(request.projectId);
    if (existing && existing.revision > request.revision) {
      // An older revision cannot replace a newer pending request.
      return;
    }

    this.pending.set(request.projectId, request);
    this.setState({
      phase: "queued",
      projectId: request.projectId,
      revision: request.revision,
    });

    // Debounce: reset the timer on every new schedule.
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, this.debounceMs);
  }

  /**
   * Force an immediate drain of all pending work. Resolves when the pipeline
   * has fully settled (including persistence).
   */
  async flush(): Promise<ThumbnailScheduleResult> {
    if (this.disposed) return { success: true };

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // If a drain is already in flight, wait for it and then ensure any
    // remaining pending requests are processed too.
    await this.drain();
    return this.currentResult();
  }

  /**
   * Cancel pending work for one project, or all projects when projectId is
   * omitted. An in-flight generation for the project is marked cancelled and
   * its result is dropped (never persisted).
   */
  cancel(projectId?: string): void {
    if (this.disposed) return;

    if (projectId) {
      this.pending.delete(projectId);
      this.cancelled.add(projectId);
      if (this.state.projectId === projectId && this.state.phase === "queued") {
        this.setState({ phase: "idle", projectId: null, revision: null });
      }
    } else {
      const pendingIds = Array.from(this.pending.keys());
      this.pending.clear();
      for (const id of pendingIds) this.cancelled.add(id);
      // Any in-flight generation (tracked separately so a newer schedule for
      // another project cannot hide it) must also be dropped.
      if (this.inFlightProjectId) this.cancelled.add(this.inFlightProjectId);
      // Legacy safety: if state.projectId is the in-flight project (single
      // project case) and it is not already covered, cancel it too.
      if (this.state.projectId && this.state.phase !== "queued") {
        this.cancelled.add(this.state.projectId);
      }
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.state.phase === "queued") {
        this.setState({ phase: "idle", projectId: null, revision: null });
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
    this.listeners.clear();
    this.readyListeners.clear();
    this.state = { ...this.initialState(), phase: "idle" };
  }

  // -----------------------------------------------------------------------
  // Pipeline
  // -----------------------------------------------------------------------

  /** Pick the next request to process (one at a time, highest revision wins). */
  private pickNext(): ThumbnailScheduleRequest | null {
    let best: ThumbnailScheduleRequest | null = null;
    for (const request of this.pending.values()) {
      if (!best || request.revision > best.revision) {
        best = request;
      }
    }
    return best;
  }

  private async drain(): Promise<void> {
    if (this.inFlight) {
      await this.inFlight;
      // After waiting, continue draining any new pending work.
      if (this.pending.size > 0 && !this.disposed) {
        await this.drain();
      }
      return;
    }

    const request = this.pickNext();
    if (!request || this.disposed) return;

    // Remove the request from pending — it is now in-flight.
    this.pending.delete(request.projectId);

    this.inFlightProjectId = request.projectId;
    this.inFlight = this.process(request).finally(() => {
      this.inFlight = null;
      this.inFlightProjectId = null;
    });

    await this.inFlight;

    // Continue with the next pending request (e.g. a newer revision that was
    // queued while we were rendering).
    if (this.pending.size > 0 && !this.disposed) {
      await this.drain();
    }
  }

  private async process(
    request: ThumbnailScheduleRequest,
  ): Promise<void> {
    const { projectId, revision } = request;

    // A newer pending request for the same project supersedes this one —
    // skip entirely.
    const pendingSame = this.pending.get(projectId);
    if (pendingSame && pendingSame.revision > revision) {
      return;
    }

    // A cancelled project (e.g. deleted mid-generation) must not persist.
    if (this.cancelled.has(projectId)) {
      this.cancelled.delete(projectId);
      // Drop stuck "rendering" state so the scheduler returns to idle for
      // cancelled work (the next drain resets it for any new request).
      this.resetToPendingOrIdle();
      return;
    }

    this.setState({
      phase: "rendering",
      projectId,
      revision,
      error: undefined,
    });

    // Capture the "latest accepted revision" for the project at this moment so
    // a result that becomes stale mid-flight is dropped.
    const generation = await this.generate(request);

    // If disposed or superseded while generating, drop the result.
    if (this.disposed) return;
    if (this.cancelled.has(projectId)) {
      // Deleted/cancelled while rendering — never persist.
      this.cancelled.delete(projectId);
      this.resetToPendingOrIdle();
      return;
    }
    const superseded = this.pending.get(projectId);
    if (superseded && superseded.revision > revision) return;

    if (!generation.ok) {
      this.setState({
        phase: "error",
        projectId,
        revision,
        error: generation.error,
      });
      return;
    }

    // Persist with atomic stale-write protection in the storage layer.
    this.setState({ phase: "saving", projectId, revision });
    const saveResult = await this.storage.saveThumbnail(generation.record);

    if (this.disposed) return;
    const supersededAfterSave = this.pending.get(projectId);
    if (supersededAfterSave && supersededAfterSave.revision > revision) {
      // A newer revision arrived while saving — our write may still land, but
      // the next drain will generate the newer revision. Do not notify ready
      // for the stale revision.
      this.setState({
        phase: "queued",
        projectId,
        revision,
        error: undefined,
      });
      return;
    }

    if (!saveResult.success) {
      if (saveResult.error.code === "STALE_REVISION") {
        // A newer thumbnail already exists in storage — treat as success for
        // scheduler state, but do NOT publish a ready notification: the
        // existing record is already readable, and the dashboard's own read
        // path finds it. Notifying here would falsely claim THIS revision was
        // persisted (completion-contract: stale write rejection → no ready).
        this.setState({
          phase: "ready",
          projectId,
          revision,
          lastCompletedRevision: revision,
          error: undefined,
        });
        return;
      }
      this.setState({
        phase: "error",
        projectId,
        revision,
        error: saveResult.error,
      });
      return;
    }

    this.setState({
      phase: "ready",
      projectId,
      revision,
      lastCompletedRevision: revision,
      error: undefined,
    });

    // Publish the completion notification only for a genuine committed write.
    // A deduplicated save means the identical record already existed — no
    // subscriber needs to react (its own read path already shows it).
    if (!saveResult.deduplicated) {
      this.notifyReady({ projectId, revision });
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Reset public state to reflect remaining pending work (queued) or idle.
   * Called when in-flight work is cancelled so the phase never gets stuck.
   */
  private resetToPendingOrIdle(): void {
    const next = this.pickNext();
    if (next) {
      this.setState({ phase: "queued", projectId: next.projectId, revision: next.revision, error: undefined });
    } else {
      this.setState({ phase: "idle", projectId: null, revision: null, error: undefined });
    }
  }

  private currentResult(): ThumbnailScheduleResult {
    const s = this.state;
    if (s.phase === "error") {
      return { success: false, projectId: s.projectId ?? undefined, revision: s.revision ?? undefined, error: s.error };
    }
    return { success: true, projectId: s.projectId ?? undefined, revision: s.lastCompletedRevision ?? s.revision ?? undefined };
  }

  private initialState(): ThumbnailSchedulerState {
    return {
      phase: "idle",
      projectId: null,
      revision: null,
      lastCompletedRevision: null,
    };
  }

  private setState(patch: Partial<ThumbnailSchedulerState>): void {
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  private notify(): void {
    const snapshot = this.freezeState(this.state);
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Listener exceptions must never break the scheduler.
      }
    }
  }

  private notifyReady(info: ThumbnailReadyInfo): void {
    for (const listener of this.readyListeners) {
      try {
        listener(info);
      } catch {
        // Listener exceptions must never break the scheduler.
      }
    }
  }

  private freezeState(state: ThumbnailSchedulerState): ThumbnailSchedulerState {
    return Object.freeze({ ...state });
  }
}

// ---------------------------------------------------------------------------
// Note: the scheduler is intentionally NOT a module singleton here. The
// ThumbnailSaveBridge owns the application scheduler instance (and a test
// injector), keeping a single source of truth for thumbnail infrastructure.
// ---------------------------------------------------------------------------
