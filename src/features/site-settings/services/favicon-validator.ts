// ---------------------------------------------------------------------------
// Site icon (favicon) validation — Phase P7
//
// Safe MIME types + reasonable size limits, aligned with the existing asset
// upload rules. Icon uploads reuse the existing asset system (no new media
// persistence); this validator only gates which files may become a site icon.
// ---------------------------------------------------------------------------

export const FAVICON_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
] as const;

/** Icons larger than this are scaled down before export in spirit; the
 *  upload cap matches the existing asset upload limit (5 MB). */
export const FAVICON_MAX_SIZE_BYTES = 5 * 1024 * 1024;

export interface FaviconValidationResult {
  valid: boolean;
  error?: string;
}

export function validateFaviconFile(
  file: { type: string; size: number },
): FaviconValidationResult {
  if (!(FAVICON_MIME_TYPES as readonly string[]).includes(file.type)) {
    return {
      valid: false,
      error: "Site icons must be PNG, JPG, WebP, or SVG images.",
    };
  }
  if (file.size > FAVICON_MAX_SIZE_BYTES) {
    return {
      valid: false,
      error: "That image is too large (max 5 MB).",
    };
  }
  return { valid: true };
}

/** Whether an existing project asset may be used as a site icon. */
export function canAssetBeFavicon(mimeType: string): boolean {
  return (FAVICON_MIME_TYPES as readonly string[]).includes(mimeType);
}
