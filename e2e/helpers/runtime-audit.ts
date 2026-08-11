import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Critical React error/warning patterns
// ---------------------------------------------------------------------------

const CRITICAL_PATTERNS = [
  /Objects are not valid as a React child/i,
  /not valid as a React child/i,
  /Minified React error/i,
  /React.*runtime error/i,
  /hydration error/i,
  /hydration mismatch/i,
  /duplicate key/i,
  /controlled.*uncontrolled/i,
  /uncontrolled.*controlled/i,
  /nested interactive/i,
  /Maximum update depth exceeded/i,
  /update loop/i,
  /unhandled rejection/i,
  /uncaught exception/i,
  /Cannot read properties of undefined/i,
  /Cannot read properties of null/i,
  /Cannot destructure/i,
];

const BENIGN_PATTERNS = [
  /WebSocket/i,
  /HMR/i,
  /favicon/i,
  // Expected status responses the app handles deliberately: the public
  // review route returns 404 for invalid tokens and 410 for revoked/expired
  // links — the browser logs the failed load, but the page renders the
  // correct safe message by design. Workspace project saves rejected with
  // 409 (optimistic-concurrency STALE_REVISION) are likewise deliberate — the
  // editor surfaces the safe conflict dialog instead of overwriting. And 403
  // (membership/authorization denials) is the DESIGNED outcome whenever a
  // still-open editor's presence/lease heartbeat or read runs after a member
  // is removed or downgraded — the app transitions to an honest read-only /
  // disconnected state (never fake live data) instead of erroring.
  /Failed to load resource: the server responded with a status of 403/i,
  /Failed to load resource: the server responded with a status of 404/i,
  /Failed to load resource: the server responded with a status of 410/i,
  /Failed to load resource: the server responded with a status of 409/i,
  // Phase P18 (F2) — the collaboration session deliberately logs an
  // authorization-loss DIAGNOSTIC when a still-open editor is downgraded or
  // removed: the permission tests trigger exactly this designed behavior
  // (like the 403 responses above), and the app transitions to the honest
  // read-only state. These are intentional records of a designed transition,
  // never a crash or React error — the audit must not flag them.
  /\[collab\] authorization lost while editing/i,
  /\[collab\] transport authorization error/i,
  /next-dev\.js/i,
  /Download the React DevTools/i,
  /React DevTools/i,
];

// ---------------------------------------------------------------------------
// Audit state
// ---------------------------------------------------------------------------

export interface RuntimeAuditState {
  consoleErrors: string[];
  consoleWarnings: string[];
  pageErrors: string[];
  failedRequests: string[];
  generationRequests: string[];
}

export function createEmptyAudit(): RuntimeAuditState {
  return {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    failedRequests: [],
    generationRequests: [],
  };
}

// ---------------------------------------------------------------------------
// Attach listeners to a page and return state + cleanup function
// ---------------------------------------------------------------------------

export function attachRuntimeAudit(page: Page): {
  state: RuntimeAuditState;
  detach: () => void;
} {
  const state = createEmptyAudit();

  const onConsole = (msg: { type: () => string; text: () => string }) => {
    if (msg.type() === "error") {
      state.consoleErrors.push(msg.text());
    }
    if (msg.type() === "warning") {
      state.consoleWarnings.push(msg.text());
    }
  };

  const onPageError = (err: Error) => {
    state.pageErrors.push(err.message);
  };

  const onRequestFailed = (req: { url: () => string; failure: () => { errorText: string } | null }) => {
    state.failedRequests.push(`${req.url()} — ${req.failure()?.errorText ?? "unknown"}`);
  };

  const onRequest = (req: { url: () => string }) => {
    if (req.url().includes("/api/generate")) {
      state.generationRequests.push(req.url());
    }
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("requestfailed", onRequestFailed);
  page.on("request", onRequest);

  return {
    state,
    detach: () => {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      page.off("requestfailed", onRequestFailed);
      page.off("request", onRequest);
    },
  };
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/** Assert the runtime audit found no critical errors. */
export function assertRuntimeClean(state: RuntimeAuditState): void {
  // Filter benign errors
  const isBenign = (msg: string) =>
    BENIGN_PATTERNS.some((p) => p.test(msg));

  const criticalConsoleErrors = state.consoleErrors.filter((e) => !isBenign(e));

  // Check for React-specific critical patterns in warnings
  const criticalWarnings = state.consoleWarnings.filter((w) =>
    CRITICAL_PATTERNS.some((p) => p.test(w)),
  );

  const allCritical = [
    ...criticalConsoleErrors.map((e) => `console.error: ${e}`),
    ...criticalWarnings.map((w) => `console.warning: ${w}`),
    ...state.pageErrors.map((e) => `pageerror: ${e}`),
  ];

  // Filter failed requests - only flag generation-related failures
  const criticalFailedRequests = state.failedRequests.filter(
    (r) => r.includes("/api/generate") || !isBenign(r),
  );

  const violations = [
    ...allCritical,
    ...criticalFailedRequests.map((r) => `requestfailed: ${r}`),
  ];

  expect(violations).toEqual([]);
}

/** Assert exactly N generation requests occurred. */
export function assertGenerationRequests(
  state: RuntimeAuditState,
  expectedCount: number,
): void {
  expect(state.generationRequests.length).toBe(expectedCount);
}

/** Assert NO generation requests occurred. */
export function assertNoGenerationRequests(state: RuntimeAuditState): void {
  expect(state.generationRequests.length).toBe(0);
}

/** Assert no failed generation requests. */
export function assertNoFailedRequests(state: RuntimeAuditState): void {
  const genFailures = state.failedRequests.filter((r) =>
    r.includes("/api/generate"),
  );
  expect(genFailures).toEqual([]);
}
