// ---------------------------------------------------------------------------
// ThumbnailGenerationService tests
//
// Uses injected fake renderer, capture, encoder, readiness waiter, clock and
// cleanup dependencies — no real DOM screenshot required for these unit tests.
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ThumbnailGenerationService, type ThumbnailGenerationDeps } from "../services/thumbnail-generation-service";
import {
  THUMBNAIL_SOURCE_WIDTH,
  THUMBNAIL_SOURCE_HEIGHT,
  THUMBNAIL_RENDER_TIMEOUT_MS,
  THUMBNAIL_ASSET_WAIT_TIMEOUT_MS,
} from "../constants";
import type { GenerateThumbnailRequest, ProjectThumbnailRecord, ThumbnailError } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides?: { id?: string }) {
  return {
    id: overrides?.id ?? "proj-1",
    name: "Test",
    theme: {
      palette: {
        background: "#fff", foreground: "#000", primary: "#7c5cfc",
        primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#000",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#fff", border: "#e5e5e5", card: "#fff", cardForeground: "#000",
      },
      typography: { fontFamily: "sans-serif", headingFont: "sans-serif", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "5rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
    pages: [
      {
        id: "page-1",
        title: "Home",
        slug: "/",
        sections: [
          { id: "s-header", type: "header", order: 1, visible: true, props: { logoText: "Brand", navLinks: [] }, styles: {} },
          { id: "s-hero", type: "hero", order: 2, visible: true, props: { headline: "Hello", primaryCta: { text: "Go", href: "#" } }, styles: {} },
        ],
      },
      {
        id: "page-2",
        title: "About",
        slug: "/about",
        sections: [
          { id: "s-footer", type: "footer", order: 1, visible: true, props: { text: "© 2026", links: [] }, styles: {} },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeRequest(overrides?: Partial<GenerateThumbnailRequest>): GenerateThumbnailRequest {
  return { project: makeProject(), revision: 3, ...overrides };
}

function makeCanvas(overrides?: Partial<HTMLCanvasElement>): HTMLCanvasElement {
  return { width: THUMBNAIL_SOURCE_WIDTH, height: THUMBNAIL_SOURCE_HEIGHT, ...overrides } as HTMLCanvasElement;
}

interface Harness {
  service: ThumbnailGenerationService;
  deps: {
    capture: ReturnType<typeof vi.fn>;
    encode: ReturnType<typeof vi.fn>;
    createContainer: ReturnType<typeof vi.fn>;
    removeContainer: ReturnType<typeof vi.fn>;
    waitForReadiness: ReturnType<typeof vi.fn>;
    mountPreview: ReturnType<typeof vi.fn>;
    now: ReturnType<typeof vi.fn>;
  };
  root: { unmount: ReturnType<typeof vi.fn> };
}

function setup(overrides?: Partial<ThumbnailGenerationDeps>): Harness {
  const root = { unmount: vi.fn() };
  const deps: Harness["deps"] = {
    capture: vi.fn().mockResolvedValue({ canvas: makeCanvas() }),
    encode: vi.fn().mockResolvedValue({
      ok: true,
      blob: new Blob(["webp-bytes"], { type: "image/webp" }),
      mimeType: "image/webp",
      width: 480,
      height: 300,
      byteSize: 1024,
    }),
    createContainer: vi.fn().mockReturnValue(document.createElement("div")),
    removeContainer: vi.fn(),
    waitForReadiness: vi.fn().mockResolvedValue(undefined),
    mountPreview: vi.fn().mockReturnValue(root),
    now: vi.fn().mockReturnValue("2026-07-30T00:00:00.000Z"),
  };
  const service = new ThumbnailGenerationService({ ...deps, ...overrides } as ThumbnailGenerationDeps);
  return { service, deps, root };
}

/** The blob recorded by a successful generation. */
async function successfulRecord(h: Harness): Promise<ProjectThumbnailRecord> {
  const result = await h.service.generate(makeRequest());
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected success");
  return result.record;
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ThumbnailGenerationService — successful generation", () => {
  it("generates a record with project id, revision, clock timestamp, and dims", async () => {
    const h = setup();
    const record = await successfulRecord(h);
    expect(record.projectId).toBe("proj-1");
    expect(record.revision).toBe(3);
    expect(record.generatedAt).toBe("2026-07-30T00:00:00.000Z");
    expect(record.mimeType).toBe("image/webp");
    expect(record.width).toBe(480);
    expect(record.height).toBe(300);
    expect(record.byteSize).toBe(1024);
    expect(record.data instanceof Blob).toBe(true);
  });

  it("renders into a single offscreen container", async () => {
    const h = setup();
    await successfulRecord(h);
    expect(h.deps.createContainer).toHaveBeenCalledTimes(1);
  });

  it("mounts the preview exactly once", async () => {
    const h = setup();
    await successfulRecord(h);
    expect(h.deps.mountPreview).toHaveBeenCalledTimes(1);
  });

  it("awaits readiness with the container and the asset-wait timeout", async () => {
    const h = setup();
    await successfulRecord(h);
    expect(h.deps.waitForReadiness).toHaveBeenCalledTimes(1);
    const [container, timeout] = h.deps.waitForReadiness.mock.calls[0];
    expect(container instanceof HTMLElement).toBe(true);
    expect(timeout).toBe(THUMBNAIL_ASSET_WAIT_TIMEOUT_MS);
  });

  it("captures the rendered node with the source dimensions", async () => {
    const h = setup();
    await successfulRecord(h);
    expect(h.deps.capture).toHaveBeenCalledTimes(1);
    const [req] = h.deps.capture.mock.calls[0];
    expect(req.width).toBe(THUMBNAIL_SOURCE_WIDTH);
    expect(req.height).toBe(THUMBNAIL_SOURCE_HEIGHT);
    expect(req.node instanceof HTMLElement).toBe(true);
  });

  it("records deterministic output dimensions on the encoded result", async () => {
    const h = setup();
    h.deps.encode.mockResolvedValue({
      ok: true,
      blob: new Blob(["x"], { type: "image/png" }),
      mimeType: "image/png",
      width: 480,
      height: 300,
      byteSize: 42,
    });
    const record = await successfulRecord(h);
    expect(record.mimeType).toBe("image/png");
    expect(record.byteSize).toBe(42);
  });
});

describe("ThumbnailGenerationService — failure mapping", () => {
  it("maps render/capture failure to RENDER_FAILED", async () => {
    const h = setup();
    h.deps.capture.mockRejectedValue(new Error("capture exploded"));
    const result = await h.service.generate(makeRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RENDER_FAILED");
      expect(result.error.projectId).toBe("proj-1");
      expect(result.error.revision).toBe(3);
      expect(result.error.retryable ?? true).toBe(true);
    }
  });

  it("propagates structured encoder errors as ENCODING_FAILED", async () => {
    const h = setup();
    h.deps.encode.mockResolvedValue({
      ok: false,
      error: { code: "ENCODING_FAILED", message: "encode failed", retryable: true } as ThumbnailError,
    });
    const result = await h.service.generate(makeRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ENCODING_FAILED");
    }
  });

  it("maps a throwing encoder to ENCODING_FAILED", async () => {
    const h = setup();
    h.deps.encode.mockRejectedValue(new Error("canvas.toBlob threw"));
    const result = await h.service.generate(makeRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ENCODING_FAILED");
      expect(result.error.retryable ?? true).toBe(true);
    }
  });

  it("returns RENDER_TARGET_UNAVAILABLE when no project is supplied", async () => {
    const h = setup();
    const result = await h.service.generate({
      project: undefined as unknown as GenerateThumbnailRequest["project"],
      revision: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RENDER_TARGET_UNAVAILABLE");
    }
  });

  it("maps readiness timeout (waitForReadiness rejection) to a non-blocking error", async () => {
    const h = setup();
    h.deps.waitForReadiness.mockRejectedValue(new Error("fonts timed out"));
    const result = await h.service.generate(makeRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.retryable ?? true).toBe(true);
    }
  });

  it("capture timeout maps to RENDER_FAILED and still cleans up", async () => {
    const h = setup();
    // Capture never resolves; the timeout promise wins.
    h.deps.capture.mockReturnValue(new Promise(() => {}));
    vi.useFakeTimers();
    const resultPromise = h.service.generate(makeRequest());
    await vi.advanceTimersByTimeAsync(THUMBNAIL_RENDER_TIMEOUT_MS + 10);
    const result = await resultPromise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RENDER_FAILED");
    }
    expect(h.deps.removeContainer).toHaveBeenCalledTimes(1);
    expect(h.root.unmount).toHaveBeenCalledTimes(1);
  });
});

describe("ThumbnailGenerationService — cleanup", () => {
  it("unmounts the React root and removes the container after success", async () => {
    const h = setup();
    await successfulRecord(h);
    expect(h.root.unmount).toHaveBeenCalledTimes(1);
    expect(h.deps.removeContainer).toHaveBeenCalledTimes(1);
  });

  it("unmounts and removes after a render failure", async () => {
    const h = setup();
    h.deps.capture.mockRejectedValue(new Error("boom"));
    await h.service.generate(makeRequest());
    expect(h.root.unmount).toHaveBeenCalledTimes(1);
    expect(h.deps.removeContainer).toHaveBeenCalledTimes(1);
  });

  it("unmounts and removes after an encoder failure", async () => {
    const h = setup();
    h.deps.encode.mockResolvedValue({
      ok: false,
      error: { code: "ENCODING_FAILED", message: "x", retryable: true } as ThumbnailError,
    });
    await h.service.generate(makeRequest());
    expect(h.root.unmount).toHaveBeenCalledTimes(1);
    expect(h.deps.removeContainer).toHaveBeenCalledTimes(1);
  });

  it("no persistent React root remains — a second generation mounts a fresh root", async () => {
    const h = setup();
    await successfulRecord(h);
    await successfulRecord(h);
    expect(h.deps.mountPreview).toHaveBeenCalledTimes(2);
    expect(h.root.unmount).toHaveBeenCalledTimes(2);
  });
});

describe("ThumbnailGenerationService — no mutation", () => {
  it("does not mutate the input project", async () => {
    const h = setup();
    const project = makeProject();
    const before = JSON.stringify(project);
    await h.service.generate({ project, revision: 3 });
    expect(JSON.stringify(project)).toBe(before);
  });

});

describe("ThumbnailGenerationService — deterministic behavior", () => {
  it("produces deterministic dimensions for repeated generation", async () => {
    const h = setup();
    const a = await successfulRecord(h);
    const b = await successfulRecord(h);
    expect(a.width).toBe(b.width);
    expect(a.height).toBe(b.height);
    expect(a.mimeType).toBe(b.mimeType);
  });

  it("preserves project id and revision exactly", async () => {
    const h = setup();
    const result = await h.service.generate(makeRequest({ revision: 42 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.projectId).toBe("proj-1");
      expect(result.record.revision).toBe(42);
    }
  });
});
