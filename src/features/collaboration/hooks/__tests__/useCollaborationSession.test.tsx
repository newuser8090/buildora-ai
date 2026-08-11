// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Phase P21 (F2) — useCollaborationSession bounded reconnect on connect failure
//
// REGRESSION: a TRANSIENT connect failure (server restart / network blip at
// open) used to strand a dead session forever. The editor kept working with
// local-only persistence (status bar "Saved" = IndexedDB) while the workspace
// copy stayed stale — and a reload re-fetches the SERVER copy (authoritative),
// silently discarding those local edits with no failure signal.
//
// The fix: on a transient failure the dead session is torn down and a BOUNDED
// backoff re-join (fresh transport) is scheduled; on authorization loss the
// editor transitions to the honest read-only state (never retried); on
// permanent failures the standard local fallback is kept.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCollaborationSession } from "../useCollaborationSession";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useWorkspaceAccessStore } from "@/features/workspaces/store/workspace-access-store";
import { setWorkspaceProviderForTests } from "@/features/workspaces/services/workspace-service";
import { makeWorkspaceError } from "@/features/workspaces/errors";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";
import { logger } from "@/lib/logger";
import { getActiveCollabSession } from "../../services/collab-session-registry";
import type {
  CollabTransport,
  CollabJoinResult,
} from "../../transport/collab-transport";
import type { CollabRoomRef, CollabTestControls } from "../../types";

const { createCollabTransport } = vi.hoisted(() => ({
  createCollabTransport: vi.fn(),
}));

vi.mock("../../transport/collab-transport-factory", () => ({
  createCollabTransport,
}));

vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => ({ status: "signed-in", user: { id: "user-1" } }),
}));

/** Controllable fake transport: connect behavior injected per instance. */
class FakeTransport {
  readonly kind = "mock" as const;
  testControls: CollabTestControls | undefined = undefined;
  connectImpl: () => Promise<unknown>;
  connectCalls = 0;

  constructor(connectImpl: () => Promise<unknown>) {
    this.connectImpl = connectImpl;
  }

  connect(_room: CollabRoomRef): Promise<CollabJoinResult> {
    this.connectCalls += 1;
    return this.connectImpl() as Promise<CollabJoinResult>;
  }

  seed = vi.fn().mockResolvedValue({ state: null });
  send = vi.fn().mockResolvedValue(undefined);
  checkpoint = vi.fn().mockResolvedValue(undefined);
  lock = vi.fn().mockResolvedValue(undefined);
  unlock = vi.fn().mockResolvedValue(undefined);
  onMessage = vi.fn(() => () => undefined);
  onStatus = vi.fn(() => () => undefined);
  onAuthError = vi.fn(() => () => undefined);
  disconnect = vi.fn().mockResolvedValue(undefined);
}

function successJoin(): Promise<unknown> {
  return Promise.resolve({
    base: JSON.parse(JSON.stringify(MOCK_PROJECT)),
    seq: 0,
    checkpointSeq: 0,
  });
}

function seedEditorAndAccess(): void {
  useEditorStore.setState({ activeProjectId: "proj-1", isHydrated: true });
  const access = useWorkspaceAccessStore.getState();
  access.reset();
  access.setWorkspaceContext({
    workspaceId: "ws-1",
    workspaceName: "Acme",
    role: "owner",
    serverRevision: 1,
  });
  access.setAccess({ mode: "editable" });
  access.setLoading(false);
  access.setOffline(false);
  setWorkspaceProviderForTests({} as never);
}

beforeEach(() => {
  vi.useFakeTimers();
  createCollabTransport.mockReset();
  seedEditorAndAccess();
  // Quiet the session's connect-failure diagnostic during the tests.
  vi.spyOn(logger, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useCollaborationSession connect failure (Phase P21 F2)", () => {
  it("reconnects with a fresh transport after a transient connect failure", async () => {
    let call = 0;
    createCollabTransport.mockImplementation(() => {
      call += 1;
      const t =
        call === 1
          ? new FakeTransport(() =>
              Promise.reject(makeWorkspaceError("NETWORK_FAILED", "down")),
            )
          : new FakeTransport(successJoin);
      return t as unknown as CollabTransport;
    });

    const { unmount } = renderHook(() => useCollaborationSession());

    // Attempt 1 fails transiently → dead session torn down, retry scheduled.
    await act(async () => {});
    expect(createCollabTransport).toHaveBeenCalledTimes(1);
    expect(getActiveCollabSession()).toBeNull();

    // Advance past the first backoff → the hook re-runs → attempt 2 connects.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await act(async () => {});
    expect(createCollabTransport).toHaveBeenCalledTimes(2);
    // The fresh session is registered (the session registers synchronously
    // when the effect re-runs, before its connect resolves).
    expect(getActiveCollabSession()).not.toBeNull();

    unmount();
  });

  it("transitions to read-only on connect-time authorization loss (never retried)", async () => {
    createCollabTransport.mockImplementation(() => {
      const t = new FakeTransport(() =>
        Promise.reject(makeWorkspaceError("PERMISSION_DENIED", "denied")),
      );
      return t as unknown as CollabTransport;
    });

    const { unmount } = renderHook(() => useCollaborationSession());
    await act(async () => {});

    expect(useWorkspaceAccessStore.getState().access.mode).toBe("readonly");
    expect(useWorkspaceAccessStore.getState().access.reason).toBe("unauthorized");
    // The read-only transition re-runs the hook once (the accessMode dep);
    // that second read-only attempt is rejected server-side too, so no
    // session survives and no retry timer is ever scheduled.
    expect(createCollabTransport).toHaveBeenCalledTimes(2);
    expect(getActiveCollabSession()).toBeNull();

    // No retry can bring back a revoked session.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(createCollabTransport).toHaveBeenCalledTimes(2);

    unmount();
  });

  it("keeps the local fallback on permanent connect failures (no retry, no read-only)", async () => {
    createCollabTransport.mockImplementation(() => {
      const t = new FakeTransport(() =>
        Promise.reject(makeWorkspaceError("NOT_CONFIGURED", "not set up")),
      );
      return t as unknown as CollabTransport;
    });

    const { unmount } = renderHook(() => useCollaborationSession());
    await act(async () => {});

    // Access stays editable (standard local fallback) and no retry is fired.
    expect(useWorkspaceAccessStore.getState().access.mode).toBe("editable");
    expect(createCollabTransport).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(createCollabTransport).toHaveBeenCalledTimes(1);

    unmount();
  });

  it("gives up after the bounded retry budget (no reconnect storm)", async () => {
    createCollabTransport.mockImplementation(() => {
      const t = new FakeTransport(() =>
        Promise.reject(makeWorkspaceError("NETWORK_FAILED", "down")),
      );
      return t as unknown as CollabTransport;
    });

    const { unmount } = renderHook(() => useCollaborationSession());
    await act(async () => {});

    // Attempt 1 (initial) + up to MAX_CONNECT_RETRIES = 3 retries. Each
    // backoff is advanced in its own act with a microtask flush in between so
    // the previous attempt's failure classification (and next-timer schedule)
    // fully settles before the next window fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000); // retry 1
    });
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000); // retry 2
    });
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000); // retry 3 (budget exhausted)
    });
    await act(async () => {});
    expect(createCollabTransport).toHaveBeenCalledTimes(4);

    // Long after the budget is exhausted: no further attempts.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(createCollabTransport).toHaveBeenCalledTimes(4);

    unmount();
  });
});
