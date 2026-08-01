// ---------------------------------------------------------------------------
// Filename Sanitization and Collision Handling
//
// Sanitizes filenames to remove path traversal and unsafe characters.
// Produces deterministic unique filenames when collisions occur.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FilenameMapEntry {
  /** The original asset name */
  original: string;
  /** The sanitized, collision-free filename */
  safe: string;
  /** Resolved if the original name is unused; if collision, the deduped variant */
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitize a filename.
 *
 * Rules:
 * - Remove path traversal segments (..)
 * - Remove directory separators (/ and \)
 * - Normalize unsafe characters to hyphens
 * - Preserve valid extensions
 * - Prevent empty filenames
 * - Normalize extension to lowercase
 * - Preserve the filename stem case (extension is lowercase)
 */
export function sanitiseFilename(name: string): string {
  if (!name || typeof name !== "string") {
    return "file";
  }

  // Split stem and extension
  const lastDot = name.lastIndexOf(".");
  let stem: string;
  let ext: string;

  if (lastDot === -1) {
    // No extension
    stem = name;
    ext = "";
  } else {
    stem = name.slice(0, lastDot);
    ext = name.slice(lastDot).toLowerCase();
  }

  // If the extension contains path separators or traversal, it's not a real
  // extension — merge it back into the stem and treat as extensionless.
  if (ext && (/[/\\]/.test(ext) || ext.includes(".."))) {
    stem = `${stem}${ext}`;
    ext = "";
  }

  // Remove path traversal segments
  stem = stem.replace(/\.\./g, "");

  // Replace directory separators and other unsafe chars with hyphens
  stem = stem.replace(/[/\\]/g, "-");

  // Remove characters that are not alphanumeric, hyphen, underscore, period, or space
  stem = stem.replace(/[^a-zA-Z0-9_ .-]/g, "");

  // Collapse multiple hyphens
  stem = stem.replace(/-+/g, "-");

  // Remove leading/trailing hyphens, dots, and spaces
  stem = stem.replace(/^[-. ]+/, "");
  stem = stem.replace(/[-. ]+$/, "");

  // If stem is empty, use a default
  if (!stem) {
    stem = "file";
  }

  // Truncate to sensible maximum (protect against very long names)
  stem = stem.slice(0, 64);

  return stem + ext;
}

/**
 * Normalize a filename to lowercase extension only, preserving stem case.
 * "Logo.PNG" → "Logo.png", "IMAGE.JPEG" → "IMAGE.jpeg"
 */
export function normalizeExtension(name: string): string {
  const lastDot = name.lastIndexOf(".");
  if (lastDot === -1) return name;
  const stem = name.slice(0, lastDot);
  const ext = name.slice(lastDot).toLowerCase();
  return stem + ext;
}

// ---------------------------------------------------------------------------
// Collision handling
// ---------------------------------------------------------------------------

/**
 * Build a deterministic map from asset IDs to safe, collision-free filenames.
 *
 * Collision strategy: append "-2", "-3", etc. before the extension.
 *
 * Example:
 *   logo.png → logo.png
 *   logo.png → logo-2.png  (collision)
 *   logo.png → logo-3.png  (collision)
 *   image.test.png → image.test.png
 *   image.test.png → image.test-2.png (collision)
 */
export function buildFilenameMap(
  assets: { id: string; name: string }[],
): Map<string, string> {
  const result = new Map<string, string>();
  const used = new Map<string, number>(); // sanitized stem → count

  for (const asset of assets) {
    const sanitized = sanitiseFilename(normalizeExtension(asset.name));
    const lastDot = sanitized.lastIndexOf(".");

    let stem: string;
    let ext: string;

    if (lastDot === -1) {
      stem = sanitized;
      ext = "";
    } else {
      stem = sanitized.slice(0, lastDot);
      ext = sanitized.slice(lastDot);
    }

    const count = used.get(sanitized) || 0;

    if (count === 0) {
      // First use — use the original name
      result.set(asset.id, sanitized);
      used.set(sanitized, 1);
    } else {
      // Collision — append "-N" before extension
      const nextCount = count + 1;
      const deduped = `${stem}-${nextCount}${ext}`;
      result.set(asset.id, deduped);
      used.set(sanitized, nextCount);
    }
  }

  return result;
}
