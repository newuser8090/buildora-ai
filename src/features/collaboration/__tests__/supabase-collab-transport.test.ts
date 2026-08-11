// ---------------------------------------------------------------------------
// Phase P17 — SupabaseCollabTransport: bounded offline queue (F3)
//
// The mock transport already queues offline sends (bounded) and flushes on
// reconnect; the Supabase transport previously dropped a send whose RPC failed
// — a documented-contract deviation (architecture §23/§32) that only the mock
// honored. These tests lock in parity:
//   * offline sends (channel CLOSED) queue locally, bounded by count + bytes
//   * the queue flushes on re-subscribe BEFORE room catch-up (same ordering as
//     the mock: local edits first, then remote updates)
//   * the byte/count cap drops excess (never unbounded growth)
//   * authorization errors are NEVER queued — they propagate
//
// The transport is exercised against an injected fake Supabase client
// (setSupabaseClientForTests) — no credentials needed, matching repo
// conventions for provider unit tests.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SupabaseCollabTransport } from "../transport/supabase-collab-transport";
import { setSupabaseClientForTests } from "@/features/auth/supabase-client";
import { arrayToBase64 } from "../transport/mock-http-collab-transport";
import { COLLAB_OFFLINE_QUEUE_MAX } from "../types";
import type { CollabRoomRef } from "../types";

interface FakeRpcResult {
  data: unknown;
  error: { message: string; code: string } | null;
}

class FakeChannel {
  subscribeCb: ((status: string) => void) | null = null;
  sent: Array<{ event: string; payload: unknown }> = [];

  on(
    _type: string,
    _opts: { event: string },
    _cb: (payload: unknown) => void,
  ): FakeChannel {
    return this;
  }

  subscribe(cb: (status: string) => void): FakeChannel {
    this.subscribeCb = cb;
    return this;
  }

  async send(message: { type: string; event: string; payload: unknown }): Promise<void> {
    this.sent.push({ event: message.event, payload: message.payload });
  }
}

class FakeClient {
  channels: FakeChannel[] = [];
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  removedChannels: unknown[] = [];
  rpcImpl: (fn: string, args: Record<string, unknown>) => Promise<FakeRpcResult> =
    async () => ({ data: null, error: null });

  async rpc(fn: string, args: Record<string, unknown>): Promise<FakeRpcResult> {
    this.rpcCalls.push({ fn, args });
    return this.rpcImpl(fn, args);
  }

  channel(_name: string): FakeChannel {
    const ch = new FakeChannel();
    this.channels.push(ch);
    return ch;
  }

  async removeChannel(ch: unknown): Promise<void> {
    this.removedChannels.push(ch);
  }
}

const room: CollabRoomRef = { workspaceId: "ws-1", projectId: "proj-1" };

/** Let the async channel-subscribe handlers settle (flush + catch-up awaits). */
async function settle(): Promise<void> {
  // A macrotask drains every pending microtask (each sendNow is several
  // awaits deep), so the whole flush/catch-up chain completes deterministically.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

function baseState(): { data: unknown; error: null } {
  return {
    data: {
      seq: 0,
      checkpointSeq: 0,
      base: { id: "proj-1", name: "Room Base", pages: [] },
    },
    error: null,
  };
}

/** Bytes for an append RPC call at the given index (order-assertable). */
function updateBytes(tag: number): Uint8Array {
  return new Uint8Array([tag, tag + 1, tag + 2]);
}

let client: FakeClient;

beforeEach(() => {
  client = new FakeClient();
  client.rpcImpl = async (fn: string) =>
    fn === "ws_collab_get_state" ? baseState() : { data: 1, error: null };
  setSupabaseClientForTests(client as never);
});

afterEach(() => {
  setSupabaseClientForTests(null);
});

describe("SupabaseCollabTransport offline queue (Phase P17 F3)", () => {
  it("queues sends while the channel is closed and flushes on re-subscribe", async () => {
    const transport = new SupabaseCollabTransport();
    await transport.connect(room, { canSend: true, clientId: "client-a" });

    const channel = client.channels[0];
    // Simulate an established channel (flush no-ops, phase → connected).
    channel.subscribeCb!("SUBSCRIBED");
    await settle();

    // Network loss → channel closes → phase offline.
    channel.subscribeCb!("CLOSED");
    await settle();

    const first = updateBytes(1);
    const second = updateBytes(2);
    await transport.send(first);
    await transport.send(second);

    // Nothing hit the server yet — both queued locally.
    const appends = () =>
      client.rpcCalls.filter((c) => c.fn === "ws_collab_append_update");
    expect(appends()).toHaveLength(0);

    // Reconnect: the SUBSCRIBED handler flushes the queue BEFORE catch-up, in
    // order, then relays each broadcast.
    channel.subscribeCb!("SUBSCRIBED");
    await settle();

    const appended = appends();
    expect(appended).toHaveLength(2);
    expect(appended[0].args.p_update).toBe(arrayToBase64(first));
    expect(appended[1].args.p_update).toBe(arrayToBase64(second));
    expect(channel.sent.filter((m) => m.event === "update")).toHaveLength(2);
  });

  it("drops excess offline updates beyond the queue cap (bounded growth)", async () => {
    const transport = new SupabaseCollabTransport();
    await transport.connect(room, { canSend: true, clientId: "client-a" });

    const channel = client.channels[0];
    channel.subscribeCb!("SUBSCRIBED");
    await settle();
    channel.subscribeCb!("CLOSED");
    await settle();

    // Flood beyond the count cap (updates are tiny, so the byte cap is not
    // the binding constraint).
    for (let i = 0; i < COLLAB_OFFLINE_QUEUE_MAX + 44; i += 1) {
      await transport.send(updateBytes(i % 251));
    }

    channel.subscribeCb!("SUBSCRIBED");
    await settle();

    const appended = client.rpcCalls.filter(
      (c) => c.fn === "ws_collab_append_update",
    );
    // Exactly the capped number flushed; the excess was dropped, never
    // retained (the queue can never grow unbounded).
    expect(appended).toHaveLength(COLLAB_OFFLINE_QUEUE_MAX);
  });

  it("never queues authorization errors — they propagate", async () => {
    const transport = new SupabaseCollabTransport();
    await transport.connect(room, { canSend: true, clientId: "client-a" });

    const channel = client.channels[0];
    channel.subscribeCb!("SUBSCRIBED");
    await settle();

    // The server rejects the append (member removed / role downgraded while
    // the channel is nominally connected). The error must surface to the
    // session (→ honest read-only transition), NOT be swallowed into a queue.
    client.rpcImpl = async (fn: string) =>
      fn === "ws_collab_get_state"
        ? baseState()
        : { data: null, error: { message: "PERMISSION_DENIED", code: "P0001" } };

    const before = client.rpcCalls.filter(
      (c) => c.fn === "ws_collab_append_update",
    ).length;
    await expect(transport.send(updateBytes(9))).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });

    // The failed send was NOT queued: with the channel now offline, a NEW
    // send queues — the rejected update must not silently sit in the queue to
    // be uploaded later.
    channel.subscribeCb!("CLOSED");
    await settle();
    await transport.send(updateBytes(10));
    // Exactly ONE append was ever attempted — the rejected send's RPC. The
    // offline send(10) queued instead of uploading.
    expect(
      client.rpcCalls.filter((c) => c.fn === "ws_collab_append_update").length,
    ).toBe(before + 1);
  });

  it("an authorization failure while flushing surfaces the auth error (Phase P17 F3)", async () => {
    const transport = new SupabaseCollabTransport();
    await transport.connect(room, { canSend: true, clientId: "client-a" });

    const channel = client.channels[0];
    channel.subscribeCb!("SUBSCRIBED");
    await settle();
    channel.subscribeCb!("CLOSED");
    await settle();

    await transport.send(updateBytes(1));
    await transport.send(updateBytes(2));

    // The member lost permission while offline: the append RPC now rejects.
    client.rpcImpl = async (fn: string) =>
      fn === "ws_collab_get_state"
        ? baseState()
        : { data: null, error: { message: "PERMISSION_DENIED", code: "P0001" } };

    const authErrors: number[] = [];
    transport.onAuthError(() => {
      authErrors.push(1);
    });

    channel.subscribeCb!("SUBSCRIBED");
    await settle();

    // The flush surfaced the authorization loss instead of silently
    // re-queuing forever — and the second queued item was never uploaded.
    expect(authErrors.length).toBeGreaterThan(0);
    const appends = client.rpcCalls.filter(
      (c) => c.fn === "ws_collab_append_update",
    );
    expect(appends).toHaveLength(1); // only the first (rejected) flush item
  });

  it("connect reads the durable base and opens the room channel", async () => {
    const transport = new SupabaseCollabTransport();
    const joined = await transport.connect(room, {
      canSend: true,
      clientId: "client-a",
    });
    expect(joined.base).toMatchObject({ id: "proj-1" });
    expect(joined.seq).toBe(0);
    expect(client.channels).toHaveLength(1);
    await transport.disconnect();
    expect(client.removedChannels).toHaveLength(1);
  });
});
