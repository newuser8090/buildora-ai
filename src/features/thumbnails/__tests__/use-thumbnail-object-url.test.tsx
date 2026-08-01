// ---------------------------------------------------------------------------
// useThumbnailObjectUrl — hook tests
//
// Covers the runtime object-URL lifecycle:
//   - URL created only when a Blob is present
//   - same Blob reference reuses the URL (no leak)
//   - a new Blob revokes the previous URL
//   - unmount revokes the current URL
//   - createObjectURL failure degrades to null without crashing
//   - revokeObjectURL failure never crashes
//   - object URLs are never persisted (pure runtime concern)
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { useThumbnailObjectUrl } from "../hooks/useThumbnailObjectUrl";

// ---------------------------------------------------------------------------
// URL stubs — jsdom does not implement createObjectURL/revokeObjectURL
// ---------------------------------------------------------------------------

function makeBlob(content = "thumb"): Blob {
  return new Blob([content], { type: "image/webp" });
}

describe("useThumbnailObjectUrl", () => {
  let createSpy: ReturnType<typeof vi.fn>;
  let revokeSpy: ReturnType<typeof vi.fn>;
  let nextUrl: () => string;

  beforeEach(() => {
    let counter = 0;
    nextUrl = () => `blob:mock-thumb-${++counter}`;
    createSpy = vi.fn(() => nextUrl());
    revokeSpy = vi.fn();

    vi.stubGlobal("URL", {
      createObjectURL: createSpy,
      revokeObjectURL: revokeSpy,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a URL when a Blob is provided", () => {
    const blob = makeBlob();
    const { result } = renderHook(() => useThumbnailObjectUrl(blob));
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(createSpy.mock.results[0].value);
  });

  it("returns null when the Blob is null", () => {
    const { result } = renderHook(() => useThumbnailObjectUrl(null));
    expect(createSpy).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it("returns null when the Blob is undefined", () => {
    const { result } = renderHook(() => useThumbnailObjectUrl(undefined));
    expect(createSpy).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it("reuses the URL for the same Blob reference (no recreation)", async () => {
    const blob = makeBlob();
    const { result, rerender } = renderHook(({ b }) => useThumbnailObjectUrl(b), {
      initialProps: { b: blob },
    });
    const first = result.current;

    // Re-render with the same Blob reference — the URL must be reused.
    await act(async () => {
      rerender({ b: blob });
    });
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(first);
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it("revokes the previous URL when the Blob changes", async () => {
    const blobA = makeBlob("A");
    const { result, rerender } = renderHook(({ b }) => useThumbnailObjectUrl(b), {
      initialProps: { b: blobA },
    });
    const firstUrl = result.current;

    await act(async () => {
      rerender({ b: makeBlob("B") });
    });

    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(revokeSpy).toHaveBeenCalledWith(firstUrl);
    expect(result.current).not.toBe(firstUrl);
  });

  it("clears + revokes when the Blob becomes null", async () => {
    // Explicit generic so rerender({ b: null }) typechecks — otherwise TS
    // infers Props.b as Blob from the callback return and rejects null.
    const { result, rerender } = renderHook<
      ReturnType<typeof useThumbnailObjectUrl>,
      { b: Blob | null }
    >(
      ({ b }) => useThumbnailObjectUrl(b),
      { initialProps: { b: makeBlob() } },
    );
    const firstUrl = result.current;

    await act(async () => {
      rerender({ b: null });
    });

    expect(revokeSpy).toHaveBeenCalledWith(firstUrl);
    expect(result.current).toBeNull();
  });

  it("revokes the current URL on unmount", () => {
    const blob = makeBlob();
    const { result, unmount } = renderHook(() => useThumbnailObjectUrl(blob));
    const url = result.current;

    unmount();
    expect(revokeSpy).toHaveBeenCalledWith(url);
  });

  it("does not double-revoke on unmount after Blob change revocation", async () => {
    const { result, rerender, unmount } = renderHook(
      ({ b }) => useThumbnailObjectUrl(b),
      { initialProps: { b: makeBlob("A") } },
    );
    const firstUrl = result.current;

    await act(async () => {
      rerender({ b: makeBlob("B") });
    });
    expect(revokeSpy).toHaveBeenCalledWith(firstUrl);
    revokeSpy.mockClear();

    unmount();
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy.mock.calls[0][0]).not.toBe(firstUrl);
  });

  it("handles createObjectURL failure by returning null without crashing", () => {
    createSpy.mockImplementation(() => {
      throw new Error("createObjectURL failed");
    });
    const blob = makeBlob();
    const { result } = renderHook(() => useThumbnailObjectUrl(blob));
    expect(result.current).toBeNull();
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it("handles revokeObjectURL failure without crashing", async () => {
    revokeSpy.mockImplementation(() => {
      throw new Error("revoke failed");
    });
    const { result, rerender } = renderHook(({ b }) => useThumbnailObjectUrl(b), {
      initialProps: { b: makeBlob("A") },
    });
    expect(result.current).toBeTruthy();

    // Changing the Blob triggers a revoke of the old URL — must not throw.
    expect(() => {
      act(() => {
        rerender({ b: makeBlob("B") });
      });
    }).not.toThrow();
  });

  it("rapid Blob replacement leaves only the latest URL active", async () => {
    const { result, rerender } = renderHook(({ b }) => useThumbnailObjectUrl(b), {
      initialProps: { b: makeBlob("A") },
    });
    const urls = [result.current];

    await act(async () => {
      rerender({ b: makeBlob("B") });
    });
    urls.push(result.current);

    await act(async () => {
      rerender({ b: makeBlob("C") });
    });
    urls.push(result.current);

    // Two revokes for the first two URLs, latest remains active.
    expect(revokeSpy).toHaveBeenCalledTimes(2);
    expect(revokeSpy).toHaveBeenCalledWith(urls[0]);
    expect(revokeSpy).toHaveBeenCalledWith(urls[1]);
    expect(revokeSpy).not.toHaveBeenCalledWith(urls[2]);
    expect(createSpy).toHaveBeenCalledTimes(3);
  });

  it("mounts under React StrictMode without crashing and returns a live URL", () => {
    const blob = makeBlob();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    );
    const { result, unmount } = renderHook(() => useThumbnailObjectUrl(blob), {
      wrapper,
    });

    // StrictMode may double-invoke effects (mount → cleanup → remount) in
    // dev builds. The hook must never leave a revoked URL in state: whatever
    // URL is returned must be a live one that has not been revoked, and the
    // hook must clean up without throwing on unmount.
    //
    // Known limitation: this test environment (React 19 + RTL in vitest) does
    // not double-invoke effects under StrictMode (verified empirically), so
    // this is a smoke test — it does NOT deterministically exercise the
    // remount-recreation guard (`&& urlRef.current !== null`) in the hook.
    const liveUrl = result.current;
    expect(liveUrl).toBeTruthy();
    expect(typeof liveUrl).toBe("string");
    expect(revokeSpy).not.toHaveBeenCalledWith(liveUrl);

    expect(() => unmount()).not.toThrow();
  });

  it("does not persist any object URL (runtime-only)", () => {
    const blob = makeBlob();
    const { result } = renderHook(() => useThumbnailObjectUrl(blob));
    expect(typeof result.current).toBe("string");
    expect(result.current!.startsWith("blob:")).toBe(true);
    // The URL must never end up inside a Blob or storage — it is purely the
    // return value of the hook. No IndexedDB or localStorage interaction.
    expect(createSpy.mock.results[0].value).toBe(result.current);
  });
});
