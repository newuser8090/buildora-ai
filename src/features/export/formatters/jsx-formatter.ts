// ---------------------------------------------------------------------------
// JSX text escaping helpers
//
// Every user-editable value that appears in generated JSX must be escaped
// to prevent injection and malformed output.
// ---------------------------------------------------------------------------

/** Escape a string for safe embedding in JSX text content or attribute values. */
export function escapeJsxText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/{/g, "&#123;")
    .replace(/}/g, "&#125;");
}

/**
 * Escape a string for safe embedding in a JSX expression string literal,
 * e.g. inside `{` `}` brackets as `"value"`.
 */
export function escapeJsxStringLiteral(value: string): string {
  // Backslash, backtick, dollar-brace, quotes, and line terminators that
  // could break the literal (raw newlines are invalid inside a JS string)
  return value
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\${/g, "\\${")
    .replace(/\r\n/g, "\\n")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\n")
    .replace(/"/g, '\\"');
}

// ---------------------------------------------------------------------------
// Sanitise a project name to a safe filesystem folder name
// ---------------------------------------------------------------------------

export function sanitiseFolderName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "project";
}

// ---------------------------------------------------------------------------
// Sanitise a filename (no path traversal, no special chars)
// ---------------------------------------------------------------------------

export function sanitiseFilename(name: string): string {
  return name
    .replace(/[/\\]/g, "-")
    .replace(/[^a-zA-Z0-9-_. ]/g, "")
    .replace(/\.\./g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128) || "file";
}

// ---------------------------------------------------------------------------
// Safe string for use in JSX text content (minimal escaping for display)
// ---------------------------------------------------------------------------

export function safeJsxString(value: unknown): string {
  if (typeof value !== "string") return "";
  return escapeJsxText(value);
}
