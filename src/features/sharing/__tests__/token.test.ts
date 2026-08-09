// ---------------------------------------------------------------------------
// Share Links & Review Experience (Phase P12) — token tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  SHARE_TOKEN_BYTES,
  createShareToken,
  hashShareToken,
  hashShareTokenSync,
  isValidShareToken,
  type ShareTokenRng,
} from "../token";

function fixedRng(byte: number): ShareTokenRng {
  return () => new Uint8Array(SHARE_TOKEN_BYTES).fill(byte);
}

describe("createShareToken", () => {
  it("produces a 43-character base64url token (256 bits from 32 bytes)", () => {
    const token = createShareToken();
    expect(token.length).toBe(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toContain("+");
    expect(token).not.toContain("/");
    expect(token).not.toContain("=");
  });

  it("tokens are unique across many creations (unguessable, non-sequential)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const token = createShareToken();
      expect(seen.has(token)).toBe(false);
      seen.add(token);
    }
  });

  it("honors an injectable RNG (deterministic tests)", () => {
    const token = createShareToken(fixedRng(7));
    expect(token).toBe(createShareToken(fixedRng(7)));
    expect(token).not.toBe(createShareToken(fixedRng(8)));
  });

  it("throws when the RNG produces the wrong byte length", () => {
    expect(() => createShareToken(() => new Uint8Array(8))).toThrow();
  });

  it("never derives from a project id (different project ids, same RNG → same token is RNG-dependent only)", () => {
    // The token API has no project-id input at all — the point is that a
    // token carries no project identity that could be guessed.
    const a = createShareToken(fixedRng(1));
    const b = createShareToken(fixedRng(1));
    expect(a).toBe(b); // same RNG, same token — determinism, not derivation
  });
});

describe("isValidShareToken", () => {
  it("accepts real tokens", () => {
    expect(isValidShareToken(createShareToken())).toBe(true);
  });

  it("rejects wrong shapes", () => {
    expect(isValidShareToken("")).toBe(false);
    expect(isValidShareToken("short")).toBe(false);
    expect(isValidShareToken("a".repeat(100))).toBe(false);
    expect(isValidShareToken("a".repeat(43))).toBe(true);
  });

  it("rejects tokens with characters outside the base64url alphabet", () => {
    const token = createShareToken();
    const bad = `a${token.slice(1)}`.replace("a", "+");
    expect(isValidShareToken(bad)).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isValidShareToken(null)).toBe(false);
    expect(isValidShareToken(42)).toBe(false);
    expect(isValidShareToken(undefined)).toBe(false);
  });
});

describe("hashShareToken", () => {
  it("produces a stable 64-char hex SHA-256", async () => {
    const token = createShareToken();
    const hash = await hashShareToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashShareToken(token)).toBe(hash);
  });

  it("different tokens hash differently", async () => {
    const a = await hashShareToken(createShareToken(fixedRng(1)));
    const b = await hashShareToken(createShareToken(fixedRng(2)));
    expect(a).not.toBe(b);
  });

  it("the sync hash matches the async hash (mock backend parity)", async () => {
    const token = createShareToken();
    expect(hashShareTokenSync(token)).toBe(await hashShareToken(token));
  });

  it("hashes are not reversible into the raw token", async () => {
    const token = createShareToken();
    const hash = await hashShareToken(token);
    expect(hash).not.toContain(token);
  });
});
