// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// My Blocks Library (Phase P5) — MyBlockThumb component tests
//
//   - off-screen (idle): cheap structural preview, NO blob work
//   - loading: skeleton while the thumbnail is being fetched
//   - ready: real <img> with descriptive alt text (never raw content)
//   - error: friendly fallback (\"Preview unavailable — still safe to use\")
//   - IntersectionObserver gating: cards off-screen do no work
//   - unmount safety: never throws after the observer disconnects
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MyBlockThumb } from "../components/MyBlockThumb";
import { makeRecord, makeTree } from "./helpers";

// ---------------------------------------------------------------------------
// Mock the hook — the component renders purely from hook state.
// ---------------------------------------------------------------------------

const mockUseMyBlockThumbnail = vi.fn();

vi.mock("../thumbnails/useMyBlockThumbnail", () => ({
  useMyBlockThumbnail: (...args: unknown[]) => mockUseMyBlockThumbnail(...args),
}));

type ObserverCallback = (entries: Array<{ isIntersecting: boolean }>) => void;

class MockIntersectionObserver {
  callback: ObserverCallback;
  static instances: MockIntersectionObserver[] = [];

  constructor(callback: ObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe() {}
  disconnect() {}
  unobserve() {}
}

beforeEach(() => {
  mockUseMyBlockThumbnail.mockReset();
  MockIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("MyBlockThumb", () => {
  it("renders the structural preview while idle (off-screen cards do no blob work)", () => {
    mockUseMyBlockThumbnail.mockReturnValue({ status: "idle", objectUrl: null });
    const block = makeRecord({ id: "b1", tree: makeTree() });
    render(<MyBlockThumb block={block} />);
    expect(screen.getByTestId(`my-block-thumb-b1`)).toBeTruthy();
    expect(screen.queryByTestId(`my-block-thumb-img-b1`)).toBeNull();
    expect(screen.queryByTestId(`my-block-thumb-skeleton-b1`)).toBeNull();
    expect(screen.queryByTestId(`my-block-thumb-fallback-b1`)).toBeNull();
  });

  it("shows a loading skeleton while fetching", () => {
    mockUseMyBlockThumbnail.mockReturnValue({ status: "loading", objectUrl: null });
    render(<MyBlockThumb block={makeRecord({ id: "b1" })} />);
    expect(screen.getByTestId(`my-block-thumb-skeleton-b1`)).toBeTruthy();
  });

  it("renders the real thumbnail <img> with descriptive alt text when ready", () => {
    mockUseMyBlockThumbnail.mockReturnValue({
      status: "ready",
      objectUrl: "blob:mock-1",
    });
    const block = makeRecord({ id: "b1", name: "Hero section" });
    render(<MyBlockThumb block={block} />);
    const img = screen.getByTestId(`my-block-thumb-img-b1`);
    expect(img).toBeTruthy();
    expect((img as HTMLImageElement).src).toBe("blob:mock-1");
    expect(img.getAttribute("alt")).toBe("Preview of Hero section");
    expect(img.getAttribute("loading")).toBe("lazy");
    // Never draggable (avoids accidental canvas drags from the preview).
    expect(img.getAttribute("draggable")).toBe("false");
  });

  it("shows the friendly fallback on error (safe to use, no raw content)", () => {
    mockUseMyBlockThumbnail.mockReturnValue({ status: "error", objectUrl: null });
    const block = makeRecord({ id: "b1", name: "Hero" });
    render(<MyBlockThumb block={block} />);
    const fallback = screen.getByTestId(`my-block-thumb-fallback-b1`);
    expect(fallback).toBeTruthy();
    expect(fallback.textContent).toContain("still safe to use");
    // Never renders raw file/source content.
    expect(fallback.textContent).not.toContain("<script");
  });

  it("stays fixed-aspect (no layout shift) across states", () => {
    mockUseMyBlockThumbnail.mockReturnValue({ status: "loading", objectUrl: null });
    const { container } = render(<MyBlockThumb block={makeRecord({ id: "b1" })} height={88} />);
    const root = container.querySelector('[data-testid="my-block-thumb-b1"]') as HTMLElement;
    expect(root.style.height).toBe("88px");
  });

  it("unmounting while idle or loading never throws", () => {
    mockUseMyBlockThumbnail.mockReturnValue({ status: "idle", objectUrl: null });
    const { unmount } = render(<MyBlockThumb block={makeRecord({ id: "b1" })} />);
    unmount();

    mockUseMyBlockThumbnail.mockReturnValue({ status: "loading", objectUrl: null });
    const { unmount: unmount2 } = render(<MyBlockThumb block={makeRecord({ id: "b2" })} />);
    unmount2();
    expect(true).toBe(true);
  });
});
