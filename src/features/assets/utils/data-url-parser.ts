// ---------------------------------------------------------------------------
// Data URL Parser
//
// Parses and validates data URLs (data:[mime][;base64],<data>).
// The parse and validation functions are browser-safe (pure string ops).
// Binary decoding is separated for export-only use (uses Node Buffer).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedDataUrl {
  /** MIME type, e.g. "image/png" */
  mimeType: string;
  /** Encoding, e.g. "base64" or "" for raw */
  encoding: string;
  /** Base64-encoded payload (or raw text if not base64) */
  data: string;
  /** The full original data URL string */
  raw: string;
}

export interface DataUrlValidation {
  valid: boolean;
  /** User-friendly error message when valid is false */
  error?: string;
  /** Parsed result, only present when valid is true */
  parsed?: ParsedDataUrl;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATA_URL_PATTERN = /^data:([^;,]*?)(?:;([^,]*?))?,(.*)$/;

// ---------------------------------------------------------------------------
// Public API — browser-safe
// ---------------------------------------------------------------------------

/**
 * Parse a data URL string into its components.
 * Returns null if the string is not a valid data URL format.
 */
export function parseDataUrl(dataUrl: string): ParsedDataUrl | null {
  if (typeof dataUrl !== "string" || dataUrl.length === 0) {
    return null;
  }

  const match = dataUrl.match(DATA_URL_PATTERN);
  if (!match) {
    return null;
  }

  const mimeType = match[1] || "text/plain";
  const encoding = match[2] || "";
  const data = match[3] || "";

  return { mimeType, encoding, data, raw: dataUrl };
}

/**
 * Validate a data URL. Checks:
 * - Must be a valid data URL format
 * - Must have a non-empty payload
 * - If base64 encoded, the payload must be valid base64
 */
export function validateDataUrl(dataUrl: string): DataUrlValidation {
  if (!dataUrl || typeof dataUrl !== "string") {
    return { valid: false, error: "Data URL must be a non-empty string." };
  }

  if (!dataUrl.startsWith("data:")) {
    return { valid: false, error: "Invalid data URL: must start with 'data:'." };
  }

  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    return { valid: false, error: "Invalid data URL format. Expected format: data:[mime][;encoding],<data>" };
  }

  // Check empty payload
  if (!parsed.data || parsed.data.length === 0) {
    return { valid: false, error: "Data URL has an empty payload." };
  }

  // Validate base64 encoding
  if (parsed.encoding === "base64") {
    if (!isValidBase64(parsed.data)) {
      return { valid: false, error: "Data URL contains invalid base64 data." };
    }
  }

  return { valid: true, parsed };
}

/**
 * Check if a data URL has the expected MIME type.
 * Returns true if the MIME type matches or if no MIME type was specified.
 */
export function matchesMimeType(dataUrl: string, expectedMime: string): boolean {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return false;

  // If the data URL has no explicit MIME, it's ambiguous
  if (!parsed.mimeType || parsed.mimeType === "text/plain") {
    return false;
  }

  return parsed.mimeType.toLowerCase() === expectedMime.toLowerCase();
}

/**
 * Extract the base64 payload from a data URL.
 * Returns null if the data URL is invalid or not base64 encoded.
 */
export function extractBase64(dataUrl: string): string | null {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  if (parsed.encoding !== "base64") return null;
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Export-only: convert base64 data URL to binary
// ---------------------------------------------------------------------------

/**
 * Decode a base64 data URL to a Uint8Array.
 *
 * This uses Node's Buffer for decoding. It is intended for export/ZIP
 * generation (runs in Node.js during build or in the browser during dev).
 *
 * For browser-only contexts where Buffer is unavailable, use
 * decodeDataUrlBrowser() instead.
 */
export function decodeDataUrlToBinary(dataUrl: string): Uint8Array {
  const base64 = extractBase64(dataUrl);
  if (!base64) {
    throw new Error("Cannot decode data URL: not a valid base64 data URL.");
  }
  return base64ToBinary(base64);
}

/**
 * Convert a base64 string to a Uint8Array.
 * Uses Buffer in Node.js environments, falls back to atob() in browser.
 */
function base64ToBinary(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    // Node.js environment
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  // Browser environment — atob() + Uint8Array
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decode a base64 data URL in the browser without using Buffer.
 * Uses atob() and Uint8Array instead.
 */
export function decodeDataUrlInBrowser(dataUrl: string): Uint8Array {
  const base64 = extractBase64(dataUrl);
  if (!base64) {
    throw new Error("Cannot decode data URL: not a valid base64 data URL.");
  }

  try {
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return bytes;
  } catch (err) {
    throw new Error(
      `Failed to decode base64 data: ${(err as Error)?.message || "Invalid base64 content."}`,
    );
  }
}

/**
 * Estimate the original byte size from a base64-encoded string.
 */
export function estimateBase64Size(base64: string): number {
  // Each base64 character represents 6 bits
  // Padding '=' characters indicate the last group is incomplete
  const padding = (base64.match(/=+$/)?.[0]?.length) || 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Simple base64 validation. Checks that the string contains only valid
 * base64 characters (A-Z, a-z, 0-9, +, /, =) and that padding is correct.
 */
function isValidBase64(str: string): boolean {
  // Check for valid base64 characters
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(str)) {
    return false;
  }

  // Check length is valid (must be multiple of 4 after padding)
  const length = str.length;
  if (length % 4 === 1) {
    return false;
  }

  return true;
}
