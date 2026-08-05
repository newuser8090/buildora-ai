// ---------------------------------------------------------------------------
// Safe URL policy (Phase P1)
//
// Pure, deterministic URL validation for link-like and image-like attribute
// values. No downloads, no fetching — classification only.
//
// Links allow: relative paths, hash anchors, protocol-relative, https, http,
// mailto, tel.
// Links reject: javascript:, vbscript:, file:, data:, control-character
// obfuscated schemes, malformed percent-encoded schemes, null-byte variants.
//
// Images allow: https, http. Safe data:image URLs are documented but NOT
// enabled in P1 (they require the existing size limits to be opt-in).
// ---------------------------------------------------------------------------

export type SafeUrlKind = "link" | "image";

/** Allowed schemes per kind. */
const ALLOWED_SCHEMES: Record<SafeUrlKind, ReadonlySet<string>> = {
  link: new Set(["https", "http", "mailto", "tel"]),
  image: new Set(["https", "http"]),
};

/**
 * Normalize a URL the way a lenient browser would before scheme extraction:
 * strip tabs/newlines/carriage returns and percent-decode so obfuscated
 * schemes ("java%0ascript:", "java\nscript:") are surfaced. Returns null when
 * the raw string contains control characters or null bytes (reject outright).
 */
function normalizeForScheme(raw: string): string | null {
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if (code === 0 || code < 0x20 || code === 0x7f) {
      return null; // raw control characters / null bytes → obfuscation attempt
    }
  }
  const stripped = raw.replace(/[\t\n\r ]/g, "");
  let decoded: string;
  try {
    // Decode percent-encoded bytes so obfuscated schemes like "java%73cript:"
    // and "java%0ascript:" are surfaced. TextEncoder is available in Node
    // and browsers.
    const bytes = new TextEncoder().encode(stripped);
    decoded = decodeURIComponent(
      bytes.reduce((acc, byte) => acc + String.fromCharCode(byte), ""),
    );
  } catch {
    // Malformed percent-encoding: decode what we can, character by character.
    decoded = stripped.replace(/%([0-9a-fA-F]{2})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
  }
  // A percent-encoded control character inside the URL (e.g. %0a in the
  // scheme region) is obfuscation — reject.
  for (let i = 0; i < decoded.length; i += 1) {
    const code = decoded.charCodeAt(i);
    if (code === 0 || code < 0x20 || code === 0x7f) {
      return null;
    }
  }
  return decoded.replace(/[\t\n\r ]/g, "");
}

function extractScheme(url: string): { scheme: string; rest: string } | null {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/.exec(url);
  if (!match) return null;
  return { scheme: match[1].toLowerCase(), rest: match[2] };
}

/**
 * Describe why a URL is unsafe, or return null when it is safe for the given
 * kind. Deterministic and pure.
 */
export function unsafeUrlReason(url: string, kind: SafeUrlKind = "link"): string | null {
  if (typeof url !== "string" || url.trim().length === 0) {
    // Empty/whitespace-only URLs carry no executable scheme — safe.
    return null;
  }

  const normalized = normalizeForScheme(url);
  if (normalized === null) {
    return "control-character-or-null-byte-in-url";
  }

  const extracted = extractScheme(normalized);
  if (extracted === null) {
    // No valid scheme. Reject malformed encoded schemes that could still be
    // interpreted as an obfuscated executable scheme by a lenient browser.
    const firstColon = normalized.indexOf(":");
    if (firstColon > 0) {
      const candidate = normalized.slice(0, firstColon);
      if (candidate.includes("%") || candidate.includes("\\")) {
        return "malformed-encoded-scheme";
      }
    }
    // Otherwise: relative path, hash anchor, query or protocol-relative "//".
    return null;
  }

  const { scheme, rest } = extracted;
  const allowed = ALLOWED_SCHEMES[kind];

  if (allowed.has(scheme)) {
    return null;
  }

  if (scheme === "javascript" || scheme === "vbscript" || scheme === "file") {
    return `forbidden-scheme:${scheme}`;
  }

  if (scheme === "data") {
    if (kind === "image" && rest.startsWith("image/")) {
      return "data-image-not-enabled";
    }
    return `forbidden-scheme:${scheme}`;
  }

  // mailto/tel are only safe for links; other schemes are rejected.
  if (kind === "link") {
    return `unsupported-scheme:${scheme}`;
  }
  return `unsupported-scheme:${scheme}`;
}

/** True when the URL is safe for the given kind. */
export function isSafeUrl(url: string, kind: SafeUrlKind = "link"): boolean {
  return unsafeUrlReason(url, kind) === null;
}
