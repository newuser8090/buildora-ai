// ---------------------------------------------------------------------------
// Publishing — VercelPublishingProvider tests (Phase P8)
//
// The client adapter is tested against a mocked fetch (never real provider
// credentials) and a mocked Buildora session token. Verifies:
//   - availability + credentials-missing behavior
//   - publish flow: snapshot validation → upload → bounded polling → live
//   - build failure / rate limit / cancellation paths
//   - rollback / delete / cancel management actions
//   - domain proxy calls carry the bearer token and never leak it
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { VercelPublishingProvider } from "../providers/vercel-provider";
import type { PublishProgressEvent } from "../types";
import type { Project } from "@/types/project";
import { _resetPublishLocksForTests } from "../services/publish-concurrency";

// Mock the Buildora session token helper (no real auth in unit tests).
vi.mock("../client-auth", () => ({
  getPublishBearerToken: vi.fn(async () => "buildora-session-token"),
}));

function makeProject(): Project {
  return {
    id: "proj-1",
    name: "Test Site",
    theme: {
      palette: {
        background: "#fff", foreground: "#000", primary: "#7c5cfc",
        primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#000",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#fff", border: "#e5e5e5", card: "#fff", cardForeground: "#000",
      },
      typography: { fontFamily: "sans-serif", headingFont: "sans-serif", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "5rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
    pages: [
      {
        id: "p1", title: "Home", slug: "/",
        sections: [
          { id: "s1", type: "hero", order: 1, visible: true, props: { headline: "Hello", primaryCta: { text: "Go", href: "#" } }, styles: {} },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Queue responses keyed by URL pattern; returns a fake fetch. */
function fakeFetch(routes: Array<{ match: RegExp; response: Response | ((init: RequestInit) => Response) }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const route = routes.find((r) => r.match.test(url));
    if (!route) return new Response(JSON.stringify({ ok: false, error: { code: "UNKNOWN", message: "no route" } }), { status: 404 });
    return typeof route.response === "function" ? route.response(init) : route.response;
  });
  return { fn, calls };
}

function okEnvelope(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function provider(fetchFn: (url: string, init: RequestInit) => Promise<Response>, opts: { pollInterval?: number; timeout?: number } = {}) {
  return new VercelPublishingProvider({
    apiFetch: fetchFn,
    now: () => "2026-01-01T00:00:00.000Z",
    initialPollIntervalMs: opts.pollInterval ?? 1,
    maxPollIntervalMs: 2,
    pollTimeoutMs: opts.timeout ?? 5000,
  });
}

beforeEach(() => {
  _resetPublishLocksForTests();
});

describe("VercelPublishingProvider — capabilities & availability", () => {
  it("declares full production capabilities", () => {
    const p = provider(async () => new Response("{}"));
    expect(p.capabilities.realHosting).toBe(true);
    expect(p.capabilities.customDomains).toBe(true);
    expect(p.capabilities.rollback).toBe(true);
    expect(p.capabilities.cancelDeployment).toBe(true);
    expect(p.capabilities.deleteDeployment).toBe(true);
    expect(p.capabilities.previewDeployments).toBe(true);
    expect(p.capabilities.deploymentLogs).toBe(true);
  });

  it("is available when the status endpoint reports available", async () => {
    const { fn } = fakeFetch([
      { match: /\/status/, response: okEnvelope({ available: true, configured: true }) },
    ]);
    const p = provider(fn);
    const a = await p.isAvailable();
    expect(a.available).toBe(true);
    expect(a.capabilities?.realHosting).toBe(true);
  });

  it("is unavailable when credentials are missing (graceful disable)", async () => {
    const { fn } = fakeFetch([
      { match: /\/status/, response: okEnvelope({ available: false, configured: false, reason: "not configured" }) },
    ]);
    const p = provider(fn);
    const a = await p.isAvailable();
    expect(a.available).toBe(false);
    expect(a.reason).toContain("not configured");
  });

  it("is unavailable when the status call fails entirely", async () => {
    const { fn } = fakeFetch([]);
    const p = provider(fn);
    const a = await p.isAvailable();
    expect(a.available).toBe(false);
  });

  it("caches availability briefly", async () => {
    const { fn } = fakeFetch([
      { match: /\/status/, response: okEnvelope({ available: true, configured: true }) },
    ]);
    const p = provider(fn);
    await p.isAvailable();
    await p.isAvailable();
    expect(fn.mock.calls.filter((c) => /\/status/.test(c[0])).length).toBe(1);
  });
});

describe("VercelPublishingProvider — publish success", () => {
  it("uploads the export, polls to live, and returns a production URL", async () => {
    let pollCount = 0;
    const { fn, calls } = fakeFetch([
      {
        match: /\/deploy$/,
        response: okEnvelope({
          providerDeploymentId: "dpl_1",
          providerProjectId: "prj_1",
          providerProjectName: "buildora-proj-1",
          url: "https://x.vercel.app",
          readyState: "QUEUED",
          ownerUserId: "u1",
        }),
      },
      {
        match: /\/deployments\/dpl_1$/,
        response: () => {
          pollCount += 1;
          return okEnvelope({
            providerDeploymentId: "dpl_1",
            url: "https://x.vercel.app",
            readyState: pollCount >= 2 ? "READY" : "BUILDING",
            productionUrl: "https://buildora-proj-1.vercel.app",
            previewUrl: "https://preview.vercel.app",
            providerProjectId: "prj_1",
            providerProjectName: "buildora-proj-1",
            buildStartedAt: "2026-01-01T00:00:01.000Z",
            buildCompletedAt: "2026-01-01T00:00:02.000Z",
          });
        },
      },
    ]);
    const p = provider(fn);
    const events: PublishProgressEvent[] = [];
    const result = await p.publish(
      { projectId: "proj-1", projectSnapshot: makeProject(), deploymentId: "deploy-1", exportHash: "abc", contentHash: "c1", idempotencyKey: "k1" },
      (e) => events.push(e),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe("https://buildora-proj-1.vercel.app");
      expect(result.deploymentPatch?.providerDeploymentId).toBe("dpl_1");
      expect(result.deploymentPatch?.productionUrl).toBe("https://buildora-proj-1.vercel.app");
      expect(result.deploymentPatch?.previewUrl).toBe("https://preview.vercel.app");
    }
    // Upload payload carried the export files and idempotency key.
    const deployCall = calls.find((c) => /\/deploy$/.test(c.url))!;
    const body = JSON.parse(deployCall.init.body as string);
    expect(body.projectId).toBe("proj-1");
    expect(body.idempotencyKey).toBe("k1");
    expect(body.files.length).toBeGreaterThan(0);
    // Authorization header present on every privileged call.
    expect((deployCall.init.headers as Record<string, string>)?.Authorization).toBe("Bearer buildora-session-token");
    // No provider token anywhere.
    expect(JSON.stringify(calls)).not.toContain("VERCEL_API_TOKEN");
    // Progress reached the live stage.
    expect(events[events.length - 1].stage).toBe("live");
    expect(events[events.length - 1].fraction).toBe(1);
  });

  it("reports build failure with a beginner-safe message", async () => {
    const { fn } = fakeFetch([
      { match: /\/deploy$/, response: okEnvelope({ providerDeploymentId: "dpl_1", url: "https://x.vercel.app", readyState: "QUEUED" }) },
      { match: /\/deployments\/dpl_1$/, response: okEnvelope({ providerDeploymentId: "dpl_1", url: "https://x.vercel.app", readyState: "ERROR", errorSummary: "Build failed" }) },
    ]);
    const p = provider(fn);
    const result = await p.publish(
      { projectId: "proj-1", projectSnapshot: makeProject(), deploymentId: "d1", exportHash: "e", contentHash: "c", idempotencyKey: "k" },
      () => {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error) expect(result.error.code).toBe("DEPLOYMENT_FAILED");
  });

  it("maps provider rate limiting during polling", async () => {
    const { fn } = fakeFetch([
      { match: /\/deploy$/, response: okEnvelope({ providerDeploymentId: "dpl_1", url: "https://x.vercel.app", readyState: "QUEUED" }) },
      {
        match: /\/deployments\/dpl_1$/,
        response: new Response(JSON.stringify({ ok: false, error: { code: "PROVIDER_RATE_LIMITED", message: "busy" } }), { status: 429 }),
      },
    ]);
    const p = provider(fn);
    const result = await p.publish(
      { projectId: "proj-1", projectSnapshot: makeProject(), deploymentId: "d1", exportHash: "e", contentHash: "c", idempotencyKey: "k" },
      () => {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error) expect(result.error.code).toBe("PROVIDER_RATE_LIMITED");
  });

  it("requires auth for real publishing", async () => {
    const { getPublishBearerToken } = await import("../client-auth");
    vi.mocked(getPublishBearerToken).mockResolvedValueOnce(null);
    const { fn } = fakeFetch([]);
    const p = provider(fn);
    const result = await p.publish(
      { projectId: "proj-1", projectSnapshot: makeProject(), deploymentId: "d1", exportHash: "e", contentHash: "c", idempotencyKey: "k" },
      () => {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error) expect(result.error.code).toBe("AUTH_REQUIRED");
  });

  it("cancels the remote deployment when aborted mid-publish", async () => {
    const { fn, calls } = fakeFetch([
      { match: /\/deploy$/, response: okEnvelope({ providerDeploymentId: "dpl_1", url: "https://x.vercel.app", readyState: "QUEUED" }) },
      { match: /\/deployments\/dpl_1$/, response: okEnvelope({ providerDeploymentId: "dpl_1", url: "https://x.vercel.app", readyState: "BUILDING" }) },
      { match: /\/deployments\/dpl_1\/cancel$/, response: okEnvelope({ providerDeploymentId: "dpl_1", readyState: "CANCELED" }) },
    ]);
    const p = provider(fn);
    const controller = new AbortController();
    const promise = p.publish(
      { projectId: "proj-1", projectSnapshot: makeProject(), deploymentId: "d1", exportHash: "e", contentHash: "c", idempotencyKey: "k" },
      () => {},
      controller.signal,
    );
    setTimeout(() => controller.abort(), 5);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok && result.error) expect(result.error.code).toBe("CANCELLED");
    expect(calls.some((c) => /\/cancel$/.test(c.url))).toBe(true);
  });
});

describe("VercelPublishingProvider — management actions", () => {
  it("rolls back to a previous deployment", async () => {
    const { fn } = fakeFetch([
      { match: /\/rollback$/, response: okEnvelope({ providerDeploymentId: "dpl_old", readyState: "READY", url: "https://x.vercel.app", activatedAt: "2026-01-01T00:00:00.000Z" }) },
    ]);
    const p = provider(fn);
    const record = await p.rollback("dpl_old", "proj-1");
    expect(record.status).toBe("live");
    expect(record.activatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("requires a project id for rollback (promote semantics)", async () => {
    const p = provider(async () => new Response("{}"));
    await expect(p.rollback("dpl_old")).rejects.toMatchObject({ code: "ROLLBACK_FAILED" });
  });

  it("cancels a queued deployment", async () => {
    const { fn } = fakeFetch([
      { match: /\/cancel$/, response: okEnvelope({ providerDeploymentId: "dpl_1", readyState: "CANCELED" }) },
    ]);
    const p = provider(fn);
    const record = await p.cancel("dpl_1", "proj-1");
    expect(record.status).toBe("cancelled");
  });

  it("deletes a deployment", async () => {
    const { fn } = fakeFetch([
      { match: /\/deployments\/dpl_1$/, response: new Response(JSON.stringify({ ok: true, data: null }), { status: 200 }) },
    ]);
    const p = provider(fn);
    await expect(p.deleteDeployment("dpl_1", "proj-1")).resolves.toBeUndefined();
  });

  it("deletes the provider project only when explicitly requested", async () => {
    const { fn, calls } = fakeFetch([
      { match: /\/projects\?/, response: new Response(JSON.stringify({ ok: true, data: null }), { status: 200 }) },
    ]);
    const p = provider(fn);
    await expect(p.deleteProject("proj-1")).resolves.toBeUndefined();
    expect(calls[0].init.method).toBe("DELETE");
  });
});

describe("VercelPublishingProvider — domains (proxy)", () => {
  it("attaches a domain through the server route with auth", async () => {
    const { fn, calls } = fakeFetch([
      { match: /\/domains$/, response: okEnvelope({ domain: "example.com", status: "pending", httpsReady: false, verification: [{ type: "CNAME", name: "example.com", value: "cname.vercel-dns.com.", purpose: "Point this name at your site." }] }) },
    ]);
    const p = provider(fn);
    const result = await p.domains.attachDomain("proj-1", "example.com");
    expect(result.status).toBe("pending");
    expect(result.verification[0].type).toBe("CNAME");
    const call = calls.find((c) => /\/domains$/.test(c.url))!;
    expect((call.init.headers as Record<string, string>)?.Authorization).toBe("Bearer buildora-session-token");
    expect(JSON.stringify(call)).not.toContain("VERCEL_API_TOKEN");
  });

  it("checks domain status", async () => {
    const { fn } = fakeFetch([
      { match: /\/status\?/, response: okEnvelope({ domain: "example.com", status: "verified", httpsReady: true, verification: [] }) },
    ]);
    const p = provider(fn);
    const result = await p.domains.getDomainStatus("proj-1", "example.com");
    expect(result.status).toBe("verified");
    expect(result.httpsReady).toBe(true);
  });

  it("removes a domain", async () => {
    const { fn } = fakeFetch([
      { match: /\/domains\/example\.com\?/, response: new Response(JSON.stringify({ ok: true, data: null }), { status: 200 }) },
    ]);
    const p = provider(fn);
    await expect(p.domains.removeDomain("proj-1", "example.com")).resolves.toBeUndefined();
  });

  it("propagates domain conflicts as structured errors", async () => {
    const { fn } = fakeFetch([
      { match: /\/domains$/, response: new Response(JSON.stringify({ ok: false, error: { code: "DOMAIN_ALREADY_IN_USE", message: "already connected" } }), { status: 409 }) },
    ]);
    const p = provider(fn);
    await expect(p.domains.attachDomain("proj-1", "example.com")).rejects.toMatchObject({
      code: "DOMAIN_ALREADY_IN_USE",
    });
  });
});

describe("VercelPublishingProvider — artifact validation", () => {
  it("rejects structurally invalid projects before upload", async () => {
    const { fn } = fakeFetch([]);
    const p = provider(fn);
    const result = await p.publish(
      { projectId: "proj-1", projectSnapshot: { id: "x" }, deploymentId: "d1", exportHash: "e", contentHash: "c", idempotencyKey: "k" },
      () => {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error) expect(result.error.code).toBe("PROJECT_INVALID");
    expect(fn).not.toHaveBeenCalled();
  });
});
