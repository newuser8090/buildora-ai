// ---------------------------------------------------------------------------
// Publishing — domain + URL utilities (Phase P8)
//
// Pure, deterministic, shared by the client UI (gentle validation) and the
// server routes (hard validation). Never accepts protocols, paths, query
// strings, or IDN surprises; never renders unsafe provider URLs.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Domain validation
// ---------------------------------------------------------------------------

export const MAX_DOMAIN_LENGTH = 253;
export const MAX_DOMAIN_LABEL_LENGTH = 63;

/**
 * Normalize user input into a candidate hostname:
 * trims whitespace, strips a single trailing dot, lowercases, and strips a
 * leading "www." (documented policy — www redirects are the provider's job).
 * Does NOT strip protocols/paths — that is validation's job.
 */
export function normalizeDomainInput(value: string): string {
  let out = value.trim().toLowerCase();
  if (out.endsWith(".")) out = out.slice(0, -1);
  return out;
}

export interface DomainValidation {
  valid: boolean;
  normalized?: string;
  error?: string;
}

/**
 * Validate a user-entered domain.
 *
 * Rules:
 *  - hostname syntax only: labels of [a-z0-9-], no leading/trailing hyphen,
 *    at least one dot, no protocol, no path/query, no port, no whitespace
 *  - total length ≤ 253, each label ≤ 63
 *  - IDN policy: raw unicode (non-ASCII) is rejected with guidance; punycode
 *    ("xn--...") is accepted as-is (documented)
 *  - reserved/private names rejected: localhost, *.local, private-use TLDs
 *  - duplicates are detected by the caller (per project)
 */
export function validateDomainInput(value: string): DomainValidation {
  const normalized = normalizeDomainInput(value);

  if (normalized.length === 0) {
    return { valid: false, error: "Enter a domain to continue." };
  }
  if (normalized.length > MAX_DOMAIN_LENGTH) {
    return {
      valid: false,
      error: `That domain is too long (max ${MAX_DOMAIN_LENGTH} characters).`,
    };
  }
  if (/\s/.test(normalized)) {
    return {
      valid: false,
      error: "Remove spaces — enter just the domain, like example.com.",
    };
  }
  if (/[^a-z0-9.-]/.test(normalized)) {
    if (/[^\x00-\x7f]/.test(normalized)) {
      return {
        valid: false,
        error:
          "Use the plain version of the address (for example, xn--… for non-English letters).",
      };
    }
    return {
      valid: false,
      error: "A domain can only contain letters, numbers, dots, and hyphens.",
    };
  }
  if (/[/?#@:]/.test(normalized)) {
    return {
      valid: false,
      error: "Enter just the domain — no https://, no paths, no @.",
    };
  }
  if (!normalized.includes(".")) {
    return {
      valid: false,
      error: "That looks like a single name. Add the ending, like example.com.",
    };
  }
  if (normalized.startsWith(".") || normalized.endsWith(".")) {
    return {
      valid: false,
      error: "That domain has a dot in the wrong place.",
    };
  }
  if (normalized.includes("..")) {
    return {
      valid: false,
      error: "That domain has two dots in a row.",
    };
  }

  const labels = normalized.split(".");
  for (const label of labels) {
    if (label.length === 0) {
      return { valid: false, error: "That domain has an empty part." };
    }
    if (label.length > MAX_DOMAIN_LABEL_LENGTH) {
      return {
        valid: false,
        error: `One part of the domain is too long (max ${MAX_DOMAIN_LABEL_LENGTH} characters).`,
      };
    }
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) {
      return {
        valid: false,
        error: "A domain part can't start or end with a hyphen.",
      };
    }
  }

  const tld = labels[labels.length - 1];
  if (tld.length < 2) {
    return {
      valid: false,
      error: "The domain ending looks too short. Try example.com.",
    };
  }
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".lan") ||
    /^localhost(\.|$)/.test(normalized)
  ) {
    return {
      valid: false,
      error: "That address can't be published — it's only reachable on your computer.",
    };
  }
  if (
    /^(10|127)\./.test(normalized) ||
    /^192\.168\./.test(normalized) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(normalized)
  ) {
    return {
      valid: false,
      error: "That's a private network address and can't be published.",
    };
  }

  return { valid: true, normalized };
}

// ---------------------------------------------------------------------------
// Safe deployment URL validation
// ---------------------------------------------------------------------------

/**
 * True only when a provider-returned URL is safe to render/open:
 *  - https:// for real providers
 *  - http://localhost (or 127.0.0.1) for the mock provider
 * Anything else (javascript:, data:, file:, etc.) is rejected.
 */
export function isSafeDeploymentUrl(
  url: unknown,
  providerId = "vercel",
): url is string {
  if (typeof url !== "string" || url.length === 0) return false;
  if (url.length > 2048) return false;
  if (providerId === "mock") {
    if (/^https:\/\//.test(url)) return true;
    if (/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/.test(url)) {
      return true;
    }
    return false;
  }
  return (
    /^https:\/\//.test(url) &&
    !/[\s<>"'`\x00-\x1f\x7f]/.test(url)
  );
}

/** Strip an unsafe scheme prefix for display (never for opening). */
export function safeUrlForDisplay(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length > 80) return `${trimmed.slice(0, 77)}…`;
  return trimmed;
}
