import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  // Phase P20 — release hardening: apply the safe, standard security headers
  // (nosniff / X-Frame-Options / Referrer-Policy / Permissions-Policy /
  // DNS-prefetch) to every response. Defined in src/lib/security-headers.ts
  // so the exact list is unit-tested. A Content-Security-Policy is
  // deliberately NOT included (Next.js injects inline hydration scripts and
  // styles that would require a carefully maintained nonce/hash allow-list) —
  // documented as a P3 future enhancement in the P20 report.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [...SECURITY_HEADERS],
      },
    ];
  },
};

export default nextConfig;
