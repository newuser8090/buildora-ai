// ---------------------------------------------------------------------------
// Custom-code runtime foundation (Phase P23-B)
//
// Pure, framework-independent building blocks for the sandboxed runtime:
//   - constants        — centralized security-sensitive values
//   - sandbox-policy   — the authoritative iframe capability model
//   - srcdoc           — the sandbox document builder
//   - message-protocol — the minimal parent/child channel
//   - heartbeat        — the bounded unresponsive-frame detector
//
// Nothing here executes custom code and nothing is wired into any renderer,
// export generator, or editor surface yet (that is P23-C/D).
// ---------------------------------------------------------------------------

export * from "./constants";
export * from "./sandbox-policy";
export * from "./srcdoc";
export * from "./message-protocol";
export * from "./heartbeat";
