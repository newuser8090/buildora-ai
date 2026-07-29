// ---------------------------------------------------------------------------
// Output file — a single file in the generated project
// ---------------------------------------------------------------------------

export interface OutputFile {
  /** Relative path within the exported project, e.g. "app/layout.tsx" */
  path: string;
  /** File content as a string */
  content: string;
}

// ---------------------------------------------------------------------------
// Export validation result
// ---------------------------------------------------------------------------

export interface ExportValidation {
  valid: boolean;
  /** Human-readable error messages. Empty when valid is true. */
  errors: string[];
}

// ---------------------------------------------------------------------------
// Final export result
// ---------------------------------------------------------------------------

export interface ExportResult {
  success: boolean;
  /** Sanitised folder name for the exported project */
  projectName: string;
  /** Total files in the ZIP */
  fileCount: number;
  /** Human-readable error if success is false */
  error?: string;
}
