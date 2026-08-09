// ---------------------------------------------------------------------------
// Template Packages (Phase P13) — data URL <-> bytes + image sniffing
//
// Browser-safe (no Node Buffer dependency): base64 and percent-encoded data
// URLs decode to Uint8Array; bytes re-encode to canonical base64 data URLs.
// `sniffImageBytes` verifies raster magic bytes / SVG text to catch spoofed
// MIME claims and script payloads.
// ---------------------------------------------------------------------------

import { parseDataUrl } from "@/features/assets/utils/data-url-parser";

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode a data URL to bytes. Supports base64 and percent-encoded payloads
 * (SVG files are commonly percent-encoded). Throws on malformed input.
 */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    throw new Error("Invalid data URL");
  }

  if (parsed.encoding === "base64") {
    return base64ToBytes(parsed.data);
  }

  // Percent-encoded (or raw) text payload — typically SVG.
  let text: string;
  try {
    text = decodeURIComponent(parsed.data);
  } catch {
    text = parsed.data;
  }
  return new TextEncoder().encode(text);
}

/** Decode a base64 string to bytes (browser-safe). */
export function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/** Encode bytes to base64 (browser-safe, chunked to avoid stack overflow). */
export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunkSize)) as unknown as number[],
    );
  }
  return btoa(binary);
}

/** Build a canonical base64 data URL for the given MIME type. */
export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

// ---------------------------------------------------------------------------
// Image sniffing
// ---------------------------------------------------------------------------

const SVG_DANGEROUS = /<script|javascript\s*:|on(load|error|click|mouseover|focus)\s*=/i;

/**
 * Verify that bytes plausibly match the claimed MIME type.
 * - PNG/JPEG/WebP: magic-byte check.
 * - SVG: decodes as text and rejects script/event-handler payloads.
 *
 * This is a claim check, not a full file-type audit — SVG is rendered only via
 * <img> (never dangerouslySetInnerHTML), matching the existing upload pipeline.
 */
export function sniffImageBytes(bytes: Uint8Array, mimeType: string): boolean {
  switch (mimeType) {
    case "image/png":
      return (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      );
    case "image/jpeg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/webp":
      return (
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    case "image/svg+xml": {
      if (bytes.length === 0) return false;
      // SVG is text — try UTF-8 decode (fall back to ASCII view).
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      } catch {
        return false;
      }
      if (SVG_DANGEROUS.test(text)) return false;
      return text.includes("<svg") || text.includes("<SVG");
    }
    default:
      return false;
  }
}

/** True when a string value looks like an unsafe URL scheme. */
export function isUnsafeUrlValue(value: string): boolean {
  return (
    /javascript\s*:/i.test(value) ||
    /vbscript\s*:/i.test(value) ||
    /data\s*:\s*text\/html/i.test(value)
  );
}
