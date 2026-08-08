// ---------------------------------------------------------------------------
// Publishing — ProviderHttpClient tests (Phase P8)
//
// Security posture verified with an injected fetch:
//   - fixed base, no user-controlled URLs
//   - redirects are errors (no SSRF-style following)
//   - request timeout → structured NETWORK_FAILED
//   - provider host allow-list for upload URLs
//   - provider status → structured publish error mapping
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import {
  NodeFetchProviderHttpClient,
  providerStatusError,
  isAllowedProviderHost,
  DEFAULT_PROVIDER_BASE_URL,
  MAX_RESPONSE_BYTES,
} from "../provider-http-client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ProviderHttpClient — transport", () => {
  it("rejects non-https URLs outright", async () => {
    const fetchImpl = vi.fn();
    const client = new NodeFetchProviderHttpClient({ fetchImpl });
    await expect(
      client.request({ method: "GET", url: "http://evil.example/x" }),
    ).rejects.toMatchObject({ code: "NETWORK_FAILED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects upload URLs on hosts outside the provider allow-list", async () => {
    const fetchImpl = vi.fn();
    const client = new NodeFetchProviderHttpClient({ fetchImpl });
    await expect(
      client.request({
        method: "PUT",
        url: "https://attacker.example.com/upload",
        body: new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toMatchObject({ code: "NETWORK_FAILED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("allows provider-hosted upload URLs", async () => {
    expect(isAllowedProviderHost("api.vercel.com")).toBe(true);
    expect(isAllowedProviderHost("upload.vercel.com")).toBe(true);
    expect(isAllowedProviderHost("files.vercel-storage.com")).toBe(true);
    expect(isAllowedProviderHost("api.vercel.com.evil.example")).toBe(false);
    expect(isAllowedProviderHost("evil.example")).toBe(false);
  });

  it("never follows redirects", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("redirect:error would throw in a real fetch");
    });
    const client = new NodeFetchProviderHttpClient({ fetchImpl });
    await expect(
      client.request({ method: "GET", url: "https://api.vercel.com/x" }),
    ).rejects.toMatchObject({ code: "NETWORK_FAILED" });
  });

  it("maps a timeout abort to a structured error", async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    const client = new NodeFetchProviderHttpClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 10,
    });
    await expect(
      client.request({ method: "GET", url: "https://api.vercel.com/x" }),
    ).rejects.toMatchObject({ code: "NETWORK_FAILED" });
  });

  it("parses JSON bodies and keeps headers", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { readyState: "READY" }),
    );
    const client = new NodeFetchProviderHttpClient({ fetchImpl });
    const res = await client.request({ method: "GET", url: "https://api.vercel.com/x" });
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect((res.json as { readyState: string }).readyState).toBe("READY");
    expect(res.headers["content-type"]).toContain("application/json");
  });

  it("treats malformed JSON as null instead of throwing", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("not-json{{{", { status: 200 }),
    );
    const client = new NodeFetchProviderHttpClient({ fetchImpl });
    const res = await client.request({ method: "GET", url: "https://api.vercel.com/x" });
    expect(res.json).toBeNull();
  });

  it("rejects oversized responses past the hard size cap", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("x".repeat(MAX_RESPONSE_BYTES + 1), { status: 200 }),
    );
    const client = new NodeFetchProviderHttpClient({ fetchImpl });
    await expect(
      client.request({ method: "GET", url: "https://api.vercel.com/x" }),
    ).rejects.toMatchObject({ code: "NETWORK_FAILED" });
  });

  it("accepts responses at the size cap boundary", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("x".repeat(MAX_RESPONSE_BYTES), { status: 200 }),
    );
    const client = new NodeFetchProviderHttpClient({ fetchImpl });
    const res = await client.request({ method: "GET", url: "https://api.vercel.com/x" });
    expect(res.status).toBe(200);
    expect(res.json).toBeNull();
  });
});

describe("providerStatusError — mapping", () => {
  it("maps 401/403 to PROVIDER_AUTH_FAILED", () => {
    expect(providerStatusError(401, "deploy").code).toBe("PROVIDER_AUTH_FAILED");
    expect(providerStatusError(403, "domain").code).toBe("PROVIDER_AUTH_FAILED");
  });

  it("maps 429 to PROVIDER_RATE_LIMITED with a friendly message", () => {
    const err = providerStatusError(429, "deploy");
    expect(err.code).toBe("PROVIDER_RATE_LIMITED");
    expect(err.message).toContain("temporarily busy");
  });

  it("maps 404 to the context-appropriate code", () => {
    expect(providerStatusError(404, "status").code).toBe("DEPLOYMENT_NOT_FOUND");
    expect(providerStatusError(404, "delete").code).toBe("DEPLOYMENT_NOT_FOUND");
    expect(providerStatusError(404, "rollback").code).toBe("DEPLOYMENT_NOT_FOUND");
    expect(providerStatusError(404, "domain").code).toBe("DOMAIN_NOT_FOUND");
    expect(providerStatusError(404, "project").code).toBe("PROVIDER_PROJECT_FAILED");
  });

  it("maps 409 domain to DOMAIN_ALREADY_IN_USE and deploy to DUPLICATE_PUBLISH", () => {
    expect(providerStatusError(409, "domain").code).toBe("DOMAIN_ALREADY_IN_USE");
    expect(providerStatusError(409, "deploy").code).toBe("DUPLICATE_PUBLISH");
  });

  it("maps 5xx to DEPLOY_FAILED", () => {
    expect(providerStatusError(500, "deploy").code).toBe("DEPLOY_FAILED");
    expect(providerStatusError(502, "status").code).toBe("DEPLOY_FAILED");
  });
});

describe("ProviderHttpClient — base URL", () => {
  it("uses the fixed default base and normalizes trailing slashes", () => {
    const client = new NodeFetchProviderHttpClient();
    expect(client.baseUrlForTests).toBe(DEFAULT_PROVIDER_BASE_URL.replace(/\/+$/, ""));
    expect(client.url("/v13/deployments")).toBe(`${DEFAULT_PROVIDER_BASE_URL}/v13/deployments`);
  });
});
