// ---------------------------------------------------------------------------
// ThumbnailCapture — narrow capture boundary
//
// modern-screenshot is used ONLY here, behind a small interface so the rest of
// the thumbnail feature (and tests) never depends on the library directly.
//
// The capture step:
//   1. renders the hidden preview at THUMBNAIL_SOURCE_WIDTH x HEIGHT
//   2. captures it to a canvas via modern-screenshot's domToCanvas
//   3. returns the canvas for the encoder to downscale + encode
//
// modern-screenshot clones the node and its computed styles, embeds data:
// URL images (no CORS taint), and awaits media loading (timeout option).
// ---------------------------------------------------------------------------

// The dynamic import keeps the library out of the critical module graph and
// lets jsdom/unit tests avoid executing browser capture code paths.
let capturedModule: typeof import("modern-screenshot") | null = null;

async function getCaptureModule() {
  if (!capturedModule) {
    capturedModule = await import("modern-screenshot");
  }
  return capturedModule;
}

export interface CaptureRequest {
  /** The hidden preview node to capture. */
  node: HTMLElement;
  /** Source render width (px). */
  width: number;
  /** Source render height (px). */
  height: number;
  /** Timeout for media loading (ms). */
  timeoutMs?: number;
}

export interface CaptureResult {
  canvas: HTMLCanvasElement;
}

export type CaptureFn = (request: CaptureRequest) => Promise<CaptureResult>;

/**
 * Default capture implementation using modern-screenshot.
 * Captures the node at its natural size (already set to source dimensions),
 * returning a full-size canvas for downstream scaling + encoding.
 */
export const captureNode: CaptureFn = async ({
  node,
  width,
  height,
  timeoutMs = 10_000,
}) => {
  const mod = await getCaptureModule();
  const canvas = await mod.domToCanvas(node, {
    width,
    height,
    scale: 1,
    backgroundColor: "#ffffff",
    timeout: timeoutMs,
    // Do not let remote legacy images block forever; fall back via the
    // renderer's own handling when they fail to load.
  });
  return { canvas };
};

// ---------------------------------------------------------------------------
// WebP support probe
// ---------------------------------------------------------------------------

/**
 * Detect whether the browser can encode image/webp via canvas.
 * Cached per environment.
 */
let webpSupport: boolean | null = null;

export function webpSupported(): boolean {
  if (webpSupport !== null) return webpSupport;
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const dataUrl = canvas.toDataURL("image/webp");
    webpSupport = dataUrl.startsWith("data:image/webp");
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

/** Reset the cached probe (useful in tests). */
export function resetWebpSupportCache(): void {
  webpSupport = null;
}
