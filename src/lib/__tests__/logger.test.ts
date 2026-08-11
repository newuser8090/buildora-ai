// ---------------------------------------------------------------------------
// Phase P19 (F1) — logger safe-identifier allow-list
//
// In production, `data` must NEVER be logged wholesale — only a bounded
// allow-list of safe identifier keys may survive, and even those are
// truncated to a fixed length. In development, full `data` is logged as
// before, and info/warn stay dev-only. These tests lock the production
// redaction contract so a future change cannot accidentally start leaking
// content, tokens, prompts, or emails.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The logger reads NODE_ENV at module load. We re-import it (via dynamic
// import after resetModules) so each describe block sees the env it sets.
async function freshLogger(): Promise<typeof import("../logger").logger> {
  vi.resetModules();
  const mod = await import("../logger");
  return mod.logger;
}

describe("logger — production redaction (P19 F1)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Ensure NODE_ENV is NOT "development" (vitest sets "test" already).
    vi.stubEnv("NODE_ENV", "test");
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("logs the message with allow-listed identifiers but strips everything else", async () => {
    const logger = await freshLogger();
    logger.error("collab", "checkpoint failed (STALE_REVISION)", {
      workspaceId: "ws-1",
      projectId: "proj-1",
      clientId: "client-9",
      // Must NEVER appear in production output:
      token: "secret-token-123",
      email: "user@example.com",
      project: { name: "full content" },
      prompt: "Rewrite my entire site",
      error: new Error("stack trace"),
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [line] = errorSpy.mock.calls[0] as [string];
    expect(line).toContain("[collab] checkpoint failed (STALE_REVISION)");
    expect(line).toContain("workspaceId=ws-1");
    expect(line).toContain("projectId=proj-1");
    expect(line).toContain("clientId=client-9");
    // Nothing sensitive survives.
    expect(line).not.toContain("secret-token-123");
    expect(line).not.toContain("user@example.com");
    expect(line).not.toContain("full content");
    expect(line).not.toContain("Rewrite my entire site");
    expect(line).not.toContain("stack trace");
  });

  it("truncates over-long safe values to the fixed cap", async () => {
    const logger = await freshLogger();
    const long = "x".repeat(500);
    logger.error("persist", "save failed (QUOTA)", {
      workspaceId: long,
      projectId: "proj-1",
    });

    const [line] = errorSpy.mock.calls[0] as [string];
    // The value is truncated — the full 500 chars never appear.
    expect(line).not.toContain("x".repeat(500));
    // A bounded slice is present.
    expect(line).toMatch(/workspaceId=x{128}/);
  });

  it("does not serialize non-primitives (nested objects, arrays, booleans only as scalars)", async () => {
    const logger = await freshLogger();
    logger.error("api", "unhandled error (UNKNOWN)", {
      workspaceId: "ws-1",
      nested: { workspaceId: "inner-ws" },
      list: ["a", "b"],
      code: "UNKNOWN",
      errorName: "TypeError",
    });

    const [line] = errorSpy.mock.calls[0] as [string];
    expect(line).toContain("workspaceId=ws-1");
    expect(line).toContain("code=UNKNOWN");
    // The bounded error-class token survives production redaction (mock-route
    // diagnostics rely on it for diagnosability).
    expect(line).toContain("errorName=TypeError");
    // Nested objects and arrays are never flattened into the line.
    expect(line).not.toContain("inner-ws");
    expect(line).not.toContain('"list"');
    expect(line).not.toContain("a,b");
  });

  it("emits no safe-context suffix when data has no allow-listed keys", async () => {
    const logger = await freshLogger();
    logger.error("collab", "transport authorization error", {
      token: "should-not-appear",
    });

    const [line] = errorSpy.mock.calls[0] as [string];
    expect(line).toBe("[collab] transport authorization error");
  });

  it("accepts string data payloads without crashing (dev-style call sites)", async () => {
    const logger = await freshLogger();
    logger.error("API", "Unexpected error", "raw message");

    const [line] = errorSpy.mock.calls[0] as [string];
    expect(line).toBe("[API] Unexpected error");
  });

  it("neutralizes control characters so values cannot inject log lines (P19 security)", async () => {
    const logger = await freshLogger();
    logger.error("collab", "checkpoint failed (UNKNOWN)", {
      workspaceId: "ws\nFAKE[collab] injected error\r\n1",
      projectId: "proj-1",
    });

    // Exactly one log call — the forged text can never become a second
    // console.error entry.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [line] = errorSpy.mock.calls[0] as [string];
    // No raw newline or carriage return ever reaches the log line.
    expect(line).not.toContain("\n");
    expect(line).not.toContain("\r");
    // The value is preserved as a single sanitized token.
    expect(line).toContain("workspaceId=ws?FAKE[collab] injected error??1");
    expect(line).toContain("projectId=proj-1");
  });

  it("neutralizes C1 control characters too (NEL is a line break to some consumers)", async () => {
    const logger = await freshLogger();
    // U+0085 (NEL) and U+009F (C1 control) must not survive into the line.
    logger.error("collab", "checkpoint failed (UNKNOWN)", {
      workspaceId: "ws\u0085FAKE\u009f1",
    });

    const [line] = errorSpy.mock.calls[0] as [string];
    expect(line).toContain("workspaceId=ws?FAKE?1");
    expect(line).not.toContain("\u0085");
    expect(line).not.toContain("\u009f");
  });

  it("serializes finite numbers and booleans under allow-listed keys as scalars", async () => {
    const logger = await freshLogger();
    logger.error("persist", "save failed (QUOTA)", {
      workspaceId: "ws-1",
      code: 404, // number under an allow-listed key
      sessionId: true, // boolean under an allow-listed key
      retryable: true, // NOT allow-listed → dropped even as a scalar
      // Non-finite numbers under allow-listed keys must never serialize.
      requestId: Infinity,
      clientId: NaN,
    });

    const [line] = errorSpy.mock.calls[0] as [string];
    expect(line).toContain("workspaceId=ws-1");
    expect(line).toContain("code=404");
    expect(line).toContain("sessionId=true");
    // Non-allow-listed keys are dropped even for scalar primitives.
    expect(line).not.toContain("retryable=true");
    // Non-finite numbers never serialize.
    expect(line).not.toContain("Infinity");
    expect(line).not.toContain("NaN");
  });
});

describe("logger — development behavior (unchanged)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("logs full data in development (errors)", async () => {
    const logger = await freshLogger();
    logger.error("persist", "autosave failed (QUOTA)", {
      projectId: "proj-1",
      token: "dev-only-secret",
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    // Dev logs the full data payload as the second argument.
    const [line, data] = errorSpy.mock.calls[0] as [string, unknown];
    expect(line).toBe("[persist] autosave failed (QUOTA)");
    expect(data).toEqual({ projectId: "proj-1", token: "dev-only-secret" });
  });

  it("logs info and warn in development", async () => {
    const logger = await freshLogger();
    logger.info("API", "attempting", { attempt: 1 });
    logger.warn("GeminiProvider", "schema issue", { issues: [] });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe("logger — production silence for info/warn", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("does not emit info or warn in production", async () => {
    const logger = await freshLogger();
    logger.info("API", "noisy detail");
    logger.warn("API", "noisy warning");

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
