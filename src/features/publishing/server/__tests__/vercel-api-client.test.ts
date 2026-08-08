// ---------------------------------------------------------------------------
// Publishing — HttpVercelApiClient tests (Phase P8)
//
// Tests the real HTTP adapter against an injectable ProviderHttpClient fake —
// no live Vercel credentials required. Covers:
//   - project creation + reuse
//   - deployment creation with file digest + missing-file upload
//   - status mapping (queued/building/ready + URLs)
//   - cancel / delete / promote (rollback)
//   - domain attach / status / list / remove
//   - auth failure, rate limiting, malformed responses
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { HttpVercelApiClient } from "../vercel-api-client";
import type { ProviderHttpClient, ProviderHttpRequest } from "../provider-http-client";
import { buildoraProjectName } from "../vercel-mode";

class FakeHttp implements ProviderHttpClient {
  requests: ProviderHttpRequest[] = [];
  responses: Array<{ status: number; json?: unknown }> = [];
  constructor(responses: Array<{ status: number; json?: unknown }>) {
    this.responses = responses;
  }
  async request(req: ProviderHttpRequest) {
    this.requests.push(req);
    const next = this.responses.shift() ?? { status: 500, json: {} };
    return {
      status: next.status,
      ok: next.status >= 200 && next.status < 300,
      json: next.json ?? null,
      headers: {},
    };
  }
}

const TOKEN = "tok_test_secret";
const TEAM = "team_abc";

function makeClient(fake: FakeHttp) {
  return new HttpVercelApiClient({ http: fake, token: TOKEN, teamId: TEAM });
}

describe("buildoraProjectName", () => {
  it("is deterministic, prefixed and provider-valid", () => {
    expect(buildoraProjectName("proj-123", "buildora")).toBe("buildora-proj-123");
    expect(buildoraProjectName("proj-123", "buildora")).toBe(buildoraProjectName("proj-123", "buildora"));
  });

  it("never derives from raw title text — only the project id", () => {
    expect(buildoraProjectName("My Site! 100%")).toMatch(/^buildora-/);
    expect(buildoraProjectName("My Site! 100%")).not.toContain("My");
  });

  it("is collision-resistant for different ids", () => {
    expect(buildoraProjectName("proj-a")).not.toBe(buildoraProjectName("proj-b"));
  });
});

describe("HttpVercelApiClient — projects", () => {
  it("reuses an existing project by deterministic name", async () => {
    const fake = new FakeHttp([
      { status: 200, json: { projects: [{ id: "prj_1", name: "buildora-proj-1" }] } },
    ]);
    const client = makeClient(fake);
    const result = await client.ensureProject({ ownerUserId: "u1", name: "buildora-proj-1" });
    expect(result).toEqual({ projectId: "prj_1", projectName: "buildora-proj-1" });
    expect(fake.requests[0].url).toContain("/v9/projects?search=");
    expect(fake.requests[0].url).toContain("teamId=team_abc");
    expect(fake.requests[0].headers?.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("creates a project when none matches", async () => {
    const fake = new FakeHttp([
      { status: 200, json: { projects: [] } },
      { status: 200, json: { id: "prj_new", name: "buildora-proj-1" } },
    ]);
    const result = await makeClient(fake).ensureProject({ ownerUserId: "u1", name: "buildora-proj-1" });
    expect(result.projectId).toBe("prj_new");
    expect(fake.requests[1].url).toContain("/v10/projects");
    expect(JSON.parse(fake.requests[1].body as string)).toMatchObject({
      name: "buildora-proj-1",
      framework: "nextjs",
    });
  });

  it("maps auth failure to PROVIDER_AUTH_FAILED", async () => {
    const fake = new FakeHttp([{ status: 401, json: { error: { code: "forbidden" } } }]);
    await expect(
      makeClient(fake).ensureProject({ ownerUserId: "u1", name: "buildora-proj-1" }),
    ).rejects.toMatchObject({ code: "PROVIDER_AUTH_FAILED" });
  });
});

describe("HttpVercelApiClient — deployments", () => {
  it("creates a deployment with file digests and uploads missing files", async () => {
    const fake = new FakeHttp([
      {
        status: 200,
        json: {
          id: "dpl_1",
          url: "https://x.vercel.app",
          readyState: "QUEUED",
          missing: [
            { file: "index.html", sha: "deadbeef", size: 10, url: "https://upload.vercel.com/x" },
            { file: "about.html", sha: "cafebabe", size: 5 },
          ],
        },
      },
    ]);
    const result = await makeClient(fake).createDeployment({
      ownerUserId: "u1",
      projectId: "prj_1",
      projectName: "buildora-proj-1",
      files: [
        { path: "index.html", content: "hello" },
        { path: "about.html", content: "world" },
      ],
      target: "production",
      idempotencyKey: "k",
    });
    expect(result.providerDeploymentId).toBe("dpl_1");
    expect(fake.requests[0].url).toContain("/v13/deployments");
    const body = JSON.parse(fake.requests[0].body as string);
    expect(body.files[0]).toMatchObject({ file: "index.html", size: 5 });
    expect(body.files[0].sha).toMatch(/^[0-9a-f]{40}$/);
    // Upload 1 → the provider-provided HTTPS URL; upload 2 → fallback endpoint.
    expect(fake.requests[1].url).toBe("https://upload.vercel.com/x");
    expect(fake.requests[2].url).toContain("/v13/deployments/dpl_1/files");
    expect(fake.requests[2].headers?.["x-vercel-digest"]).toBe("cafebabe");
  });

  it("rejects rate limiting with a structured error", async () => {
    const fake = new FakeHttp([{ status: 429, json: {} }]);
    await expect(
      makeClient(fake).createDeployment({
        ownerUserId: "u1",
        projectId: "prj_1",
        projectName: "buildora-proj-1",
        files: [],
        target: "production",
        idempotencyKey: "k",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED" });
  });

  it("throws DEPLOYMENT_CREATE_FAILED on malformed response without id", async () => {
    const fake = new FakeHttp([{ status: 200, json: { nope: true } }]);
    await expect(
      makeClient(fake).createDeployment({
        ownerUserId: "u1",
        projectId: "prj_1",
        projectName: "buildora-proj-1",
        files: [],
        target: "production",
        idempotencyKey: "k",
      }),
    ).rejects.toMatchObject({ code: "DEPLOYMENT_CREATE_FAILED" });
  });

  it("maps deployment status incl. alias production URL", async () => {
    const fake = new FakeHttp([
      {
        status: 200,
        json: {
          id: "dpl_1",
          url: "https://x.vercel.app",
          readyState: "READY",
          alias: ["buildora-proj-1.vercel.app"],
          buildingAt: 1000,
          readyAt: 2000,
        },
      },
    ]);
    const status = await makeClient(fake).getDeployment({ ownerUserId: "u1", providerDeploymentId: "dpl_1" });
    expect(status.readyState).toBe("READY");
    expect(status.productionUrl).toBe("https://buildora-proj-1.vercel.app");
    expect(status.buildStartedAt).toBeDefined();
    expect(status.buildCompletedAt).toBeDefined();
  });

  it("maps deployment failure with sanitized error summary", async () => {
    const fake = new FakeHttp([
      { status: 200, json: { id: "dpl_1", url: "https://x.vercel.app", readyState: "ERROR", errorMessage: "Build failed: missing module" } },
    ]);
    const status = await makeClient(fake).getDeployment({ ownerUserId: "u1", providerDeploymentId: "dpl_1" });
    expect(status.readyState).toBe("ERROR");
    expect(status.errorSummary).toBe("Build failed: missing module");
  });

  it("cancels, deletes and promotes (rollback) deployments", async () => {
    const cancel = new FakeHttp([{ status: 200, json: { readyState: "CANCELED" } }]);
    const cancelled = await makeClient(cancel).cancelDeployment({ ownerUserId: "u1", providerDeploymentId: "dpl_1" });
    expect(cancelled.readyState).toBe("CANCELED");

    const del = new FakeHttp([{ status: 204 }]);
    await expect(
      makeClient(del).deleteDeployment({ ownerUserId: "u1", providerDeploymentId: "dpl_1" }),
    ).resolves.toBeUndefined();

    const promote = new FakeHttp([
      { status: 200, json: { url: "https://x.vercel.app", readyState: "READY" } },
    ]);
    const rolled = await makeClient(promote).promoteDeployment({
      ownerUserId: "u1",
      projectId: "prj_1",
      providerDeploymentId: "dpl_1",
    });
    expect(rolled.url).toBe("https://x.vercel.app");
    expect(promote.requests[0].url).toContain("/v1/projects/prj_1/rollback/dpl_1");
  });

  it("maps cancel 404 to DEPLOYMENT_NOT_FOUND", async () => {
    const fake = new FakeHttp([{ status: 404, json: {} }]);
    await expect(
      makeClient(fake).cancelDeployment({ ownerUserId: "u1", providerDeploymentId: "dpl_1" }),
    ).rejects.toMatchObject({ code: "DEPLOYMENT_NOT_FOUND" });
  });
});

describe("HttpVercelApiClient — domains", () => {
  it("attaches a domain and returns DNS instructions", async () => {
    const fake = new FakeHttp([
      {
        status: 200,
        json: {
          name: "example.com",
          verified: false,
          verification: [{ type: "CNAME", domain: "example.com", value: "cname.vercel-dns.com.", reason: "Point this name at your site." }],
        },
      },
    ]);
    const result = await makeClient(fake).attachDomain({ ownerUserId: "u1", projectId: "prj_1", domain: "example.com" });
    expect(result.status).toBe("pending");
    expect(result.verification[0].type).toBe("CNAME");
    expect(fake.requests[0].url).toContain("/v10/projects/prj_1/domains");
  });

  it("reports verified + httpsReady when the provider confirms", async () => {
    const fake = new FakeHttp([{ status: 200, json: { name: "example.com", verified: true, verification: [] } }]);
    const result = await makeClient(fake).getDomainStatus({ ownerUserId: "u1", projectId: "prj_1", domain: "example.com" });
    expect(result.status).toBe("verified");
    expect(result.httpsReady).toBe(true);
  });

  it("maps domain conflict to DOMAIN_ALREADY_IN_USE", async () => {
    const fake = new FakeHttp([{ status: 409, json: {} }]);
    await expect(
      makeClient(fake).attachDomain({ ownerUserId: "u1", projectId: "prj_1", domain: "example.com" }),
    ).rejects.toMatchObject({ code: "DOMAIN_ALREADY_IN_USE" });
  });

  it("lists and removes domains", async () => {
    const list = new FakeHttp([
      { status: 200, json: { domains: [{ name: "example.com", verified: true }] } },
    ]);
    const listed = await makeClient(list).listDomains({ ownerUserId: "u1", projectId: "prj_1" });
    expect(listed.domains[0].status).toBe("verified");

    const remove = new FakeHttp([{ status: 204 }]);
    await expect(
      makeClient(remove).removeDomain({ ownerUserId: "u1", projectId: "prj_1", domain: "example.com" }),
    ).resolves.toBeUndefined();
    expect(remove.requests[0].url).toContain("/v9/projects/prj_1/domains/example.com");
  });
});

describe("HttpVercelApiClient — token handling", () => {
  it("never sends the token in a GET body and always as Bearer header", async () => {
    const fake = new FakeHttp([
      { status: 200, json: { projects: [] } },
      { status: 200, json: { id: "prj_new", name: "buildora-proj-1" } },
    ]);
    await makeClient(fake).ensureProject({ ownerUserId: "u1", name: "buildora-proj-1" });
    expect(fake.requests[0].body).toBeUndefined();
    expect(fake.requests[0].headers?.Authorization).toBe("Bearer tok_test_secret");
    // The token must never appear in URLs or bodies.
    expect(fake.requests[0].url).not.toContain("tok_test_secret");
    expect(fake.requests[0].body).toBeUndefined();
  });
});
