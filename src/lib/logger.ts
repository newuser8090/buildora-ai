// ---------------------------------------------------------------------------
// Minimal logger — only logs detailed info in development
// Never logs: API keys, full headers, raw model output by default
//
// Phase P19 (F1) — production-safe identifiers. In production the `data`
// payload is NOT logged wholesale (it may contain content or internals), but a
// bounded allow-list of safe identifier keys IS serialized so an operator can
// answer "which workspace/project/session was affected". Everything else in
// `data` remains development-only. In development, full `data` is logged as
// before.
// ---------------------------------------------------------------------------

const isDev = typeof process !== "undefined" && process.env.NODE_ENV === "development";

/**
 * Identifier keys that are safe to surface in production error lines.
 * Only these keys are ever serialized from `data` in production — anything
 * else (content, tokens, prompts, emails, nested objects) stays dev-only.
 */
const PROD_SAFE_KEYS = new Set([
  "workspaceId",
  "projectId",
  "sessionId",
  "clientId",
  "requestId",
  "operationId",
  "code",
  // Bounded error-class token (constructor name / typeof) for mock-route
  // diagnostics — a JS identifier, never content.
  "errorName",
]);

/** Cap on any single safe value — guards against unbounded log growth. */
const MAX_SAFE_VALUE_LENGTH = 128;

/**
 * Make a safe value log-line-safe: bound its length and strip control
 * characters (newlines / carriage returns) so a value can never inject fake
 * log lines (log-injection hardening).
 */
function sanitizeSafeValue(value: string): string {
  const bounded =
    value.length > MAX_SAFE_VALUE_LENGTH
      ? value.slice(0, MAX_SAFE_VALUE_LENGTH)
      : value;
  // Neutralize ALL control characters — C0 (\u0000-\u001f), DEL (\u007f), and
  // C1 (\u0080-\u009f, which includes NEL \u0085 — treated as a line break by
  // some log consumers) — so a value can never break the log line or inject a
  // forged second log entry.
  return bounded.replace(/[\u0000-\u001f\u007f-\u009f]/g, "?");
}

/**
 * Serialize only allow-listed primitive keys from `data` (production path).
 * Nested objects, arrays, Errors, and non-allow-listed keys are never emitted.
 */
function prodSafeContext(data: unknown): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (!PROD_SAFE_KEYS.has(key)) continue;
    if (typeof value === "string") {
      parts.push(`${key}=${sanitizeSafeValue(value)}`);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      parts.push(`${key}=${value}`);
    } else if (typeof value === "boolean") {
      parts.push(`${key}=${value}`);
    }
  }
  if (parts.length === 0) return "";
  return ` {${parts.join(" ")}}`;
}

function log(level: "log" | "warn" | "error", tag: string, message: string, data?: unknown) {
  if (level === "error") {
    // Always log errors, but without full data in production
    if (isDev) {
      console.error(`[${tag}] ${message}`, data ?? "");
    } else {
      console.error(`[${tag}] ${message}${prodSafeContext(data)}`);
    }
    return;
  }

  if (!isDev) return;

  const fn = level === "warn" ? console.warn : console.log;
  fn(`[${tag}] ${message}`, data ?? "");
}

export const logger = {
  info(tag: string, message: string, data?: unknown) {
    log("log", tag, message, data);
  },
  warn(tag: string, message: string, data?: unknown) {
    log("warn", tag, message, data);
  },
  error(tag: string, message: string, data?: unknown) {
    log("error", tag, message, data);
  },
};
