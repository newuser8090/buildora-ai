// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — device identity tests
//
// A stable, NON-identifying random id per browser profile. Not derived from
// fingerprinting; resettable by clearing app data.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { getDeviceId, generateDeviceId, resetDeviceIdCacheForTests } from "../device-id";
import { setMetadataIdbFactoryForTests } from "../metadata-store";

describe("device id", () => {
  beforeEach(() => {
    resetDeviceIdCacheForTests();
    setMetadataIdbFactoryForTests(globalThis.indexedDB);
  });

  afterEach(() => {
    setMetadataIdbFactoryForTests(null);
  });

  it("is a random, non-personal string", () => {
    const id = generateDeviceId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(8);
    // Two ids differ (no fingerprinting / no user data).
    expect(id).not.toBe(generateDeviceId());
  });

  it("is stable across calls in the same profile", async () => {
    const first = await getDeviceId();
    const second = await getDeviceId();
    expect(first).toBe(second);
  });

  it("persists across cache resets (survives reload within a profile)", async () => {
    const first = await getDeviceId();
    resetDeviceIdCacheForTests();
    const second = await getDeviceId();
    expect(second).toBe(first);
  });

  it("is not derived from user data", async () => {
    const id = await getDeviceId();
    expect(id).not.toContain("@");
    expect(/^(dev-|[0-9a-f]{8}-)/.test(id)).toBe(true);
  });
});
