// ---------------------------------------------------------------------------
// Phase P21 (F1) — MockHttpCollabTransport connect error-code preservation
//
// REGRESSION: connect() used to swallow the underlying workspace error and
// rethrow `new Error("collab connect failed")`. That broke three things:
//   1. The P18/P19 diagnostic contract — every connect failure logged as
//      `room connect failed (UNKNOWN)`, so an operator could not tell a
//      join-time authorization loss from a transient outage on the mock path.
//   2. Mock/Supabase parity — the Supabase transport preserves the code, so
//      connect-time PERMISSION_DENIED transitions the editor to the honest
//      read-only state there but kept local editing alive on the mock path.
//   3. E2E testability of the connect-time authorization-loss path.
//
// These tests lock in: the code survives connect() (auth + network cases) and
// the success path still resolves with the join result.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MockHttpCollabTransport } from "../transport/mock-http-collab-transport";
import type { CollabConnectOptions, CollabTransport } from "../transport/collab-transport";
import type { CollabRoomRef } from "../types";

const room: CollabRoomRef = { workspaceId: "ws-1", projectId: "proj-1" };
const options: CollabConnectOptions = { canSend: true, clientId: "client-a" };

function stubFetch(handler: (url: string, init: RequestInit) => Promise<Response>): void {
  vi.stubGlobal("fetch", vi.fn(handler as never));
}

function okJoin(): Response {
  return new Response(
    JSON.stringify({ ok: true, data: { seq: 4, checkpointSeq: 0, base: {} } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function errorEnvelope(code: string, status: number): Response {
  return new Response(
    JSON.stringify({ ok: false, error: { code, message: "denied" } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MockHttpCollabTransport.connect", () => {
  beforeEach(() => {
    stubFetch(() => Promise.resolve(okJoin()));
  });

  it("resolves with the join result on success", async () => {
    const transport: CollabTransport = new MockHttpCollabTransport();
    const joined = await transport.connect(room, options);
    expect(joined.seq).toBe(0); // checkpointSeq is the join frontier
    expect(joined.base).toEqual({});
    await transport.disconnect();
  });

  it("preserves the server authorization code on connect failure (PERMISSION_DENIED)", async () => {
    stubFetch(() => Promise.resolve(errorEnvelope("PERMISSION_DENIED", 403)));
    const transport: CollabTransport = new MockHttpCollabTransport();
    await expect(transport.connect(room, options)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    await transport.disconnect();
  });

  it("preserves SESSION_EXPIRED so the session can transition to read-only", async () => {
    stubFetch(() => Promise.resolve(errorEnvelope("SESSION_EXPIRED", 401)));
    const transport: CollabTransport = new MockHttpCollabTransport();
    await expect(transport.connect(room, options)).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
    });
    await transport.disconnect();
  });

  it("preserves NETWORK_FAILED when the collab service is unreachable", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    const transport: CollabTransport = new MockHttpCollabTransport();
    await expect(transport.connect(room, options)).rejects.toMatchObject({
      code: "NETWORK_FAILED",
    });
    await transport.disconnect();
  });

  it("does NOT regress to a generic error that loses the code", async () => {
    stubFetch(() => Promise.resolve(errorEnvelope("NOT_FOUND", 404)));
    const transport: CollabTransport = new MockHttpCollabTransport();
    try {
      await transport.connect(room, options);
      throw new Error("expected connect to reject");
    } catch (err) {
      expect(String((err as Error)?.message)).not.toBe("collab connect failed");
    }
    await transport.disconnect();
  });
});
