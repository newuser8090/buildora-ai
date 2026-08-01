// ---------------------------------------------------------------------------
// Storage Estimate Service Tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getStorageEstimate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns available: false when navigator is undefined", async () => {
    // Simulate server-side rendering by deleting navigator
    const origNav = globalThis.navigator;
    try {
      Object.defineProperty(globalThis, "navigator", {
        get: () => undefined as unknown as Navigator,
        configurable: true,
      });
      const { getStorageEstimate } = await import("../services/storage-estimate");
      const result = await getStorageEstimate();
      expect(result.available).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        get: () => origNav,
        configurable: true,
      });
    }
  });

  it("returns available: false when navigator.storage is undefined", async () => {
    const origNav = globalThis.navigator;
    try {
      Object.defineProperty(globalThis, "navigator", {
        value: { storage: undefined },
        configurable: true,
        writable: true,
      });
      const { getStorageEstimate } = await import("../services/storage-estimate");
      const result = await getStorageEstimate();
      expect(result.available).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: origNav,
        configurable: true,
        writable: true,
      });
    }
  });

  it("returns available: false when navigator.storage.estimate is undefined", async () => {
    const origNav = globalThis.navigator;
    try {
      Object.defineProperty(globalThis, "navigator", {
        value: { storage: {} },
        configurable: true,
        writable: true,
      });
      const { getStorageEstimate } = await import("../services/storage-estimate");
      const result = await getStorageEstimate();
      expect(result.available).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: origNav,
        configurable: true,
        writable: true,
      });
    }
  });

  it("returns estimate when API is available", async () => {
    const origNav = globalThis.navigator;
    try {
      const mockEstimate = vi.fn().mockResolvedValue({ usage: 1024, quota: 1024000 });
      Object.defineProperty(globalThis, "navigator", {
        value: { storage: { estimate: mockEstimate } },
        configurable: true,
        writable: true,
      });
      // Use a fresh dynamic import to pick up the overridden navigator
      const mod = await import("../services/storage-estimate");
      const result = await mod.getStorageEstimate();
      expect(result.available).toBe(true);
      expect(result.usage).toBe(1024);
      expect(result.quota).toBe(1024000);
      expect(result.estimatedRemaining).toBe(1022976);
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: origNav,
        configurable: true,
        writable: true,
      });
    }
  });

  it("handles missing usage value gracefully", async () => {
    const origNav = globalThis.navigator;
    try {
      const mockEstimate = vi.fn().mockResolvedValue({ quota: 1024000 });
      Object.defineProperty(globalThis, "navigator", {
        value: { storage: { estimate: mockEstimate } },
        configurable: true,
        writable: true,
      });
      const { getStorageEstimate } = await import("../services/storage-estimate");
      const result = await getStorageEstimate();
      expect(result.available).toBe(true);
      expect(result.usage).toBeUndefined();
      expect(result.quota).toBe(1024000);
      expect(result.estimatedRemaining).toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: origNav,
        configurable: true,
        writable: true,
      });
    }
  });

  it("handles missing quota value gracefully", async () => {
    const origNav = globalThis.navigator;
    try {
      const mockEstimate = vi.fn().mockResolvedValue({ usage: 1024 });
      Object.defineProperty(globalThis, "navigator", {
        value: { storage: { estimate: mockEstimate } },
        configurable: true,
        writable: true,
      });
      const { getStorageEstimate } = await import("../services/storage-estimate");
      const result = await getStorageEstimate();
      expect(result.available).toBe(true);
      expect(result.usage).toBe(1024);
      expect(result.quota).toBeUndefined();
      expect(result.estimatedRemaining).toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: origNav,
        configurable: true,
        writable: true,
      });
    }
  });

  it("filters non-finite values", async () => {
    const origNav = globalThis.navigator;
    try {
      const mockEstimate = vi.fn().mockResolvedValue({ usage: Infinity, quota: NaN });
      Object.defineProperty(globalThis, "navigator", {
        value: { storage: { estimate: mockEstimate } },
        configurable: true,
        writable: true,
      });
      const { getStorageEstimate } = await import("../services/storage-estimate");
      const result = await getStorageEstimate();
      expect(result.available).toBe(true);
      expect(result.usage).toBeUndefined();
      expect(result.quota).toBeUndefined();
      expect(result.estimatedRemaining).toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: origNav,
        configurable: true,
        writable: true,
      });
    }
  });

  it("returns available: false when estimate throws", async () => {
    const origNav = globalThis.navigator;
    try {
      const mockEstimate = vi.fn().mockRejectedValue(new Error("Storage error"));
      Object.defineProperty(globalThis, "navigator", {
        value: { storage: { estimate: mockEstimate } },
        configurable: true,
        writable: true,
      });
      const { getStorageEstimate } = await import("../services/storage-estimate");
      const result = await getStorageEstimate();
      expect(result.available).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: origNav,
        configurable: true,
        writable: true,
      });
    }
  });
});
