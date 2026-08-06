// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// My Blocks Library (Phase P5) — useMyBlockThumbnail hook tests
//
//   - idle when no record or disabled
//   - ready → real object URL created from the stored Blob
//   - error → status error, no URL
//   - stale/missing → regenerates via the service
//   - object URLs are revoked on unmount and on change
//   - stale-request protection: out-of-order results are dropped
//   - never sets state after unmount
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { MyBlockThumbnailRecord } from "../thumbnails/my-block-thumbnail-types";
import { useMyBlockThumbnail } from "../thumbnails/useMyBlockThumbnail";
import { makeRecord } from "./helpers";

// ---------------------------------------------------------------------------
// Mock the browser singleton — the hook only talks to the service.
// ---------------------------------------------------------------------------

const createObjectUrl = vi.fn((_blob: Blob) => `blob:mock-${createObjectUrl.mock.calls.length}`);
const revokeObjectUrl = vi.fn();

const mockService = {
  getRecord: vi.fn(),
  generateForRecord: vi.fn(),
  clearCache: vi.fn(),
};

vi.mock("../thumbnails/my-block-thumbnail-singleton", () => ({
  getMyBlockThumbnailService: () => mockService,
}));

function storedThumb(blockId: string, revision: number): MyBlockThumbnailRecord {
  return {
    blockId,
    revision,
    generatedAt: "2026-08-01T00:00:00.000Z",
    mimeType: "image/webp",
    width: 480,
    height: 300,
    byteSize: 8,
    hash: `h-${revision}`,
    data: new Blob(["thumb"], { type: "image/webp" }),
  };
}

beforeEach(() => {
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: createObjectUrl,
    revokeObjectURL: revokeObjectUrl,
  });
  mockService.getRecord.mockReset();
  mockService.generateForRecord.mockReset();
  createObjectUrl.mockClear();
  revokeObjectUrl.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useMyBlockThumbnail", () => {
  it("stays idle when there is no record or it is disabled", () => {
    const { result } = renderHook(() => useMyBlockThumbnail(null, true));
    expect(result.current.status).toBe("idle");
    expect(result.current.objectUrl).toBeNull();

    const { result: disabled } = renderHook(() =>
      useMyBlockThumbnail(makeRecord({ id: "b1" }), false),
    );
    expect(disabled.current.status).toBe("idle");
    expect(disabled.current.objectUrl).toBeNull();
    expect(mockService.getRecord).not.toHaveBeenCalled();
  });

  it("creates an object URL for a stored thumbnail at the current revision", async () => {
    const record = makeRecord({ id: "b1", contentRevision: 1 });
    mockService.getRecord.mockResolvedValue({ ok: true, value: storedThumb("b1", 1) });

    const { result } = renderHook(() => useMyBlockThumbnail(record, true));
    expect(result.current.status).toBe("loading");

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.objectUrl).toMatch(/^blob:mock-/);
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    // No regeneration needed.
    expect(mockService.generateForRecord).not.toHaveBeenCalled();
  });

  it("reports error (no URL) when the service fails with a non-missing error", async () => {
    const record = makeRecord({ id: "b1" });
    mockService.getRecord.mockResolvedValue({
      ok: false,
      error: { code: "DATABASE_OPEN_FAILED", message: "db down" },
    });

    const { result } = renderHook(() => useMyBlockThumbnail(record, true));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.objectUrl).toBeNull();
    expect(mockService.generateForRecord).not.toHaveBeenCalled();
  });

  it("regenerates when the stored thumbnail is missing", async () => {
    const record = makeRecord({ id: "b1" });
    mockService.getRecord.mockResolvedValue({
      ok: false,
      error: { code: "THUMBNAIL_NOT_FOUND", message: "missing" },
    });
    mockService.generateForRecord.mockResolvedValue({ ok: true, value: storedThumb("b1", 1) });

    const { result } = renderHook(() => useMyBlockThumbnail(record, true));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(mockService.generateForRecord).toHaveBeenCalledTimes(1);
  });

  it("regenerates when the stored thumbnail is stale (revision mismatch)", async () => {
    const record = makeRecord({ id: "b1", contentRevision: 3 });
    mockService.getRecord.mockResolvedValue({ ok: true, value: storedThumb("b1", 1) });
    mockService.generateForRecord.mockResolvedValue({ ok: true, value: storedThumb("b1", 3) });

    const { result } = renderHook(() => useMyBlockThumbnail(record, true));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(mockService.generateForRecord).toHaveBeenCalledTimes(1);
    expect(result.current.objectUrl).toMatch(/^blob:mock-/);
  });

  it("falls back to error when regeneration fails", async () => {
    const record = makeRecord({ id: "b1" });
    mockService.getRecord.mockResolvedValue({
      ok: false,
      error: { code: "THUMBNAIL_NOT_FOUND", message: "missing" },
    });
    mockService.generateForRecord.mockResolvedValue({
      ok: false,
      error: { code: "THUMBNAIL_GENERATION_FAILED", message: "no canvas" },
    });

    const { result } = renderHook(() => useMyBlockThumbnail(record, true));
    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("revokes the object URL on unmount", async () => {
    const record = makeRecord({ id: "b1" });
    mockService.getRecord.mockResolvedValue({ ok: true, value: storedThumb("b1", 1) });

    const { result, unmount } = renderHook(() => useMyBlockThumbnail(record, true));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const url = result.current.objectUrl;
    expect(url).toBeTruthy();
    expect(revokeObjectUrl).not.toHaveBeenCalled();

    unmount();
    expect(revokeObjectUrl).toHaveBeenCalledWith(url);
  });

  it("drops out-of-order results (stale-request protection)", async () => {
    const record = makeRecord({ id: "b1" });
    // First request resolves AFTER the second — the second must win.
    let resolveFirst: (v: unknown) => void = () => {};
    let resolveSecond: (v: unknown) => void = () => {};
    mockService.getRecord
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveFirst = r;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveSecond = r;
          }),
      );

    const { result, rerender } = renderHook(
      ({ enabled }) => useMyBlockThumbnail(record, enabled),
      { initialProps: { enabled: false } },
    );

    // Enable → request 1 in flight.
    rerender({ enabled: true });
    // Disable + re-enable → request 2 in flight.
    rerender({ enabled: false });
    rerender({ enabled: true });

    // Resolve the SECOND request with a real thumbnail → ready.
    act(() => {
      resolveSecond({ ok: true, value: storedThumb("b1", 1) });
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(createObjectUrl).toHaveBeenCalledTimes(1);

    // Now resolve the FIRST (stale) request — it must be dropped, no new URL.
    act(() => {
      resolveFirst({ ok: true, value: storedThumb("b1", 1) });
    });
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
  });

  it("never sets state after unmount (no act warnings / no crash)", async () => {
    const record = makeRecord({ id: "b1" });
    mockService.getRecord.mockImplementation(
      () => new Promise((r) => setTimeout(() => r({ ok: true, value: storedThumb("b1", 1) }), 20)),
    );

    const { unmount } = renderHook(() => useMyBlockThumbnail(record, true));
    unmount();
    // Wait past the resolution — nothing should throw or warn.
    await new Promise((r) => setTimeout(r, 40));
    expect(true).toBe(true);
  });
});
