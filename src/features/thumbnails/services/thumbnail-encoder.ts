// ---------------------------------------------------------------------------
// ThumbnailEncoder
//
// Encodes a captured source canvas into an output thumbnail Blob.
//
//   - downscales the source canvas to THUMBNAIL_OUTPUT_WxH deterministically
//   - prefers image/webp, falls back to image/png when WebP is unsupported
//   - records width/height/byteSize/MIME
//   - rejects empty Blobs
//   - never creates a persistent object URL
//
// The encoder is injected into ThumbnailGenerationService so tests can
// substitute a fake encoder without real canvas work.
// ---------------------------------------------------------------------------

import { THUMBNAIL_OUTPUT_WIDTH, THUMBNAIL_OUTPUT_HEIGHT, THUMBNAIL_MIME_PREFERENCE, THUMBNAIL_MIME_FALLBACK, THUMBNAIL_QUALITY } from "../constants";
import { webpSupported } from "../rendering/thumbnail-capture";
import { thumbnailErrors } from "../errors";
import type { ThumbnailError } from "../types";

export interface EncodeRequest {
  /** Full-size source canvas produced by the capture step. */
  canvas: HTMLCanvasElement;
  /** Output width (px). */
  width?: number;
  /** Output height (px). */
  height?: number;
  /** Quality for lossy formats (0–1). */
  quality?: number;
}

export type EncodeResult =
  | {
      ok: true;
      blob: Blob;
      mimeType: "image/webp" | "image/png";
      width: number;
      height: number;
      byteSize: number;
    }
  | { ok: false; error: ThumbnailError };

export type ThumbnailEncoderFn = (request: EncodeRequest) => Promise<EncodeResult>;

/**
 * Default encoder implementation.
 */
export const encodeThumbnail: ThumbnailEncoderFn = async (request) => {
  const { canvas } = request;
  const outWidth = request.width ?? THUMBNAIL_OUTPUT_WIDTH;
  const outHeight = request.height ?? THUMBNAIL_OUTPUT_HEIGHT;
  const quality = request.quality ?? THUMBNAIL_QUALITY;

  if (!canvas || typeof canvas.width !== "number" || canvas.width <= 0) {
    return { ok: false, error: thumbnailErrors.encodingFailed(undefined, undefined, "Source canvas is unavailable.") };
  }

  let blob: Blob | null = null;
  let mimeType: "image/webp" | "image/png" = THUMBNAIL_MIME_PREFERENCE;

  // Prefer WebP; fall back to PNG when unsupported.
  const useWebp = THUMBNAIL_MIME_PREFERENCE === "image/webp" && webpSupported();

  try {
    if (useWebp) {
      blob = await canvasToBlob(canvas, "image/webp", quality);
    }
    if (!blob) {
      mimeType = THUMBNAIL_MIME_FALLBACK;
      blob = await canvasToBlob(canvas, "image/png", undefined);
    }
  } catch (err) {
    return {
      ok: false,
      error: thumbnailErrors.encodingFailed(
        undefined,
        undefined,
        err instanceof Error ? err.message : "Canvas encode threw.",
      ),
    };
  }

  if (!blob || blob.size === 0) {
    return {
      ok: false,
      error: thumbnailErrors.encodingFailed(undefined, undefined, "Encoded thumbnail is empty."),
    };
  }

  return {
    ok: true,
    blob,
    mimeType,
    width: outWidth,
    height: outHeight,
    byteSize: blob.size,
  };
};

/**
 * Draw a source canvas scaled into an output canvas of the requested size and
 * encode it. Used by the default encoder. Downscaling happens on a fresh
 * canvas so the source canvas is never mutated.
 */
async function canvasToBlob(
  source: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob | null> {
  const outWidth = THUMBNAIL_OUTPUT_WIDTH;
  const outHeight = THUMBNAIL_OUTPUT_HEIGHT;

  if (typeof document === "undefined") return null;

  const output = document.createElement("canvas");
  output.width = outWidth;
  output.height = outHeight;

  const ctx = output.getContext("2d");
  if (!ctx) return null;

  // Fill background first so transparent areas render as white.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outWidth, outHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, outWidth, outHeight);

  return new Promise<Blob | null>((resolve) => {
    output.toBlob(
      (blob) => resolve(blob),
      mimeType,
      quality,
    );
  });
}
