// ---------------------------------------------------------------------------
// Security headers (Phase P20 — release hardening)
//
// Standard, safe production headers applied to every response via
// next.config.ts. Chosen to never break the app:
//   - X-Content-Type-Options: nosniff     — no MIME-type sniffing
//   - X-Frame-Options: DENY               — the app is never embedded in a
//     frame (no iframe usage anywhere in the codebase), so framing is denied
//   - Referrer-Policy: strict-origin-when-cross-origin — never leak full
//     URLs across origins; same-origin behavior unchanged
//   - Permissions-Policy: camera/mic/geolocation disabled — the app uses
//     none of them
//   - X-DNS-Prefetch-Control: off         — no prefetch of link targets
//
// A Content-Security-Policy is deliberately NOT set here: Next.js injects
// inline hydration scripts/styles that would require a carefully maintained
// nonce/hash allow-list, and an incorrect CSP would break the production
// build. CSP is documented as a P3 future enhancement (P20 report §remaining
// risks) — the safe header subset above is the release-scoped improvement.
// ---------------------------------------------------------------------------

export interface SecurityHeader {
  key: string;
  value: string;
}

export const SECURITY_HEADERS: readonly SecurityHeader[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
] as const;
