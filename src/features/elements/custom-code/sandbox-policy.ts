// ---------------------------------------------------------------------------
// Sandbox policy (Phase P23-B) — the single authoritative capability model
//
// The runtime grants EXACTLY ONE capability: `allow-scripts`. The iframe gets
// an opaque origin (no allow-same-origin) and no navigation/popup/form/modal/
// download capabilities. Everything the custom code can do is bounded by this
// policy — it cannot reach the parent document, cookies, storage, or any
// credentialed context.
//
// Hardening property: the only way to obtain a sandbox attribute string is
// `buildSandboxPolicy`, which THROWS on any capability outside the allow-list
// and on any missing `allow-scripts`. Adding a capability therefore requires
// an explicit edit to `ALLOWED_SANDBOX_CAPABILITIES` — it cannot slip in as a
// free-form string.
//
// Pure, deterministic, framework-independent (no DOM access).
// ---------------------------------------------------------------------------

/** The ONLY capabilities the runtime may ever grant. */
export const ALLOWED_SANDBOX_CAPABILITIES = ["allow-scripts"] as const;

export type SandboxCapability = (typeof ALLOWED_SANDBOX_CAPABILITIES)[number];

/**
 * Capabilities that would break the isolation boundary if ever granted.
 * Listed explicitly (not computed as a negation) so an accidental addition is
 * caught by the tests rather than silently tolerated.
 */
export const FORBIDDEN_SANDBOX_CAPABILITIES = [
  "allow-same-origin",
  "allow-top-navigation",
  "allow-top-navigation-by-user-activation",
  "allow-top-navigation-to-custom-protocols",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-forms",
  "allow-downloads",
  "allow-modals",
  "allow-pointer-lock",
  "allow-presentation",
  "allow-storage-access-by-user-activation",
] as const;

/** The canonical sandbox attribute value (buildable only via the factory). */
export const SANDBOX_POLICY = "allow-scripts";

export function isAllowedSandboxCapability(value: string): value is SandboxCapability {
  return (ALLOWED_SANDBOX_CAPABILITIES as readonly string[]).includes(value);
}

/**
 * Validate an existing policy string. Throws on forbidden/unknown tokens or
 * when `allow-scripts` is missing. Used for assertions/tests and as the
 * guard before any policy string is used at runtime.
 */
export function assertSafeSandboxPolicy(policy: string): void {
  const tokens = policy.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    throw new Error("Sandbox policy must include allow-scripts");
  }
  for (const token of tokens) {
    if (!isAllowedSandboxCapability(token)) {
      throw new Error(`Forbidden sandbox capability: "${token}"`);
    }
  }
  if (!tokens.includes("allow-scripts")) {
    throw new Error("Sandbox policy must include allow-scripts");
  }
}

/**
 * Build a validated sandbox attribute string from the allowed capability set.
 * Throws on any forbidden/unknown capability and on a missing allow-scripts,
 * so it is impossible to accidentally produce an unsafe policy.
 */
export function buildSandboxPolicy(
  capabilities: readonly string[] = ALLOWED_SANDBOX_CAPABILITIES,
): string {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const capability of capabilities) {
    if (!isAllowedSandboxCapability(capability)) {
      throw new Error(`Forbidden sandbox capability: "${capability}"`);
    }
    if (!seen.has(capability)) {
      seen.add(capability);
      tokens.push(capability);
    }
  }
  if (!seen.has("allow-scripts")) {
    throw new Error("Sandbox policy must include allow-scripts");
  }
  return tokens.join(" ");
}
