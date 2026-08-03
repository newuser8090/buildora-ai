import JSZip from "jszip";
import type { OutputFile, ExportResult } from "../pipeline/types";

// ---------------------------------------------------------------------------
// ZIP builder
//
// Takes an array of OutputFiles and produces a downloadable ZIP archive.
// The ZIP root is a single sanitised folder named after the project.
// Supports both UTF-8 text files and base64-encoded binary files.
// ---------------------------------------------------------------------------

const MAX_OUTPUT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// ---------------------------------------------------------------------------
// Build a ZIP blob from output files
// ---------------------------------------------------------------------------

export async function buildZipBlob(
  folderName: string,
  files: OutputFile[],
): Promise<Blob> {
  const zip = new JSZip();

  // Create the root folder
  const root = zip.folder(folderName);
  if (!root) {
    throw new Error(`Failed to create ZIP folder: ${folderName}`);
  }

  // Track total size to enforce the limit
  let totalSize = 0;

  for (const file of files) {
    // Calculate size for limit checking
    const contentSize = file.encoding === "base64"
      ? estimateBinaryLength(file.content)
      : new TextEncoder().encode(file.content).length;
    totalSize += contentSize;

    if (totalSize > MAX_OUTPUT_SIZE_BYTES) {
      throw new Error(
        `Export exceeds maximum size of ${MAX_OUTPUT_SIZE_BYTES / 1024 / 1024} MB. ` +
        `Consider reducing content before exporting.`,
      );
    }

    // Ensure file path uses forward slashes (ZIP standard)
    const normalizedPath = file.path.replace(/\\/g, "/");

    if (file.encoding === "base64") {
      // Binary file — use JSZip's base64 option
      root.file(normalizedPath, file.content, { base64: true });
    } else {
      // Text file — normal string content
      root.file(normalizedPath, file.content);
    }
  }

  return await zip.generateAsync({ type: "blob" });
}

/**
 * Estimate the original byte size from a base64-encoded string.
 * Each base64 char = 6 bits = 0.75 bytes. Padding '=' chars reduce size.
 */
function estimateBinaryLength(base64: string): number {
  const padding = (base64.match(/=+$/)?.[0]?.length) || 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

// ---------------------------------------------------------------------------
// Trigger a browser download for a blob
// ---------------------------------------------------------------------------

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();

  // Clean up after a short delay to ensure the download has started
  setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 1000);
}

// ---------------------------------------------------------------------------
// Full export: validate → generate → zip → download
// ---------------------------------------------------------------------------

export async function buildAndDownloadExport(
  folderName: string,
  files: OutputFile[],
): Promise<ExportResult> {
  try {
    const blob = await buildZipBlob(folderName, files);
    const sanitisedName = folderName.replace(/[^a-zA-Z0-9-_]/g, "-") || "project";
    downloadBlob(blob, `${sanitisedName}.zip`);

    return {
      success: true,
      projectName: folderName,
      fileCount: files.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error during export";
    return {
      success: false,
      projectName: folderName,
      fileCount: 0,
      error: message,
    };
  }
}
