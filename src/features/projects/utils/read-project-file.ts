// ---------------------------------------------------------------------------
// readProjectFile — browser-specific file reader for project import
//
// Reads a File object and returns the text content.
// Validates file extension and size before reading.
// Does NOT parse JSON — that is the responsibility of the import service.
// ---------------------------------------------------------------------------

import type { ReadProjectFileResult } from "../types/project-transfer";
import { MAX_IMPORT_FILE_SIZE, BUILDORA_EXTENSION } from "../types/project-transfer";

// ---------------------------------------------------------------------------
// Accepted extensions
// ---------------------------------------------------------------------------

/** Only .buildora.json is fully accepted. .json is accepted with a warning. */
const ACCEPTED_EXTENSIONS = [BUILDORA_EXTENSION, ".json"];

/** Extensions that are always rejected regardless of content validity. */
const REJECTED_EXTENSIONS = [".txt", ".html", ".htm", ".xml", ".csv", ".pdf", ".png", ".jpg", ".js", ".ts", ".css"];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read a project file from a File object.
 *
 * Validates:
 * - File extension (must be .buildora.json or .json)
 * - File size (must be <= MAX_IMPORT_FILE_SIZE)
 * - File readability
 *
 * Does NOT parse JSON — returns raw text.
 *
 * @param file - The File object from a file input
 * @returns The file content as text, or a structured error
 */
export async function readProjectFile(
  file: File,
): Promise<ReadProjectFileResult> {
  // ---- Validate extension ----
  const ext = getExtension(file.name);
  if (!ext) {
    return {
      ok: false,
      error: {
        code: "INVALID_FILE_EXTENSION",
        message: `File has no extension. Please select a ${BUILDORA_EXTENSION} file.`,
        details: { filename: file.name, extension: null },
      },
    };
  }

  // Reject known invalid extensions
  if (REJECTED_EXTENSIONS.includes(ext)) {
    return {
      ok: false,
      error: {
        code: "INVALID_FILE_EXTENSION",
        message: `Unsupported file type "${ext}". Please select a ${BUILDORA_EXTENSION} file.`,
        details: { filename: file.name, extension: ext },
      },
    };
  }

  // Accept .buildora.json and .json; other unknown extensions are rejected
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    return {
      ok: false,
      error: {
        code: "INVALID_FILE_EXTENSION",
        message: `Unsupported file extension "${ext}". Please select a ${BUILDORA_EXTENSION} file.`,
        details: { filename: file.name, extension: ext },
      },
    };
  }

  // ---- Validate size ----
  if (file.size === 0) {
    return {
      ok: false,
      error: {
        code: "EMPTY_FILE",
        message: "The selected file is empty.",
        details: { filename: file.name },
      },
    };
  }

  if (file.size > MAX_IMPORT_FILE_SIZE) {
    return {
      ok: false,
      error: {
        code: "FILE_TOO_LARGE",
        message: `File is too large. Maximum size is ${(MAX_IMPORT_FILE_SIZE / (1024 * 1024)).toFixed(0)} MB.`,
        details: {
          limit: "FILE_SIZE",
          actual: file.size,
          max: MAX_IMPORT_FILE_SIZE,
          path: "file",
          filename: file.name,
        },
      },
    };
  }

  // ---- Read file ----
  try {
    const text = await readFileAsText(file);
    return { ok: true, text };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "FILE_READ_FAILED",
        message: err instanceof Error ? err.message : "Failed to read the file.",
        cause: err,
        details: { filename: file.name },
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the file extension (including dot) in lowercase.
 * Returns null if no extension is found.
 */
function getExtension(filename: string): string | null {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex === -1) return null;
  return filename.slice(dotIndex).toLowerCase();
}

/**
 * Read a File as text using FileReader API.
 */
function readFileAsText(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("File reader returned non-text result."));
      }
    };
    reader.onerror = () => {
      reject(new Error(reader.error?.message || "Failed to read file."));
    };
    reader.onabort = () => {
      reject(new Error("File reading was aborted."));
    };
    reader.readAsText(file);
  });
}
