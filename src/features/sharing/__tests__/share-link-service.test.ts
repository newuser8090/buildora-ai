// ---------------------------------------------------------------------------
// Share Links & Review Experience (Phase P12) — service tests
//
// The service is a thin provider-agnostic layer: it must map provider
// failures to structured beginner-safe errors and degrade malformed provider
// responses to safe failures.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ShareLinkService } from "../services/share-link-service";
import { makeShareError } from "../errors";
import type { ShareLinkProvider } from "../providers/share-link-provider";
import type { ShareProjection, ReviewComment, PublicShareResult } from "../types";

function fakeProvider(overrides: Partial<ShareLinkProvider> = {}): ShareLinkProvider {
  const base: ShareLinkProvider = {
    kind: "mock",
    createShare: vi.fn().mockResolvedValue({
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
      rawToken: "t".repeat(43),
      url: "http://localhost:3000/share/tttt",
    }),
    listShares: vi.fn().mockResolvedValue([]),
    shareStatusBatch: vi.fn().mockResolvedValue({}),
    updateShare: vi.fn().mockRejectedValue(makeShareError("EXPIRED", "expired")),
    pushSnapshot: vi.fn().mockResolvedValue(undefined),
    regenerateShare: vi.fn().mockResolvedValue({
      link: {} as never,
      rawToken: "r".repeat(43),
      url: "http://localhost:3000/share/rrrr",
    }),
    revokeShare: vi.fn().mockResolvedValue(undefined),
    listComments: vi.fn().mockResolvedValue([]),
    submitComment: vi.fn().mockResolvedValue({} as ReviewComment),
    setCommentResolved: vi.fn().mockResolvedValue(undefined),
    deleteComment: vi.fn().mockResolvedValue(undefined),
    resolvePublic: vi.fn().mockResolvedValue({ ok: false, state: "invalid" } as PublicShareResult),
    deleteProjectShareData: vi.fn().mockResolvedValue({ revokedShares: 0, deletedComments: 0 }),
    ...overrides,
  };
  return base;
}

let provider: ShareLinkProvider;
let service: ShareLinkService;

beforeEach(() => {
  provider = fakeProvider();
  service = new ShareLinkService(provider);
});

describe("happy paths", () => {
  it("create returns the link + token", async () => {
    const result = await service.create({
      projectId: "proj-1",
      feedbackEnabled: true,
      requireName: false,
      preset: "never",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rawToken.length).toBe(43);
  });

  it("deleteProjectShareData maps the provider result", async () => {
    (provider.deleteProjectShareData as ReturnType<typeof vi.fn>).mockResolvedValue({
      revokedShares: 2,
      deletedComments: 3,
    });
    const result = await service.deleteProjectShareData("proj-1");
    expect(result).toEqual({ ok: true, value: { revokedShares: 2, deletedComments: 3 } });
  });
});

describe("error mapping", () => {
  it("maps structured provider errors through unchanged", async () => {
    const result = await service.update("share-1", { feedbackEnabled: false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("EXPIRED");
      expect(result.error.retryable).toBe(false);
    }
  });

  it("maps unknown thrown errors to UNKNOWN", async () => {
    (provider.listShares as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    const result = await service.list("proj-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNKNOWN");
  });

  it("maps HTTP-status errors to safe codes", async () => {
    (provider.revokeShare as ReturnType<typeof vi.fn>).mockRejectedValue({ statusCode: 429 });
    const result = await service.revoke("share-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("RATE_LIMITED");
  });
});

describe("public resolve", () => {
  it("passes through invalid/expired/revoked states (never throws)", async () => {
    for (const state of ["invalid", "expired", "revoked"] as const) {
      (provider.resolvePublic as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        state,
      } as PublicShareResult);
      const result = await service.resolvePublic("token");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.state).toBe(state);
    }
  });

  it("maps an unexpected provider failure to a generic invalid state", async () => {
    (provider.resolvePublic as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network down"),
    );
    const result = await service.resolvePublic("token");
    expect(result).toEqual({ ok: false, state: "invalid" });
  });

  it("returns the active projection", async () => {
    const projection = {
      id: "",
      name: "Site",
      theme: {} as never,
      pages: [],
      assets: [],
    } as unknown as ShareProjection;
    (provider.resolvePublic as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      state: "active",
      share: {
        shareId: "share-1",
        projectId: "proj-1",
        projectName: "Site",
        feedbackEnabled: true,
        requireName: false,
      },
      projection,
    });
    const result = await service.resolvePublic("token");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.projection.name).toBe("Site");
  });
});
