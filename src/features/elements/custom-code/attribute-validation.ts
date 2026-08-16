// ---------------------------------------------------------------------------
// Custom-code attribute validation (Phase P23-F) — pure, deterministic
//
// Authoring policy for ElementCustomCode.attributes. The sandbox emission
// (custom-code/srcdoc.ts) only ever serializes well-formed, non-event,
// non-shell attribute names onto the wrapper element — the authoring boundary
// mirrors that allowlist so the inspector never accepts an attribute that
// would be silently dropped in the published site:
//
//   - names are trimmed, lowercased, and must be well-formed HTML attribute
//     names (letter first, then letters/digits/-/_/:)
//   - event-handler attributes ("on*") are rejected outright — no JavaScript
//     execution is possible through attributes
//   - shell/reserved attributes (style, srcdoc) are rejected
//   - URL-bearing attributes (href, src, action, formaction, poster, cite,
//     background) reject javascript:/vbscript:/data:text/html values after
//     ASCII whitespace/control-character normalization
//
// No arbitrary JavaScript execution is possible through attributes: values are
// inert strings, event handlers are impossible by construction, and script-
// capable URL schemes are rejected at every boundary.
//
// Pure, deterministic, framework-independent.
// ---------------------------------------------------------------------------

/** Attribute key/value caps (the shared schema enforces the same limits). */
export const MAX_ATTRIBUTE_NAME_LENGTH = 128;
export const MAX_ATTRIBUTE_VALUE_LENGTH = 2048;

/** HTML attribute name grammar (letter first, then alnum / - _ :). */
export const CUSTOM_ATTRIBUTE_NAME_RE = /^[a-zA-Z][a-zA-Z0-9:_-]*$/;

/** URL-bearing attribute names whose values must never carry script schemes. */
export const URL_BEARING_ATTRIBUTE_NAMES = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "poster",
  "cite",
  "background",
]);

/**
 * Shell/reserved attribute names — the sandbox emission drops these, so
 * authoring them would silently mislead the user. Mirrors the emission
 * allowlist (custom-code/srcdoc.ts FORBIDDEN_ATTR_NAMES).
 */
const RESERVED_ATTRIBUTE_NAMES = new Set(["style", "srcdoc"]);

/** True when the name is an event-handler attribute (normalized "on*"). */
export function isEventHandlerAttributeName(name: string): boolean {
  return name.toLowerCase().startsWith("on");
}

/** True when the name is a URL-bearing attribute needing URL-scheme checks. */
export function isUrlBearingAttributeName(name: string): boolean {
  return URL_BEARING_ATTRIBUTE_NAMES.has(name.toLowerCase());
}

/**
 * Normalize a raw attribute name for storage: trim + lowercase. Returns null
 * when the name is empty or not a well-formed HTML attribute name. Lowercasing
 * is safe normalization (HTML attribute names are case-insensitive) — it never
 * renames one semantic attribute into another.
 */
export function normalizeAttributeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ATTRIBUTE_NAME_LENGTH) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  return CUSTOM_ATTRIBUTE_NAME_RE.test(lower) ? lower : null;
}

/**
 * True when a value carries a script-capable URL scheme. ASCII whitespace and
 * control characters are stripped before the check (the HTML URL parser does
 * the same), so " java\nscript:alert(1)" cannot smuggle a script scheme past
 * the boundary.
 */
export function hasUnsafeUrlScheme(value: string): boolean {
  const normalized = value.replace(/[\u0000-\u0020]/g, "").toLowerCase();
  return (
    normalized.startsWith("javascript:") ||
    normalized.startsWith("vbscript:") ||
    normalized.startsWith("data:text/html")
  );
}

/** True when the value is safe to store for the given (normalized) name. */
export function isSafeAttributeValue(name: string, value: string): boolean {
  if (!isUrlBearingAttributeName(name)) return true;
  return !hasUnsafeUrlScheme(value);
}

/** Problem message for a normalized attribute name (null when acceptable). */
export function attributeNameProblem(name: string): string | null {
  if (isEventHandlerAttributeName(name)) {
    return "Event-handler attributes (names starting with \"on\") are not allowed.";
  }
  if (RESERVED_ATTRIBUTE_NAMES.has(name.toLowerCase())) {
    return `The "${name}" attribute is reserved by the custom-code sandbox and is not allowed.`;
  }
  return null;
}

/** Problem message for a value under a normalized name (null when acceptable). */
export function attributeValueProblem(name: string, value: string): string | null {
  if (isUrlBearingAttributeName(name) && hasUnsafeUrlScheme(value)) {
    return `Values for "${name}" cannot use javascript: or other script-capable URLs.`;
  }
  return null;
}

/**
 * Collect every problem across an attributes record (empty when safe). Each
 * entry is validated independently: malformed names, event handlers, reserved
 * shell attributes, and unsafe URL values for URL-bearing attributes.
 */
export function findCustomCodeAttributeProblems(attributes: unknown): string[] {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
    return [];
  }
  const problems: string[] = [];
  for (const [rawName, rawValue] of Object.entries(attributes as Record<string, unknown>)) {
    const normalized = normalizeAttributeName(rawName);
    if (normalized === null) {
      problems.push(`Attribute name "${rawName}" is not valid.`);
      continue;
    }
    const nameProblem = attributeNameProblem(normalized);
    if (nameProblem) {
      problems.push(nameProblem);
      continue;
    }
    if (typeof rawValue === "string") {
      const valueProblem = attributeValueProblem(normalized, rawValue);
      if (valueProblem) problems.push(valueProblem);
    }
  }
  return problems;
}

/** First problem across an attributes record (null when safe). */
export function firstCustomCodeAttributeProblem(attributes: unknown): string | null {
  return findCustomCodeAttributeProblems(attributes)[0] ?? null;
}
