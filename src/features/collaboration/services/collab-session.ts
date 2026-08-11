// ---------------------------------------------------------------------------
// Collaborative editing (Phase P16) — CollabSession
//
// One session per (workspace project × tab). Owns:
//   - the Y.Doc (live collaborative state)
//   - a Y.UndoManager scoped to THIS client's transactions (local origin only)
//   - the transport connection (mock or Supabase)
//   - the editor commit hook (routes store mutations → CRDT transactions)
//   - the projection loop (doc → normalized Project → editor store)
//   - durable checkpoints (debounced save of the projection with optimistic
//     concurrency + bounded STALE retry) and the maintenance lock (restore/import)
//   - honest sync status (Synced / Syncing / Offline / Reconnecting / Error)
//
// Feedback-loop guarantees:
//   - local mutations are applied to the doc in ONE transaction with the local
//     origin; the resulting 'update' event is relayed to peers exactly once
//   - remote updates are applied with a remote origin and never re-broadcast
//   - the projection writes the editor store directly (applyRemoteProject),
//     never through a store mutation action — so no recursive reapply
//   - remote changes never set isDirty (the doc is already synced)
// ---------------------------------------------------------------------------

import * as Y from "yjs";
import type { Project } from "@/types/project";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useWorkspaceAccessStore } from "@/features/workspaces/store/workspace-access-store";
import { getWorkspaceProvider } from "@/features/workspaces/services/workspace-service";
import { toWorkspaceError } from "@/features/workspaces/errors";
import { getProjectController } from "@/features/persistence/services/project-controller";
import type { ProjectPersistenceAdapter } from "@/features/persistence/types";
import {
  getWorkspaceCacheMeta,
  setWorkspaceCacheMeta,
} from "@/features/workspaces/services/workspace-local-cache";
import { setCollabCommitHook, type CollabCommitHook } from "../editor-commit-hook";
import {
  initFromProject,
  reconcileProject,
  toProject,
  COLLAB_DOC_ROOT,
} from "../crdt/collab-doc";
import {
  isRemoteOrigin,
  localOrigin,
  remoteOrigin,
  COLLAB_CHECKPOINT_DEBOUNCE_MS,
} from "../types";
import type {
  CollabRoomRef,
  CollabSyncStatus,
  CollabTransportPhase,
} from "../types";
import type { CollabTransport } from "../transport/collab-transport";
import { base64ToArray } from "../transport/mock-http-collab-transport";
import { useCollabUiStore } from "../store/collab-ui-store";
import { logger } from "@/lib/logger";

const INIT_ORIGIN = "collab-init";

export interface CollabSessionOptions {
  room: CollabRoomRef;
  clientId: string;
  canSend: boolean;
  transport: CollabTransport;
  /** Called when the session should surface an honest read-only transition. */
  onAuthorizationLost?: () => void;
}

export class CollabSession {
  readonly room: CollabRoomRef;
  readonly clientId: string;
  readonly canSend: boolean;

  private transport: CollabTransport;
  private doc: Y.Doc;
  private undoManager: Y.UndoManager;
  private localOrigin: string;
  private disposed = false;
  private connected = false;
  private checkpointTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * One checkpoint at a time — the debounce and the session-end checkpoint
   * must never run two concurrent saves with the same expectedRevision (the
   * loser would burn a STALE_REVISION refetch+retry for no change).
   */
  private inFlightCheckpoint: Promise<boolean> | null = null;
  private lastSeq = -1;
  private lastRemoteChangeAt = 0;
  /**
   * Local edits made between commit-hook registration and the end of
   * start()'s connect/init. The commit hook is registered BEFORE the room is
   * joined (so the user can type immediately), but start() rebuilds the doc
   * from the durable base / canonical state once connected — which would
   * otherwise silently discard those early edits. Captured here and replayed
   * as one local transaction after init, then checkpointed.
   */
  private pendingLocalProject: Project | null = null;
  private unsubDocUpdate: (() => void) | null = null;
  private unsubObserve: (() => void) | null = null;
  private unsubMessage: (() => void) | null = null;
  private unsubStatus: (() => void) | null = null;
  private unsubAuthError: (() => void) | null = null;
  private onAuthorizationLost?: () => void;
  /**
   * Phase P17 (F2) — true while local changes have not yet been durably
   * checkpointed. Cleared on a successful checkpoint; drives the session-end
   * checkpoint in stop().
   */
  private hasUncheckpointedLocalChanges = false;
  /** Authorization was lost while connected — skip the session-end checkpoint. */
  private authLost = false;

  constructor(options: CollabSessionOptions) {
    this.room = options.room;
    this.clientId = options.clientId;
    this.canSend = options.canSend;
    this.transport = options.transport;
    this.onAuthorizationLost = options.onAuthorizationLost;
    this.localOrigin = localOrigin(options.clientId);
    this.doc = new Y.Doc();
    // Undo scoped to THIS client: only local-origin transactions are captured.
    this.undoManager = new Y.UndoManager(this.doc.getMap(COLLAB_DOC_ROOT), {
      trackedOrigins: new Set([this.localOrigin]),
      captureTimeout: 300,
    });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Initialize from the current store project and join the room. */
  async start(): Promise<void> {
    if (this.disposed) return;
    this.wireDoc();
    this.wireTransport();
    if (this.canSend) {
      setCollabCommitHook(this.commitHook);
    }

    let joined;
    try {
      joined = await this.transport.connect(this.room, {
        canSend: this.canSend,
        clientId: this.clientId,
      });
    } catch (err) {
      // Connect failed (server down / session expired). The commit hook was
      // registered BEFORE connect so the user could type during the join
      // window — leaving it registered would silently route every subsequent
      // store mutation into a DISCONNECTED session (no checkpoint, no dirty
      // flag, edits lost). Unregister it so the editor falls back to the
      // standard local persistence path and stays honest.
      // Phase P18 (F2) — make the failure diagnosable: the previous code
      // swallowed every connect error, so a production incident (auth
      // expiry, RLS break, network) was invisible to operators.
      // The code is embedded in the message (not only in `data`) so it
      // survives the logger's production redaction (data is dropped in prod).
      logger.error("collab", `room connect failed (${toWorkspaceError(err).code})`, {
        workspaceId: this.room.workspaceId,
        projectId: this.room.projectId,
        clientId: this.clientId,
      });
      if (this.canSend) {
        setCollabCommitHook(null);
      }
      // Phase P17 (F2b) — pre-connect edits are already in the store (the
      // projection loop applied them under the remote-projection flag), but
      // they were never marked dirty or scheduled for autosave. Re-commit the
      // pending state through the NORMAL store path so the standard local
      // persistence persists it — otherwise reload/close silently drops the
      // edits. (If access became read-only mid-connect — SESSION_EXPIRED /
      // PERMISSION_DENIED — setProject no-ops: the edit stays visible in the
      // store but is deliberately NOT persisted, matching the documented
      // "changes after permission loss are never uploaded" rule.)
      if (this.pendingLocalProject) {
        const pending = this.pendingLocalProject;
        useEditorStore.getState().setProject(pending);
        useEditorStore.getState().setDirty(true);
        this.pendingLocalProject = null;
      }
      this.setStatus("error");
      return;
    }
    if (this.disposed) return;
    this.connected = true;
    this.lastSeq = joined.seq;

    // Canonical shared-state seeding (architecture §14/§25): when the room has
    // a canonical Yjs state, apply it via applyUpdate so every client shares
    // IDENTICAL structs (concurrent merges never duplicate content). When it
    // has none, this client builds from the durable base and seeds the room.
    if (joined.state) {
      this.initFromCanonicalState(joined.state);
    } else if (joined.base && typeof joined.base === "object") {
      initFromProject(this.doc, joined.base as Project, INIT_ORIGIN);
      if (this.canSend) {
        const seeded = await this.transport
          .seed(Y.encodeStateAsUpdate(this.doc))
          .catch(() => null);
        if (seeded && seeded.state) {
          // Lost the seed race — apply the winner's canonical state.
          this.initFromCanonicalState(seeded.state);
        }
      }
    }
    this.applyProjection();
    // Replay any edits the user made while the room was connecting/initializing
    // (they were applied to the pre-init doc, which init just replaced). This
    // keeps those changes durable + relayed exactly once.
    if (this.pendingLocalProject) {
      const pending = this.pendingLocalProject;
      this.pendingLocalProject = null;
      reconcileProject(this.doc, pending, this.localOrigin);
      this.applyProjection();
      useEditorStore.getState().setDirty(true);
      this.setStatus("syncing");
      this.hasUncheckpointedLocalChanges = true;
      this.scheduleCheckpoint();
    } else {
      this.setStatus("synced");
    }
  }

  /** Replace the doc with the canonical room state (identical structs). */
  private initFromCanonicalState(stateB64: string): void {
    try {
      const update = base64ToArray(stateB64);
      const fresh = new Y.Doc();
      Y.applyUpdate(fresh, update, INIT_ORIGIN);
      // Detach the OLD doc's observers BEFORE destroying it (never leave a
      // stale observer on a destroyed doc — StrictMode/reconnect-safe, and the
      // projection callback would otherwise read a half-destroyed doc).
      this.unsubDocUpdate?.();
      this.unsubObserve?.();
      this.unsubDocUpdate = null;
      this.unsubObserve = null;
      this.doc.destroy();
      this.doc = fresh;
      // Re-wire observers on the new doc instance.
      this.wireDoc();
      this.undoManager = new Y.UndoManager(fresh.getMap(COLLAB_DOC_ROOT), {
        trackedOrigins: new Set([this.localOrigin]),
        captureTimeout: 300,
      });
    } catch {
      // Malformed canonical state — fall back to building from the durable
      // base (the next checkpoint/rebind heals convergence).
      const store = useEditorStore.getState();
      if (store.project?.id) {
        initFromProject(this.doc, store.project, INIT_ORIGIN);
      }
    }
  }

  /** Stop the session and unregister the commit hook. Idempotent. */
  async stop(): Promise<void> {
    if (this.disposed) return;
    this.clearCheckpointTimer();
    // Phase P17 (F2) — session-end checkpoint (architecture §25 lists "on
    // session end" as a checkpoint trigger). Persist unsynced local changes
    // durably BEFORE tearing down; skipped when nothing is unsynced (no noisy
    // saves on scope churn / StrictMode double-mount) or when authorization
    // was lost (the save would fail and the session is already read-only).
    if (
      this.connected &&
      this.canSend &&
      !this.authLost &&
      this.hasUncheckpointedLocalChanges
    ) {
      try {
        // A debounced checkpoint may already be in flight — wait for it (it
        // saves the same state) rather than starting a duplicate that would
        // STALE_REVISION-refetch and retry for nothing.
        if (this.inFlightCheckpoint) {
          await this.inFlightCheckpoint;
        } else {
          await this.checkpoint();
        }
      } catch {
        // Best-effort — the room log still holds the updates for reload/rebase.
      }
    }
    this.disposed = true;
    this.connected = false;
    if (this.unsubDocUpdate) this.unsubDocUpdate();
    if (this.unsubObserve) this.unsubObserve();
    if (this.unsubMessage) this.unsubMessage();
    if (this.unsubStatus) this.unsubStatus();
    if (this.unsubAuthError) this.unsubAuthError();
    if (this.canSend) {
      setCollabCommitHook(null);
    }
    try {
      await this.transport.disconnect();
    } catch {
      // Best-effort.
    }
    this.doc.destroy();
    useCollabUiStore.getState().reset();
  }

  // -------------------------------------------------------------------------
  // Editor commit hook (local mutations)
  // -------------------------------------------------------------------------

  private commitHook: CollabCommitHook = {
    applyLocalProject: (nextProject) => {
      this.applyLocal(nextProject);
    },
    undo: () => {
      if (!this.canSend) return;
      this.undoManager.undo();
      this.applyProjection();
    },
    redo: () => {
      if (!this.canSend) return;
      this.undoManager.redo();
      this.applyProjection();
    },
    canUndo: () => this.canSend && this.undoManager.undoStack.length > 0,
    canRedo: () => this.canSend && this.undoManager.redoStack.length > 0,
  };

  /** Apply a local mutation as one CRDT transaction (local origin). */
  private applyLocal(nextProject: Project): void {
    if (!this.canSend || this.disposed) return;
    reconcileProject(this.doc, nextProject, this.localOrigin);
    this.applyProjection();
    if (this.connected) {
      useEditorStore.getState().setDirty(true);
      this.setStatus("syncing");
      this.hasUncheckpointedLocalChanges = true;
      this.scheduleCheckpoint();
    } else {
      // Session still joining — remember the intended state so start() can
      // replay it after the doc is initialized from the canonical base.
      this.pendingLocalProject = nextProject;
    }
  }

  // -------------------------------------------------------------------------
  // Projection (doc → editor store)
  // -------------------------------------------------------------------------

  private applyProjection(): void {
    if (this.disposed) return;
    const project = toProject(this.doc);
    useEditorStore.getState().applyRemoteProject(project);
  }

  // -------------------------------------------------------------------------
  // Doc wiring
  // -------------------------------------------------------------------------

  private wireDoc(): void {
    // `doc.on` registers a handler (returns it); unregister with `doc.off`.
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (this.disposed || !this.connected) return;
      // Never echo remote updates or the init snapshot.
      if (isRemoteOrigin(origin) || origin === INIT_ORIGIN) return;
      void this.transport.send(update).catch((err) => this.handleSendFailure(err));
    };
    this.doc.on("update", onUpdate);
    this.unsubDocUpdate = () => this.doc.off("update", onUpdate);

    // Deep observation lives on the root type (yjs v13); unregister with
    // unobserveDeep (the observer is a type method, not a Doc event).
    const root = this.doc.getMap(COLLAB_DOC_ROOT);
    const onDeep = () => {
      if (this.disposed) return;
      this.applyProjection();
    };
    root.observeDeep(onDeep);
    this.unsubObserve = () => root.unobserveDeep(onDeep);
  }  private handleSendFailure(err: unknown): void {
    if (this.disposed) return;
    const error = toWorkspaceError(err);
    if (
      error.code === "PERMISSION_DENIED" ||
      error.code === "LEASE_INVALID" ||
      error.code === "SESSION_EXPIRED"
    ) {
      // Phase P18 (F2) — authorization loss during live editing must be
      // diagnosable (member removed / role downgraded while connected). Logged
      // once per incident: the transport's onAuthError fires for the same
      // auth loss, and a second log would just duplicate the record.
      if (!this.authLost) {
        logger.error("collab", `authorization lost while editing (${error.code})`, {
          workspaceId: this.room.workspaceId,
          projectId: this.room.projectId,
          clientId: this.clientId,
        });
      }
      this.setStatus("error");
      this.authLost = true;
      this.onAuthorizationLost?.();
      return;
    }
    if (error.code === "NETWORK_FAILED" || error.code === "OFFLINE") {
      this.setStatus("offline");
      return;
    }
    if (error.code === "LOCKED") {
      // Maintenance lock is transient — the doc already has the change; the
      // next checkpoint retries it.
      this.setStatus("syncing");
      this.scheduleCheckpoint();
      return;
    }
    this.setStatus("error");
  }

  private wireTransport(): void {
    this.unsubMessage = this.transport.onMessage((message) => {
      if (this.disposed) return;
      if (message.rebase || message.snapshot) {
        // Re-init from the durable base (never overwrite newer merged state).
        if (message.base && typeof message.base === "object") {
          initFromProject(this.doc, message.base as Project, INIT_ORIGIN);
          this.applyProjection();
        }
        if (message.seq >= 0) this.lastSeq = Math.max(this.lastSeq, message.seq);
        return;
      }
      if (message.update) {
        try {
          Y.applyUpdate(
            this.doc,
            base64ToArray(message.update),
            remoteOrigin(message.actorClientId ?? "peer"),
          );
        } catch {
          // A malformed update is ignored; convergence is guaranteed by the
          // next snapshot/checkpoint cycle.
        }
        if (message.seq >= 0) this.lastSeq = Math.max(this.lastSeq, message.seq);
        this.lastRemoteChangeAt = Date.now();
        this.noteRemoteChange(message.actorClientId);
      }
    });
    this.unsubStatus = this.transport.onStatus((phase) => {
      this.onTransportPhase(phase);
    });
    this.unsubAuthError = this.transport.onAuthError(() => {
      if (this.disposed) return;
      // Phase P18 (F2) — transport-level auth failures (offline-queue flush
      // rejected after permission loss) are otherwise silent. Logged only
      // when this is the FIRST signal (handleSendFailure may have already
      // recorded the same incident).
      if (!this.authLost) {
        logger.error("collab", "transport authorization error", {
          workspaceId: this.room.workspaceId,
          projectId: this.room.projectId,
          clientId: this.clientId,
        });
      }
      this.setStatus("error");
      this.authLost = true;
      this.onAuthorizationLost?.();
    });
  }

  /**
   * Batched, debounced remote-change hint (architecture §22): never a toast
   * per character — a single "A teammate updated this project" hint per burst.
   * Mock polls already coalesce updates into 500 ms batches; the UI store hint
   * additionally hides itself after a few seconds.
   */
  private noteRemoteChange(actorClientId?: string): void {
    if (this.disposed) return;
    const actorName =
      actorClientId && actorClientId !== this.clientId ? "A teammate" : null;
    useCollabUiStore.getState().setLastChange(actorName, "updated this project");
  }

  private onTransportPhase(phase: CollabTransportPhase): void {
    if (this.disposed) return;
    switch (phase) {
      case "connected":
        this.setStatus("synced");
        break;
      case "reconnecting":
        this.setStatus("reconnecting");
        break;
      case "offline":
        this.setStatus("offline");
        break;
      case "error":
        this.setStatus("error");
        break;
      default:
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Durable checkpoints (P15 version/activity integration)
  // -------------------------------------------------------------------------

  private scheduleCheckpoint(): void {
    if (this.checkpointTimer) return;
    this.checkpointTimer = setTimeout(() => {
      this.checkpointTimer = null;
      void this.checkpoint();
    }, COLLAB_CHECKPOINT_DEBOUNCE_MS);
  }

  private clearCheckpointTimer(): void {
    if (this.checkpointTimer) {
      clearTimeout(this.checkpointTimer);
      this.checkpointTimer = null;
    }
  }

  /** Force a durable checkpoint now (explicit Save / publish / restore). */
  async checkpointNow(): Promise<boolean> {
    this.clearCheckpointTimer();
    return this.checkpoint();
  }

  private checkpoint(): Promise<boolean> {
    // Single-flight: concurrent callers share one in-flight checkpoint.
    if (this.inFlightCheckpoint) return this.inFlightCheckpoint;
    this.inFlightCheckpoint = this.runCheckpoint().finally(() => {
      this.inFlightCheckpoint = null;
    });
    return this.inFlightCheckpoint;
  }

  private async runCheckpoint(): Promise<boolean> {
    if (this.disposed || !this.canSend) return false;
    const access = useWorkspaceAccessStore.getState();
    if (!access.workspaceId || access.role === "viewer") return false;
    const expected = access.serverRevision;
    if (expected === null || expected === undefined) return false;

    const project = toProject(this.doc);
    const provider = getWorkspaceProvider();
    if (!provider) return false;

    let attempt = 0;
    let expectedRevision = expected;
    while (attempt < 2) {
      attempt += 1;
      try {
        const summary = await provider.saveWorkspaceProject({
          workspaceId: this.room.workspaceId,
          projectId: this.room.projectId,
          project,
          expectedRevision,
        });
        // Keep the access store's server revision fresh (optimistic base).
        useWorkspaceAccessStore.getState().setWorkspaceContext({
          workspaceId: this.room.workspaceId,
          workspaceName: access.workspaceName,
          role: access.role,
          serverRevision: summary.revision,
        });
        useEditorStore.getState().markSaved(new Date().toISOString());
        this.setStatus("synced");
        this.hasUncheckpointedLocalChanges = false;
        // Keep the local IndexedDB cache fresh (recovery / offline open is
        // still honest) + cache metadata accurate for reopens.
        void this.refreshLocalCache(project, summary.revision);
        // Prune room updates + refresh the canonical state so late joiners
        // converge to identical structs (bounded — refreshed only on durable
        // checkpoints, and encodeStateAsUpdate of a converged doc is compact).
        void this.transport.checkpoint(this.lastSeq, Y.encodeStateAsUpdate(this.doc));
        return true;
      } catch (err) {
        const error = toWorkspaceError(err);
        if (error.code === "STALE_REVISION") {
          // Content is converged; refetch the revision and retry once.
          try {
            const fresh = await provider.fetchWorkspaceProject(
              this.room.workspaceId,
              this.room.projectId,
            );
            expectedRevision = fresh.revision;
            continue;
          } catch (refetchErr) {
            // Phase P18 (F2) — embed the code in the message so it survives
            // the logger's production redaction (data is dropped in prod),
            // consistent with every other collab diagnostic.
            logger.error(
              "collab",
              `checkpoint retry: revision refetch failed (${toWorkspaceError(refetchErr).code})`,
              {
                workspaceId: this.room.workspaceId,
                projectId: this.room.projectId,
                clientId: this.clientId,
              },
            );
            return false;
          }
        }
        // Phase P18 (F2) — diagnose checkpoint failures (they are otherwise
        // silent: the UI status flips but no record exists for an operator).
        // The code is embedded in the message so it survives the logger's
        // production redaction.
        logger.error("collab", `checkpoint failed (${error.code})`, {
          workspaceId: this.room.workspaceId,
          projectId: this.room.projectId,
          clientId: this.clientId,
        });
        if (
          error.code === "PERMISSION_DENIED" ||
          error.code === "LEASE_INVALID" ||
          error.code === "SESSION_EXPIRED"
        ) {
          this.authLost = true;
          this.onAuthorizationLost?.();
        } else if (error.code === "NETWORK_FAILED" || error.code === "OFFLINE") {
          this.setStatus("offline");
        } else if (error.code === "LOCKED") {
          // Maintenance lock (restore/import) is transient — retry shortly.
          this.setStatus("syncing");
          this.scheduleCheckpoint();
        } else {
          this.setStatus("error");
        }
        return false;
      }
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Maintenance lock (version restore / import coordination)
  // -------------------------------------------------------------------------

  async acquireMaintenanceLock(): Promise<void> {
    if (!this.canSend) return;
    await this.transport.lock(this.room);
    useCollabUiStore.getState().setMaintenance(true);
  }

  async releaseMaintenanceLock(): Promise<void> {
    await this.transport.unlock(this.room);
    useCollabUiStore.getState().setMaintenance(false);
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  private setStatus(status: CollabSyncStatus): void {
    useCollabUiStore.getState().setStatus(status);
  }

  /** Current projected project (used by restore/export/publish callers). */
  project(): Project {
    return toProject(this.doc);
  }

  // -------------------------------------------------------------------------
  // Local cache refresh (best-effort, never breaks collaboration)
  // -------------------------------------------------------------------------

  private controllerAdapter(): ProjectPersistenceAdapter | null {
    const controller = getProjectController();
    if (!controller) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (controller as any).adapter ?? null;
  }

  private async refreshLocalCache(
    project: Project,
    revision: number,
  ): Promise<void> {
    try {
      const adapter = this.controllerAdapter();
      if (!adapter) return;
      const saveResult = await adapter.saveProject({ project, revision });
      if (saveResult.success) {
        // Keep the cache metadata fresh for reopens (routing hint only — never
        // an authorization source). The userId is preserved from the existing
        // meta so a different account can never inherit workspace context.
        const meta = await getWorkspaceCacheMeta(adapter, project.id);
        if (meta && meta.userId) {
          await setWorkspaceCacheMeta(adapter, project.id, {
            workspaceId: this.room.workspaceId,
            userId: meta.userId,
            serverRevision: revision,
            serverUpdatedAt: new Date().toISOString(),
          });
        }
      }
    } catch {
      // Best-effort.
    }
  }
}
