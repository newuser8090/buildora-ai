// ---------------------------------------------------------------------------
// Phase P18 — SupabasePresenceProvider: heartbeat preserves project scope (F1)
//
// The mock backend keeps a presence session's `projectId` and `joinedAt`
// across heartbeats (only the TTL refreshes). The Supabase provider previously
// re-tracked on every heartbeat with `projectId: null` and a fresh `joinedAt`
// — so after the first 10 s heartbeat on the production path the user's
// presence row lost its project scope and vanished from project-scoped
// presence (PresenceIndicator filters sessions by projectId).
//
// These tests lock in mock parity:
//   * join records the project scope + first-seen timestamp on the channel
//     entry
//   * heartbeat re-tracks with the SAME projectId + joinedAt, updating only
//     the mode
//   * buildPresenceList surfaces the preserved scope for project-scoped reads
//   * a scope change (new join) updates the entry's scope, which later
//     heartbeats then preserve
//
// The provider is exercised against an injected fake Supabase client
// (setSupabaseClientForTests) — no credentials needed, matching repo
// conventions for provider unit tests.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SupabasePresenceProvider } from "../providers/supabase-presence-provider";
import { setSupabaseClientForTests } from "@/features/auth/supabase-client";
import { logger } from "@/lib/logger";

interface FakePresencePayload {
  sessionId: string;
  userId: string;
  mode: string;
  displayName: string;
  joinedAt: string;
  projectId: string | null;
}

class FakeChannel {
  topic = "presence:ws-1";
  state = "joined";
  subscribeCb: ((status: string) => void) | null = null;
  syncCb: (() => void) | null = null;
  tracked: Record<string, FakePresencePayload[]> = {};
  untracked = false;

  on(type: string, _opts: { event: string }, cb: () => void): FakeChannel {
    if (type === "presence" && !this.syncCb) this.syncCb = cb;
    return this;
  }

  subscribe(cb: (status: string) => void): FakeChannel {
    this.subscribeCb = cb;
    return this;
  }

  async track(payload: FakePresencePayload): Promise<void> {
    this.tracked = { self: [payload] };
    this.syncCb?.();
  }

  async untrack(): Promise<void> {
    this.untracked = true;
    this.tracked = {};
    this.syncCb?.();
  }

  presenceState<T>(): Record<string, T[]> {
    return this.tracked as Record<string, T[]>;
  }
}

class FakeClient {
  channels: FakeChannel[] = [];
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  removedChannels: unknown[] = [];
  user: { id: string; email: string } = { id: "user-a", email: "a@example.com" };

  auth = {
    getSession: vi.fn(async () => ({
      data: { session: { user: this.user } },
    })),
  };

  async rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: null }> {
    this.rpcCalls.push({ fn, args });
    return { data: null, error: null };
  }

  channel(name: string): FakeChannel {
    const ch = new FakeChannel();
    ch.topic = name;
    this.channels.push(ch);
    return ch;
  }

  async removeChannel(ch: unknown): Promise<void> {
    this.removedChannels.push(ch);
  }
}

let client: FakeClient;
let provider: SupabasePresenceProvider;

beforeEach(() => {
  client = new FakeClient();
  setSupabaseClientForTests(client as never);
  provider = new SupabasePresenceProvider();
});

afterEach(() => {
  setSupabaseClientForTests(null);
});

function join(projectId: string | null | undefined): Promise<void> {
  return provider.join({
    workspaceId: "ws-1",
    projectId,
    sessionId: "pres-s1",
    mode: "editing",
  });
}

describe("SupabasePresenceProvider heartbeat (Phase P18 F1)", () => {
  it("preserves the joined projectId across heartbeats", async () => {
    await join("proj-1");

    const channel = client.channels[0];
    expect(channel.tracked.self[0].projectId).toBe("proj-1");

    // A heartbeat must re-track with the SAME projectId (never null) so the
    // user stays visible in project-scoped presence.
    await provider.heartbeat("ws-1", "pres-s1", "editing");
    expect(channel.tracked.self[0].projectId).toBe("proj-1");

    // Mode changes propagate; scope does not.
    await provider.heartbeat("ws-1", "pres-s1", "viewing");
    expect(channel.tracked.self[0].projectId).toBe("proj-1");
    expect(channel.tracked.self[0].mode).toBe("viewing");
  });

  it("preserves the first-seen joinedAt across heartbeats", async () => {
    await join("proj-1");

    const channel = client.channels[0];
    const firstJoinedAt = channel.tracked.self[0].joinedAt;
    expect(firstJoinedAt).toBeTruthy();

    // Multiple heartbeats must never reset the join timestamp (the mock keeps
    // the original joinedAt and only refreshes the TTL).
    await provider.heartbeat("ws-1", "pres-s1", "editing");
    await provider.heartbeat("ws-1", "pres-s1", "editing");
    expect(channel.tracked.self[0].joinedAt).toBe(firstJoinedAt);
  });

  it("a workspace-wide join (no project) stays workspace-scoped", async () => {
    await join(null);

    const channel = client.channels[0];
    expect(channel.tracked.self[0].projectId).toBeNull();

    await provider.heartbeat("ws-1", "pres-s1", "viewing");
    expect(channel.tracked.self[0].projectId).toBeNull();
  });

  it("a new join with a different project updates the scope for later heartbeats", async () => {
    await join("proj-1");
    const channel = client.channels[0];
    const firstJoinedAt = channel.tracked.self[0].joinedAt;

    // User switches to another project in the same workspace. The join
    // updates the project scope; joinedAt is preserved for the existing
    // entry (mock parity — the mock keeps joinedAt for an existing session;
    // the hook recreates the entry per scope change, which the test covers
    // separately below).
    await join("proj-2");
    expect(channel.tracked.self[0].projectId).toBe("proj-2");
    expect(channel.tracked.self[0].joinedAt).toBe(firstJoinedAt);

    await provider.heartbeat("ws-1", "pres-s1", "editing");
    expect(channel.tracked.self[0].projectId).toBe("proj-2");
    expect(channel.tracked.self[0].joinedAt).toBe(firstJoinedAt);
  });

  it("a fresh channel entry (scope change in the hook) starts a new joinedAt", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      await join("proj-1");
      const channel = client.channels[0];
      const firstJoinedAt = channel.tracked.self[0].joinedAt;

      // Simulate the hook's scope change: it unsubscribes (removing the
      // channel entry) and re-joins with a fresh session on a NEW entry.
      await provider.leave("pres-s1");
      vi.setSystemTime(new Date("2026-01-01T00:00:05.000Z"));
      await join("proj-2");

      const freshChannel = client.channels[1];
      expect(freshChannel.tracked.self[0].projectId).toBe("proj-2");
      expect(freshChannel.tracked.self[0].joinedAt).not.toBe(firstJoinedAt);

      await provider.heartbeat("ws-1", "pres-s2", "editing");
      const preserved = freshChannel.tracked.self[0].joinedAt;
      expect(freshChannel.tracked.self[0].projectId).toBe("proj-2");
      await provider.heartbeat("ws-1", "pres-s2", "editing");
      expect(freshChannel.tracked.self[0].joinedAt).toBe(preserved);
    } finally {
      vi.useRealTimers();
    }
  });

  it("buildPresenceList surfaces the preserved scope for project-scoped reads", async () => {
    await join("proj-1");

    // A teammate's session in a different project must not leak into
    // project-scoped reads; the preserved projectId drives the filter.
    const list = await provider.getPresence("ws-1", "proj-1");
    expect(list).toHaveLength(1);
    expect(list[0].projectId).toBe("proj-1");

    await provider.heartbeat("ws-1", "pres-s1", "editing");
    const after = await provider.getPresence("ws-1", "proj-1");
    expect(after).toHaveLength(1); // heartbeat did not wipe the scope
    expect(after[0].projectId).toBe("proj-1");

    const other = await provider.getPresence("ws-1", "proj-2");
    expect(other).toHaveLength(0);
  });

  it("join still enforces the server gate before tracking", async () => {
    client.rpc = vi.fn(async () => ({
      data: null,
      error: { message: "PERMISSION_DENIED", code: "P0001" },
    })) as never;

    await expect(
      provider.join({
        workspaceId: "ws-1",
        projectId: "proj-1",
        sessionId: "pres-s1",
        mode: "editing",
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

    // The channel must never be opened or tracked for a non-member.
    expect(client.channels).toHaveLength(0);
  });

  it("a rejected join gate is logged for diagnostics (Phase P18 F2)", async () => {
    client.rpc = vi.fn(async () => ({
      data: null,
      error: { message: "PERMISSION_DENIED", code: "P0001" },
    })) as never;

    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    try {
      await expect(
        provider.join({
          workspaceId: "ws-1",
          projectId: "proj-1",
          sessionId: "pres-s1",
          mode: "editing",
        }),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

      // A gate rejection (removed member / expired session) is otherwise
      // swallowed by the best-effort hook — it must be diagnosable.
      expect(errorSpy).toHaveBeenCalled();
      const [tag, message] = errorSpy.mock.calls[0] as [string, string];
      expect(tag).toBe("presence");
      expect(message).toContain("join gate rejected");
    } finally {
      errorSpy.mockRestore();
    }
  });
});
