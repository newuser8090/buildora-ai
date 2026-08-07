// ---------------------------------------------------------------------------
// Publishing — mock provider tests (Phase P7)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { MockPublishingProvider } from "../providers/mock-provider";
import type { MockProviderOptions } from "../providers/mock-provider";
import type { DeploymentRecord, PublishProgressEvent } from "../types";

const NOW = "2026-01-01T00:00:00.000Z";

function provider(opts: MockProviderOptions = {}) {
  return new MockPublishingProvider({ now: () => NOW, origin: "http://localhost:3000", ...opts });
}

describe("MockPublishingProvider — availability", () => {
  it("is always available and marked dev-only", async () => {
    const availability = await provider().isAvailable();
    expect(availability.available).toBe(true);
    expect(availability.devOnly).toBe(true);
  });

  it("labels itself as a demo publish", () => {
    const p = provider();
    expect(p.id).toBe("mock");
    expect(p.label).toBe("Demo publish");
  });
});

describe("MockPublishingProvider — publish success", () => {
  it("emits progress in the canonical stage order and returns a demo URL", async () => {
    const p = provider({ durations: { checking: 0, preparing: 0, building: 0, publishing: 0, live: 0 } });
    const events: PublishProgressEvent[] = [];
    const result = await p.publish(
      { projectId: "proj-1", projectSnapshot: {}, deploymentId: "d1", exportHash: "abc" },
      (e) => events.push(e),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe("http://localhost:3000/preview/proj-1");
    expect(events.map((e) => e.stage)).toEqual([
      "checking", "preparing", "building", "publishing", "live",
    ]);
    // Deterministic fractions, monotonically non-decreasing.
    const fractions = events.map((e) => e.fraction);
    expect(fractions[0]).toBe(0);
    expect(fractions[fractions.length - 1]).toBe(1);
    for (let i = 1; i < fractions.length; i += 1) {
      expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1]);
    }
    // Messages are beginner-friendly stage labels.
    expect(events[0].message).toContain("Checking");
  });

  it("records the deployment as live with a demo URL", async () => {
    const p = provider();
    await p.publish(
      { projectId: "proj-1", projectSnapshot: {}, deploymentId: "d1", exportHash: "abc" },
      () => {},
    );
    const record = await p.getDeployment("d1");
    expect(record).not.toBeNull();
    expect(record!.status).toBe("live");
    expect(record!.providerId).toBe("mock");
    expect(record!.url).toContain("/preview/proj-1");
    expect(record!.completedAt).toBe(NOW);
  });
});

describe("MockPublishingProvider — failure & cancel", () => {
  it("fails with the configured error code at the requested stage", async () => {
    const p = provider({ failAt: "building", failCode: "BUILD_FAILED" });
    const result = await p.publish(
      { projectId: "proj-1", projectSnapshot: {}, deploymentId: "d1", exportHash: "abc" },
      () => {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error?.code).toBe("BUILD_FAILED");
    const record = await p.getDeployment("d1");
    expect(record!.status).toBe("failed");
    expect(record!.errorCode).toBe("BUILD_FAILED");
  });

  it("records a cancelled deployment when aborted", async () => {
    const p = provider({ durations: { checking: 0, preparing: 0, building: 50, publishing: 0, live: 0 } });
    const controller = new AbortController();
    const promise = p.publish(
      { projectId: "proj-1", projectSnapshot: {}, deploymentId: "d1", exportHash: "abc" },
      () => {},
      controller.signal,
    );
    setTimeout(() => controller.abort(), 5);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error?.code).toBe("CANCELLED");
    const record = await p.getDeployment("d1");
    expect(record!.status).toBe("cancelled");
  });
});

describe("MockPublishingProvider — history & rollback", () => {
  function liveRecord(id: string, activatedAt: string): DeploymentRecord {
    return {
      id, projectId: "proj-1", providerId: "mock", status: "live",
      createdAt: activatedAt, completedAt: activatedAt, activatedAt,
      projectRevision: 1, exportHash: `hash-${id}`, contentHash: `content-${id}`,
    };
  }

  it("lists deployments newest first and does not touch project content", async () => {
    const p = provider();
    p._seed(liveRecord("d-old", "2026-01-01T00:00:00.000Z"));
    p._seed(liveRecord("d-new", "2026-01-02T00:00:00.000Z"));
    const list = await p.listDeployments("proj-1");
    expect(list.map((d) => d.id)).toEqual(["d-new", "d-old"]);
  });

  it("rolls back to an older live deployment by refreshing activatedAt", async () => {
    const p = provider({ now: () => "2026-01-03T00:00:00.000Z" });
    p._seed(liveRecord("d-old", "2026-01-01T00:00:00.000Z"));
    p._seed(liveRecord("d-new", "2026-01-02T00:00:00.000Z"));

    const rolled = await p.rollback("d-old");
    expect(rolled.id).toBe("d-old");
    expect(rolled.activatedAt).toBe("2026-01-03T00:00:00.000Z");

    const list = await p.listDeployments("proj-1");
    const active = list.sort((a, b) =>
      (b.activatedAt ?? "").localeCompare(a.activatedAt ?? ""),
    )[0];
    expect(active.id).toBe("d-old");
  });

  it("refuses to roll back to a non-live deployment", async () => {
    const p = provider();
    p._seed({ ...liveRecord("d1", NOW), status: "failed" });
    await expect(p.rollback("d1")).rejects.toMatchObject({ code: "DEPLOYMENT_NOT_FOUND" });
  });

  it("refuses to roll back an unknown deployment", async () => {
    await expect(provider().rollback("missing")).rejects.toMatchObject({
      code: "DEPLOYMENT_NOT_FOUND",
    });
  });

  it("deletes deployments", async () => {
    const p = provider();
    p._seed(liveRecord("d1", NOW));
    await p.deleteDeployment("d1");
    expect(await p.getDeployment("d1")).toBeNull();
  });
});
