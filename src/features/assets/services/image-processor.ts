// ---------------------------------------------------------------------------
// Image Processor
//
// Browser-side file processing via FileReader.
// Reads a File, detects dimensions, and produces an Asset-compatible object.
// SVG dimensions are allowed to be undefined.
//
// ⚠ SVG safety
// Uploaded SVGs are stored as data URLs and rendered via <img> elements,
// never through dangerouslySetInnerHTML. This prevents script execution
// from injected SVG content. Deeper SVG sanitization (viewBox injection,
// external entity resolution, etc.) can be added in a future security sprint.
// ---------------------------------------------------------------------------

import type { AssetSource, AssetType } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessedImage {
  id: string;
  name: string;
  /** Semantic type assigned by caller after processing */
  type: AssetType;
  mimeType: string;
  extension: string;
  size: number;
  width?: number;
  height?: number;
  source: AssetSource;
  createdAt: string;
}

export interface ProcessingError {
  code: "FILE_READ_ERROR" | "IMAGE_DECODE_ERROR" | "DIMENSION_DETECTION_FAILED";
  message: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract extension from filename, preserving original case. */
function extractExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filename.slice(lastDot);
}

/** Generate a unique asset ID using timestamp and random suffix. */
function generateAssetId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `asset-${timestamp}-${random}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Process a File into an ProcessedImage.
 *
 * Steps:
 * 1. Read file as data URL via FileReader
 * 2. Detect image dimensions via Image element
 * 3. Build and return the processed result
 *
 * Returns a Promise that resolves to ProcessedImage or rejects with
 * ProcessingError.
 */
export function processImageFile(file: File): Promise<ProcessedImage> {
  return new Promise<ProcessedImage>((resolve, reject) => {
    // Read file
    const reader = new FileReader();

    reader.onerror = () => {
      const error: ProcessingError = {
        code: "FILE_READ_ERROR",
        message: `Failed to read file "${file.name}". The file may be corrupted or inaccessible.`,
      };
      reject(error);
    };

    reader.onload = async () => {
      const dataUrl = reader.result as string;

      try {
        const dimensions = await detectDimensions(dataUrl);

        const processed: ProcessedImage = {
          id: generateAssetId(),
          name: file.name,
          type: "image",
          mimeType: file.type,
          extension: extractExtension(file.name),
          size: file.size,
          width: dimensions?.width,
          height: dimensions?.height,
          source: {
            type: "data-url",
            value: dataUrl,
          },
          createdAt: new Date().toISOString(),
        };

        resolve(processed);
      } catch (err) {
        const error: ProcessingError = {
          code: "IMAGE_DECODE_ERROR",
          message: `Failed to decode image "${file.name}". ${(err as Error)?.message || "The file may not be a valid image."}`,
        };
        reject(error);
      }
    };

    // Read as data URL
    reader.readAsDataURL(file);
  });
}

/**
 * Detect the dimensions of an image from a data URL.
 * Uses the browser's Image element to decode and measure.
 *
 * For SVGs and other formats where dimensions are unreliable, returns
 * undefined rather than falling back to arbitrary defaults.
 */
export function detectDimensions(dataUrl: string): Promise<{ width: number; height: number } | undefined> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onerror = () => {
      // If the image can't be decoded at all, reject
      reject(new Error("Image could not be decoded"));
    };

    img.onload = () => {
      // For SVGs, the naturalWidth/Height may be 0 or unreliable
      if (img.naturalWidth === 0 || img.naturalHeight === 0) {
        resolve(undefined);
        return;
      }

      // Guard against unreasonably large dimension values
      if (img.naturalWidth > 100000 || img.naturalHeight > 100000) {
        resolve(undefined);
        return;
      }

      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    };

    img.src = dataUrl;
  });
}
