// ---------------------------------------------------------------------------
// Minimal logger — only logs detailed info in development
// Never logs: API keys, full headers, raw model output by default
// ---------------------------------------------------------------------------

const isDev = typeof process !== "undefined" && process.env.NODE_ENV === "development";

function log(level: "log" | "warn" | "error", tag: string, message: string, data?: unknown) {
  if (level === "error") {
    // Always log errors, but without full data in production
    if (isDev) {
      console.error(`[${tag}] ${message}`, data ?? "");
    } else {
      console.error(`[${tag}] ${message}`);
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
