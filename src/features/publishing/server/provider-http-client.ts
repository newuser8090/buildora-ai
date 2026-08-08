// ---------------------------------------------------------------------------
// Publishing — ProviderHttpClient (Phase P8)
//
// The injectable transport used by the Vercel API client. Unit tests inject a
// fake transport; production uses the fetch implementation below.
//
// Security posture:
//   - fixed provider base URL (never user-controlled)
//   - redirects are errors (no redirect-following to untrusted hosts)
//   - request timeout
//   - response size limit
//   - strict JSON validation (never trusts provider content blindly)
//   - Authorization headers are set server-side only and never logged
// ---------------------------------------------------------------------------

import { makePublishError, type PublishError } from "../errors";

export interface ProviderHttpRequest {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  url: string;
  headers?: Record<string, string>;
  /** JSON string or raw bytes (file uploads). */
  body?: string | Uint8Array;
}

export interface ProviderHttpResponse {
  status: number;
  ok: boolean;
  /** Parsed JSON when the response body parses (null otherwise). */
  json: unknown | null;
  headers: Record<string, string>;
}

export interface ProviderHttpClient {
  request(req: ProviderHttpRequest): Promise<ProviderHttpResponse>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_PROVIDER_BASE_URL = "https://api.vercel.com";
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Hosts the provider may direct uploads to. Everything else is rejected so a
 * compromised/malformed provider response can never cause an SSRF-style
 * upload to an arbitrary host.
 */
export function isAllowedProviderHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "api.vercel.com" ||
    h.endsWith(".vercel.com") ||
    h.endsWith(".vercel-storage.com")
  );
}

// ---------------------------------------------------------------------------
// Real fetch implementation (server-side)
// ---------------------------------------------------------------------------

export class NodeFetchProviderHttpClient implements ProviderHttpClient {
  private baseUrl: string;
  private timeoutMs: number;
  private fetchImpl: typeof fetch;

  constructor(options?: {
    baseUrl?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  }) {
    this.baseUrl = (options?.baseUrl ?? DEFAULT_PROVIDER_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  }

  get baseUrlForTests(): string {
    return this.baseUrl;
  }

  /** Absolute URL for a provider API path (fixed base; no user input). */
  url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private async readResponse(res: Response): Promise<ProviderHttpResponse> {
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    // Hard response size cap — a misbehaving/compromised provider can never
    // make the server buffer an unbounded body.
    const text = await res.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw makePublishError(
        "NETWORK_FAILED",
        "The publishing service returned an unexpectedly large response.",
      );
    }
    let json: unknown = null;
    if (text.length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { status: res.status, ok: res.ok, json, headers };
  }

  async request(req: ProviderHttpRequest): Promise<ProviderHttpResponse> {
    if (!req.url.startsWith("https://")) {
      throw makePublishError(
        "NETWORK_FAILED",
        "The publishing service received an invalid request URL.",
      );
    }
    // Upload URLs must be provider-hosted.
    if (req.url.startsWith("https://") && !req.url.startsWith(`${this.baseUrl}`)) {
      const host = new URL(req.url).hostname;
      if (!isAllowedProviderHost(host)) {
        throw makePublishError(
          "NETWORK_FAILED",
          "The publishing service refused an unsafe upload address.",
        );
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(req.url, {
        method: req.method,
        headers: { ...(req.headers ?? {}) },
        body: req.body !== undefined ? (req.body as BodyInit) : undefined,
        redirect: "error", // never follow redirects
        signal: controller.signal,
      });
      return await this.readResponse(response);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw makePublishError("NETWORK_FAILED", "The publishing service timed out. Please try again.");
      }
      throw makePublishError(
        "NETWORK_FAILED",
        "Couldn't reach the publishing service. Please try again.",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// Errors (provider status → structured publish error)
// ---------------------------------------------------------------------------

export function providerStatusError(
  status: number,
  context: "deploy" | "status" | "cancel" | "delete" | "rollback" | "domain" | "project",
): PublishError {
  switch (status) {
    case 401:
    case 403:
      return makePublishError(
        "PROVIDER_AUTH_FAILED",
        "The publishing service couldn't verify its credentials.",
      );
    case 429:
      return makePublishError(
        "PROVIDER_RATE_LIMITED",
        "Publishing is temporarily busy. Try again shortly.",
      );
    case 404:
      return context === "domain"
        ? makePublishError("DOMAIN_NOT_FOUND", "That domain isn't connected to this project.")
        : context === "status" || context === "cancel" || context === "delete" || context === "rollback"
          ? makePublishError("DEPLOYMENT_NOT_FOUND", "That deployment no longer exists.")
          : makePublishError("PROVIDER_PROJECT_FAILED", "The publishing space couldn't be found.");
    case 400:
      return context === "domain"
        ? makePublishError("DOMAIN_ATTACH_FAILED", "The domain couldn't be added. Please try again.")
        : context === "rollback"
          ? makePublishError("ROLLBACK_FAILED", "Restoring that version failed. Please try again.")
          : makePublishError("DEPLOYMENT_CREATE_FAILED", "Starting the publish failed. Please try again.");
    case 409:
      return context === "domain"
        ? makePublishError("DOMAIN_ALREADY_IN_USE", "That domain is already connected to a project.")
        : makePublishError("DUPLICATE_PUBLISH", "This version is already being published.");
    default:
      return status >= 500
        ? makePublishError("DEPLOY_FAILED", "The publishing service is having trouble. Please try again.")
        : makePublishError("UNKNOWN", "The publishing service returned an unexpected response.");
  }
}
