// ---------------------------------------------------------------------------
// Custom-code runtime foundation (Phase P23-B) + runtime controller (P23-G)
//
// Pure, framework-independent building blocks for the sandboxed runtime:
//   - constants        — centralized security-sensitive values
//   - sandbox-policy   — the authoritative iframe capability model
//   - srcdoc           — the sandbox document builder (incl. child shell)
//   - message-protocol — the minimal parent/child channel
//   - heartbeat        — the bounded unresponsive-frame detector
//   - runtime          — the parent-side runtime controller (P23-G): instance
//                        lifecycle, message validation, heartbeat integration,
//                        bounded recovery, idempotent disposal
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
export * from "./runtime";
