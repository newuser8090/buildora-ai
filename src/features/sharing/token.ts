// ---------------------------------------------------------------------------
// Share Links & Review Experience (Phase P12) — token utilities
//
// Share tokens are the review capability itself (like an unlisted link):
//   - 32 random bytes (256 bits of entropy), base64url-encoded
//   - non-sequential, never derived from the project id, never a privileged
//     credential (no account authority is carried by the token)
//   - only a SHA-256 HASH of the token is ever stored server-side, so a
//     database leak cannot be replayed
//   - the raw token is returned to the owner exactly once (at creation /
//     regeneration time)
//
// Works in the browser and in Node (mock backend). The RNG is injectable for
// deterministic unit tests.
// ---------------------------------------------------------------------------

// Base64url alphabet — no padding, no '+'/'/' (URL-safe).
const TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Number of random bytes backing one token (32 bytes = 256 bits). */
export const SHARE_TOKEN_BYTES = 32;

export type ShareTokenRng = () => Uint8Array;

function defaultRng(): Uint8Array {
  const bytes = new Uint8Array(SHARE_TOKEN_BYTES);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
    return bytes;
  }
  // Node without webcrypto global (defensive; Node 18+ exposes it).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomBytes } = require("node:crypto") as typeof import("node:crypto");
  return randomBytes(SHARE_TOKEN_BYTES);
}

function toBase64Url(bytes: Uint8Array): string {
  // Standard base64url without padding: 3 bytes → 4 chars, every bit used,
  // so 32 bytes encode to 43 chars (256 bits of entropy preserved).
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += TOKEN_ALPHABET[b0 >> 2];
    out += TOKEN_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += TOKEN_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += TOKEN_ALPHABET[b2 & 0x3f];
  }
  return out;
}

/**
 * Create a new unguessable share token. `rng` is injectable for tests;
 * production always uses the platform CSPRNG.
 */
export function createShareToken(rng?: ShareTokenRng): string {
  const bytes = (rng ?? defaultRng)();
  if (bytes.length !== SHARE_TOKEN_BYTES) {
    throw new Error("Share token RNG must produce exactly 32 bytes");
  }
  return toBase64Url(bytes);
}

/**
 * Validate a token's shape before hashing/lookup. Format check only — real
 * authorization is the server-side hash lookup with status/expiry checks.
 */
export function isValidShareToken(token: unknown): token is string {
  if (typeof token !== "string") return false;
  if (token.length < 40 || token.length > 64) return false;
  for (let i = 0; i < token.length; i++) {
    if (TOKEN_ALPHABET.indexOf(token[i]) === -1) return false;
  }
  return true;
}

/**
 * SHA-256 hash of the raw token. This is what is stored/looked up
 * server-side. Node (mock backend) and browsers both supported.
 */
export async function hashShareToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.subtle?.digest === "function"
  ) {
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Node fallback (crypto.subtle unavailable — non-secure context).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(token).digest("hex");
}

/** Synchronous SHA-256 for the mock backend route handlers. */
export function hashShareTokenSync(token: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(token).digest("hex");
}
