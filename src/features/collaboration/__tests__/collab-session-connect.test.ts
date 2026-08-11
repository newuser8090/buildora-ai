// ---------------------------------------------------------------------------
// Phase P16 — CollabSession: connect-window edit durability
//
// REGRESSION: the commit hook is registered BEFORE the room is joined, so a
// user can type while start() is still connecting/initializing. The old code
// applied those edits to the pre-init doc and then start() rebuilt the doc
// from the durable base / canonical state — SILENTLY DISCARDING the edit, and
// because `connected` was false, no checkpoint was ever scheduled (the server
// revision never advanced). This test locks in the fix: edits made between
// hook registration and end-of-start() are replayed after init as one local
// transaction and checkpointed.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";
import { CollabSession } from "../services/collab-session";
import type {
  CollabConnectOptions,
  CollabJoinResult,
  CollabTransport,
} from "../transport/collab-transport";
import type {
  CollabRoomRef,
  CollabSeedResult,
  CollabTransportMessage,
  CollabTransportPhase,
} from "../types";
import { useWorkspaceAccessStore } from "@/features/workspaces/store/workspace-access-store";
import { setWorkspaceProviderForTests } from "@/features/workspaces/services/workspace-service";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { getCollabCommitHook } from "../editor-commit-hook";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";
import { logger } from "@/lib/logger";
import type { Project } from "@/types/project";

function baseProject(): Project {
  const base = JSON.parse(JSON.stringify(MOCK_PROJECT)) as Project;
  return {
    ...base,
    id: "proj-1",
    name: "Connect Project",
    assets: [],
    pages: base.pages,
    siteSettings: base.siteSettings ?? { siteName: "Connect Project" },
  };
}

/** A controllable fake transport: connect resolves on demand. */
class FailingTransport implements CollabTransport {
  readonly kind = "mock" as const;
  connectCalls = 0;

  connect(_room: CollabRoomRef, _opts: CollabConnectOptions): Promise<CollabJoinResult> {
    this.connectCalls += 1;
    return Promise.reject(new Error("server down"));
  }

  seed(_state: Uint8Array): Promise<CollabSeedResult> {
    return Promise.resolve({ state: null });
  }

  send(_update: Uint8Array): Promise<void> {
    return Promise.resolve();
  }

  checkpoint(_seq: number): Promise<void> {
    return Promise.resolve();
  }

  lock(): Promise<void> {
    return Promise.resolve();
  }

  unlock(): Promise<void> {
    return Promise.resolve();
  }

  onMessage(_cb: (m: CollabTransportMessage) => void): () => void {
    return () => undefined;
  }

  onStatus(_cb: (phase: CollabTransportPhase) => void): () => void {
    return () => undefined;
  }

  onAuthError(_cb: () => void): () => void {
    return () => undefined;
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }
}

/** A controllable fake transport: connect resolves on demand. */
class DeferredTransport implements CollabTransport {
  readonly kind = "mock" as const;
  connectCalls = 0;
  checkpointCalls: number[] = [];
  seedCalls = 0;
  savedProject: unknown = null;

  private resolveConnect: ((r: CollabJoinResult) => void) | null = null;
  private messageHandlers: Array<(m: CollabTransportMessage) => void> = [];
  private statusHandlers: Array<(phase: CollabTransportPhase) => void> = [];

  connect(_room: CollabRoomRef, _opts: CollabConnectOptions): Promise<CollabJoinResult> {
    this.connectCalls += 1;
    return new Promise((resolve) => {
      this.resolveConnect = resolve;
    });
  }

  finishConnect(join: CollabJoinResult): void {
    this.resolveConnect?.(join);
  }

  seed(_state: Uint8Array): Promise<CollabSeedResult> {
    this.seedCalls += 1;
    return Promise.resolve({ state: null });
  }

  send(_update: Uint8Array): Promise<void> {
    return Promise.resolve();
  }

  checkpoint(seq: number): Promise<void> {
    this.checkpointCalls.push(seq);
    return Promise.resolve();
  }

  lock(): Promise<void> {
    return Promise.resolve();
  }

  unlock(): Promise<void> {
    return Promise.resolve();
  }

  onMessage(cb: (m: CollabTransportMessage) => void): () => void {
    this.messageHandlers.push(cb);
    return () => {
      this.messageHandlers = this.messageHandlers.filter((h) => h !== cb);
    };
  }

  onStatus(cb: (phase: CollabTransportPhase) => void): () => void {
    this.statusHandlers.push(cb);
    return () => {
      this.statusHandlers = this.statusHandlers.filter((h) => h !== cb);
    };
  }

  onAuthError(_cb: () => void): () => void {
    return () => undefined;
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  emitMessage(msg: CollabTransportMessage): void {
    this.messageHandlers.forEach((h) => h(msg));
  }

  emitStatus(phase: CollabTransportPhase): void {
    this.statusHandlers.forEach((h) => h(phase));
  }
}

const room: CollabRoomRef = { workspaceId: "ws-1", projectId: "proj-1" };

beforeEach(() => {
  vi.restoreAllMocks();
  useWorkspaceAccessStore.getState().reset();
  useEditorStore.getState().clearCollaborativeProjection();
});

describe("CollabSession connect-window edits", () => {
  it("edits made while connecting are replayed after init and checkpointed", async () => {
    // Access context the editor resolved BEFORE the session finished joining.
    useWorkspaceAccessStore.getState().setWorkspaceContext({
      workspaceId: "ws-1",
      workspaceName: "Acme",
      role: "owner",
      serverRevision: 1,
    });
    useWorkspaceAccessStore.getState().setAccess({ mode: "editable" });
    useWorkspaceAccessStore.getState().setLease(null);

    const transport = new DeferredTransport();
    // Wire a real save provider so the checkpoint lands durably.
    setWorkspaceProviderForTests({
      saveWorkspaceProject: vi.fn().mockResolvedValue({ revision: 2 }),
      fetchWorkspaceProject: vi.fn().mockResolvedValue({ revision: 2 }),
    } as never);

    const session = new CollabSession({
      room,
      clientId: "client-a",
      canSend: true,
      transport,
    });

    // start() begins: wires the doc + registers the commit hook BEFORE the
    // transport resolves (the user can type in this window).
    const starting = session.start();
    const hook = getCollabCommitHook();
    expect(hook).not.toBeNull();

    // The user edits the headline while the room is still connecting. (The
    // doc is still empty at this point — the durable base is applied by
    // start() after connect — so the edit is built from the base project.)
    const next = JSON.parse(JSON.stringify(baseProject())) as Project;
    next.pages[0].sections[0].props.heading = "Typed before connect";
    hook!.applyLocalProject(next);

    // Now the room connects with NO canonical state and a durable base → the
    // session would have rebuilt the doc from the base and dropped the edit.
    const base = baseProject();
    transport.finishConnect({
      seq: 0,
      checkpointSeq: 0,
      base: JSON.parse(JSON.stringify(base)) as Project,
    } as unknown as CollabJoinResult);
    await starting;

    // The fix: the pre-connect edit was replayed after init and is visible.
    expect(session.project().pages[0].sections[0].props.heading).toBe(
      "Typed before connect",
    );
    // And a durable checkpoint was scheduled (server revision advanced). The
    // checkpoint debounce is 1500 ms, so poll a bit past it.
    await vi.waitFor(
      () => {
        expect(transport.checkpointCalls.length).toBeGreaterThan(0);
      },
      { timeout: 4000, interval: 100 },
    );

    await session.stop();
  });

  it("a failed connect unregisters the commit hook (no silent edit loss)", async () => {
    useWorkspaceAccessStore.getState().setWorkspaceContext({
      workspaceId: "ws-1",
      workspaceName: "Acme",
      role: "owner",
      serverRevision: 1,
    });
    useWorkspaceAccessStore.getState().setAccess({ mode: "editable" });
    useWorkspaceAccessStore.getState().setLease(null);

    const transport = new FailingTransport();
    const session = new CollabSession({
      room,
      clientId: "client-a",
      canSend: true,
      transport,
    });

    // REGRESSION: start() registers the commit hook BEFORE connecting (so the
    // user can type during the join window). If connect then fails, the hook
    // must be unregistered — otherwise every store mutation would route into
    // a disconnected session (no checkpoint, no dirty flag, edits silently
    // lost) until unmount.
    const starting = session.start();
    // The hook was registered before connect threw (the pre-connect window).
    expect(getCollabCommitHook()).not.toBeNull();
    await expect(starting).resolves.toBeUndefined();

    // After the failed connect the editor falls back to the standard local
    // persistence path — the hook must be gone.
    expect(getCollabCommitHook()).toBeNull();
    expect(transport.connectCalls).toBe(1);

    // And the store's canUndo/canRedo no longer delegate to a dead session.
    expect(useEditorStore.getState().canUndo()).toBe(false);
    await session.stop();
  });

  it("a clean start with no early edits skips replay and stays synced", async () => {
    useWorkspaceAccessStore.getState().setWorkspaceContext({
      workspaceId: "ws-1",
      workspaceName: "Acme",
      role: "owner",
      serverRevision: 1,
    });
    useWorkspaceAccessStore.getState().setAccess({ mode: "editable" });
    useWorkspaceAccessStore.getState().setLease(null);

    const transport = new DeferredTransport();
    const saveMock = vi.fn().mockResolvedValue({ revision: 1 });
    setWorkspaceProviderForTests({
      saveWorkspaceProject: saveMock,
      fetchWorkspaceProject: vi.fn().mockResolvedValue({ revision: 1 }),
    } as never);

    const session = new CollabSession({
      room,
      clientId: "client-a",
      canSend: true,
      transport,
    });
    const starting = session.start();
    transport.finishConnect({
      seq: 0,
      checkpointSeq: 0,
      base: JSON.parse(JSON.stringify(baseProject())) as Project,
    } as unknown as CollabJoinResult);
    await starting;

    // No replay → no checkpoint scheduled for a phantom edit.
    expect(transport.checkpointCalls).toHaveLength(0);
    expect(session.project().pages[0].sections[0].props.heading).toBe(
      baseProject().pages[0].sections[0].props.heading,
    );

    await session.stop();

    // Nothing was unsynced → stop() makes no save call (no noisy session-end
    // checkpoint on scope churn / StrictMode double-mount).
    expect(saveMock).not.toHaveBeenCalled();
    expect(transport.checkpointCalls).toHaveLength(0);
  });

  it("stop() checkpoints unsynced local changes before teardown (Phase P17 F2)", async () => {
    useWorkspaceAccessStore.getState().setWorkspaceContext({
      workspaceId: "ws-1",
      workspaceName: "Acme",
      role: "owner",
      serverRevision: 1,
    });
    useWorkspaceAccessStore.getState().setAccess({ mode: "editable" });
    useWorkspaceAccessStore.getState().setLease(null);

    const saveMock = vi.fn().mockResolvedValue({ revision: 2 });
    setWorkspaceProviderForTests({
      saveWorkspaceProject: saveMock,
      fetchWorkspaceProject: vi.fn().mockResolvedValue({ revision: 2 }),
    } as never);

    const transport = new DeferredTransport();
    const session = new CollabSession({
      room,
      clientId: "client-a",
      canSend: true,
      transport,
    });
    const starting = session.start();
    transport.finishConnect({
      seq: 0,
      checkpointSeq: 0,
      base: JSON.parse(JSON.stringify(baseProject())) as Project,
    } as unknown as CollabJoinResult);
    await starting;

    // Edit AFTER connect. The debounced checkpoint is 1500 ms — it must NOT
    // fire within this test; stop() must flush the edit durably instead
    // (architecture §25 lists "session end" as a checkpoint trigger).
    const hook = getCollabCommitHook();
    expect(hook).not.toBeNull();
    const next = JSON.parse(JSON.stringify(baseProject())) as Project;
    next.pages[0].sections[0].props.heading = "Edited then closed";
    hook!.applyLocalProject(next);

    expect(saveMock).not.toHaveBeenCalled(); // debounce hasn't fired

    await session.stop();

    // The session-end checkpoint flushed the edit durably.
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(transport.checkpointCalls.length).toBeGreaterThan(0);
  });

  it("a failed connect is logged for diagnostics (Phase P18 F2)", async () => {
    useWorkspaceAccessStore.getState().setWorkspaceContext({
      workspaceId: "ws-1",
      workspaceName: "Acme",
      role: "owner",
      serverRevision: 1,
    });
    useWorkspaceAccessStore.getState().setAccess({ mode: "editable" });
    useWorkspaceAccessStore.getState().setLease(null);

    const transport = new FailingTransport();
    const session = new CollabSession({
      room,
      clientId: "client-a",
      canSend: true,
      transport,
    });

    // REGRESSION (F2): a connect failure was previously swallowed with no
    // record — a production incident (auth expiry / RLS break / network) was
    // invisible to operators. The existing logger must record it.
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    try {
      await session.start();
      expect(errorSpy).toHaveBeenCalled();
      const calls = errorSpy.mock.calls.map((c) => [c[0], c[1]] as [string, string]);
      expect(
        calls.some(
          ([tag, message]) => tag === "collab" && message.includes("connect failed"),
        ),
      ).toBe(true);
      // Phase P19 (F4) — the diagnostic carries the session's clientId so a
      // single tab's connect → checkpoint → auth-loss chain is correlatable.
      const connectCall = errorSpy.mock.calls.find(
        (c) => c[0] === "collab" && String(c[1]).includes("connect failed"),
      );
      expect(connectCall).toBeDefined();
      expect(connectCall![2]).toMatchObject({
        workspaceId: "ws-1",
        projectId: "proj-1",
        clientId: "client-a",
      });
    } finally {
      errorSpy.mockRestore();
      await session.stop();
    }
  });

  it("connect failure with pre-connect edits falls back to local persistence (Phase P17 F2b)", async () => {
    useWorkspaceAccessStore.getState().setWorkspaceContext({
      workspaceId: "ws-1",
      workspaceName: "Acme",
      role: "owner",
      serverRevision: 1,
    });
    useWorkspaceAccessStore.getState().setAccess({ mode: "editable" });
    useWorkspaceAccessStore.getState().setLease(null);
    useEditorStore.getState().setDirty(false);

    const transport = new FailingTransport();
    const session = new CollabSession({
      room,
      clientId: "client-a",
      canSend: true,
      transport,
    });

    const starting = session.start();
    // Type during the (failing) connect window.
    const hook = getCollabCommitHook();
    expect(hook).not.toBeNull();
    const next = JSON.parse(JSON.stringify(baseProject())) as Project;
    next.pages[0].sections[0].props.heading = "Typed during connect";
    hook!.applyLocalProject(next);

    await expect(starting).resolves.toBeUndefined();

    // Hook gone (standard persistence path) AND the store is dirty with the
    // edit preserved — previously dirty stayed false, so no autosave ever ran
    // and reload/close silently dropped the edit.
    expect(getCollabCommitHook()).toBeNull();
    expect(useEditorStore.getState().isDirty).toBe(true);
    expect(useEditorStore.getState().project.pages[0].sections[0].props.heading).toBe(
      "Typed during connect",
    );
    await session.stop();
  });
});


