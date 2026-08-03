// ---------------------------------------------------------------------------
// downloadProjectFile — browser-specific file download utility
//
// Creates a Blob, object URL, and programmatically triggers a download.
// Isolated from export serialization logic — passes string content only.
// ---------------------------------------------------------------------------

import type { ProjectTransferError } from "../types/project-transfer";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Trigger a browser download of a project file.
 *
 * Creates:
 * - Blob with `application/json` MIME type
 * - Object URL for the Blob
 * - Invisible anchor element with download attribute
 *
 * Cleans up:
 * - Removes the anchor after click
 * - Revokes the object URL
 *
 * @param filename - The filename for the download (e.g. "my-project.buildora.json")
 * @param content - The JSON string content to download
 * @returns `{ ok: true }` on success, or `{ ok: false, error }` on failure
 */
export function downloadProjectFile(
  filename: string,
  content: string,
): { ok: true } | { ok: false; error: ProjectTransferError } {
  // Guard against non-browser environments
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    !document.createElement
  ) {
    return {
      ok: false,
      error: {
        code: "DOWNLOAD_FAILED",
        message: "Download is only available in a browser environment.",
      },
    };
  }

  let anchor: HTMLAnchorElement | null = null;
  let url: string | null = null;

  try {
    const blob = new Blob([content], { type: "application/json" });
    url = URL.createObjectURL(blob);

    anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "DOWNLOAD_FAILED",
        message: err instanceof Error ? err.message : "Failed to trigger download",
        cause: err,
      },
    };
  } finally {
    // Clean up: remove anchor and revoke URL
    try {
      if (anchor && anchor.parentNode) {
        anchor.parentNode.removeChild(anchor);
      }
    } catch {
      // Ignore cleanup errors
    }
    if (url) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore revoke errors
      }
    }
  }
}
