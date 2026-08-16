// ---------------------------------------------------------------------------
// Custom-code runtime foundation (Phase P23-B) + runtime controller (P23-G)
// + runtime observability (P23-H)
//
// Pure, framework-independent building blocks for the sandboxed runtime:
//   - constants        — centralized security-sensitive values
//   - sandbox-policy   — the authoritative iframe capability model
//   - srcdoc           — the sandbox document builder (incl. child shell)
//   - message-protocol — the minimal parent/child channel
//   - heartbeat        — the bounded unresponsive-frame detector
//   - diagnostics      — typed, sanitized, bounded runtime diagnostics (P23-H)
//   - runtime          — the parent-side runtime controller (P23-G/H): instance
//                        lifecycle, message validation, heartbeat integration,
//                        bounded recovery, idempotent disposal, safe
//                        observability (diagnostics + read-only snapshot)
//
// Nothing here executes custom code in the editor; execution lives only in
// the published export's sandboxed iframe (P23-C), whose runtime mirrors the
// controller semantics.
// ---------------------------------------------------------------------------

export * from "./constants";
export * from "./sandbox-policy";
export * from "./srcdoc";
export * from "./message-protocol";
export * from "./heartbeat";
export * from "./diagnostics";
export * from "./runtime";
