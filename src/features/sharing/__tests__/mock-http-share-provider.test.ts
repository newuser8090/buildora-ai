// ---------------------------------------------------------------------------
// Share Links & Review Experience (Phase P12) — MockHttpShareProvider tests
//
// Verifies the wire contract: auth header forwarding, envelope parsing, and
// error-code mapping (including the public resolve state mapping).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { MockHttpShareProvider } from "../providers/mock-http-share-provider";
import {
  setMockSessionToken,
  clearMockSessionToken,
  resetMockSessionForTests,
} from "@/features/cloud-sync/providers/mock-session";

function fakeFetch(handler: (url: string, init: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(handler);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return new Response(JSON.stringify(ok ? { ok: true, data } : data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(code: string, status = 400): Response {
  return new Response(
    JSON.stringify({ ok: false, error: { code, message: "server copy" } }),
    { status },
  );
}

beforeEach(() => {
  clearMockSessionToken();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetMockSessionForTests();
});

describe("owner endpoints", () => {
  it("sends the bearer session token and posts the create body", async () => {
    setMockSessionToken("mock-token");
    const fetchMock = fakeFetch((url, init) => {
      expect(init.headers).toMatchObject({ Authorization: "Bearer mock-token" });
      expect(init.method).toBe("POST");
      const body = JSON.parse(String(init.body));
      expect(body.projectId).toBe("proj-1");
      return Promise.resolve(
        jsonResponse({
          link: {
            id: "share-1",
            projectId: "proj-1",
            status: "active",
            feedbackEnabled: true,
            requireName: false,
            expiresAt: null,
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
            lastOpenedAt: null,
            feedbackCount: 0,
          },
          rawToken: "x".repeat(43),
          url: "http://localhost:3000/share/xxx",
        }),
      );
    });
    const provider = new MockHttpShareProvider();
    const result = await provider.createShare({
      projectId: "proj-1",
      feedbackEnabled: true,
      requireName: false,
      preset: "7d",
    });
    expect(result.rawToken).toHaveLength(43);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/share",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("maps envelope error codes to structured share errors", async () => {
    setMockSessionToken("mock-token");
    fakeFetch(() => Promise.resolve(errorResponse("RATE_LIMITED", 429)));
    const provider = new MockHttpShareProvider();
    await expect(
      provider.submitComment("share-1", "token", { body: "hi" }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("maps session errors to SESSION_EXPIRED", async () => {
    fakeFetch(() => Promise.resolve(errorResponse("SESSION_EXPIRED", 401)));
    const provider = new MockHttpShareProvider();
    await expect(provider.listShares("proj-1")).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
    });
  });

  it("maps network failures to NETWORK_FAILED", async () => {
    fakeFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    const provider = new MockHttpShareProvider();
    await expect(provider.listShares("proj-1")).rejects.toMatchObject({
      code: "NETWORK_FAILED",
    });
  });

  it("never leaks raw provider bodies into error messages", async () => {
    fakeFetch(() =>
      Promise.resolve(
        errorResponse("UNKNOWN", 500),
      ),
    );
    const provider = new MockHttpShareProvider();
    await expect(provider.revokeShare("share-1")).rejects.toMatchObject({
      code: "UNKNOWN",
      message: "Sharing couldn't complete right now.",
    });
  });
});

describe("public resolve", () => {
  it("maps active responses to the ready state", async () => {
    fakeFetch(() =>
      Promise.resolve(
        jsonResponse({
          state: "active",
          share: {
            shareId: "share-1",
            projectId: "proj-1",
            projectName: "My Site",
            feedbackEnabled: true,
            requireName: false,
          },
          projection: { id: "", name: "My Site", theme: {}, pages: [], assets: [] },
        }),
      ),
    );
    const provider = new MockHttpShareProvider();
    const result = await provider.resolvePublic("tokentoken");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.share.shareId).toBe("share-1");
      expect(result.projection.name).toBe("My Site");
    }
  });

  it("maps INVALID_TOKEN / EXPIRED / REVOKED to public states", async () => {
    const provider = new MockHttpShareProvider();
    for (const [code, expected] of [
      ["INVALID_TOKEN", "invalid"],
      ["EXPIRED", "expired"],
      ["REVOKED", "revoked"],
    ] as const) {
      fakeFetch(() => Promise.resolve(errorResponse(code, code === "INVALID_TOKEN" ? 404 : 410)));
      const result = await provider.resolvePublic("tokentoken");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.state).toBe(expected);
    }
  });
});
