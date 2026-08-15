// ---------------------------------------------------------------------------
// Data integrations (Phase P22-J)
//   - mock provider: demo records, list/save/delete, deterministic, no throw
//   - provider parity: mock and Supabase expose the same contract
//   - environment resolution mirrors cloud-sync conventions
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockDataProvider, buildDemoRecord } from "../mock/mock-data-provider";
import { SupabaseDataProvider } from "../supabase/supabase-data-provider";
import { getDataIntegrationEnvironment, resetDataIntegrationEnvironmentForTests } from "../environment";
import { getDataIntegrationProvider, setDataIntegrationProviderForTests, resetDataIntegrationProviderForTests } from "../provider-factory";
import type { Collection } from "@/features/elements/collections/types";

const PRODUCTS: Collection = {
  id: "col-products",
  name: "Products",
  fields: [
    { id: "f1", name: "name", type: "text" },
    { id: "f2", name: "price", type: "number" },
    { id: "f3", name: "inStock", type: "boolean" },
    { id: "f4", name: "image", type: "image" },
    { id: "f5", name: "link", type: "url" },
  ],
};

beforeEach(() => {
  resetDataIntegrationEnvironmentForTests();
  resetDataIntegrationProviderForTests();
});

afterEach(() => {
  resetDataIntegrationEnvironmentForTests();
  resetDataIntegrationProviderForTests();
});

describe("MockDataProvider", () => {
  it("seeds a deterministic demo record derived from the collection fields", async () => {
    const provider = new MockDataProvider();
    provider.setCollections([PRODUCTS]);
    const records = await provider.listRecords("col-products");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: "demo-col-products",
      name: "Sample name",
      price: 42,
      inStock: true,
    });
    expect(records[0].image).toMatch(/^https:\/\//);
    expect(records[0].link).toMatch(/^https:\/\//);

    // Deterministic: a second call returns the same demo values.
    const again = await provider.listRecords("col-products");
    expect(JSON.stringify(again)).toBe(JSON.stringify(records));
  });

  it("returns [] for unknown collections (never throws)", async () => {
    const provider = new MockDataProvider();
    expect(await provider.listRecords("ghost")).toEqual([]);
  });

  it("re-derives the demo record when the collection's field definitions change", async () => {
    // Regression: the UI flow is create-collection → add-field. The demo
    // record seeded after the first refresh must NOT shadow the field edit —
    // a bound path must resolve against the freshest field set.
    const provider = new MockDataProvider();
    provider.setCollections([{ ...PRODUCTS, fields: [] }]);
    const early = await provider.listRecords("col-products");
    expect(early[0]).toEqual({ id: "demo-col-products" });

    provider.setCollections([PRODUCTS]);
    const refreshed = await provider.listRecords("col-products");
    expect(refreshed[0]).toMatchObject({
      id: "demo-col-products",
      name: "Sample name",
      price: 42,
      inStock: true,
    });

    // User-created records are never clobbered by field edits.
    await provider.saveRecord("col-products", { id: "rec-1", name: "Mine" });
    provider.setCollections([{ ...PRODUCTS, fields: [...PRODUCTS.fields, { id: "f6", name: "extra", type: "text" }] }]);
    const kept = await provider.listRecords("col-products");
    expect(kept.some((r) => r.id === "rec-1")).toBe(true);
  });

  it("saves, lists, and deletes records", async () => {
    const provider = new MockDataProvider();
    provider.setCollections([PRODUCTS]);
    const saved = await provider.saveRecord("col-products", { id: "r1", name: "Nimbus", price: 49 });
    expect(saved).toEqual({ id: "r1", name: "Nimbus", price: 49 });
    const records = await provider.listRecords("col-products");
    expect(records.find((r) => r.id === "r1")?.name).toBe("Nimbus");
    expect(await provider.deleteRecord("col-products", "r1")).toBe(true);
    expect(await provider.deleteRecord("col-products", "r1")).toBe(false);
  });

  it("never throws on hostile input", async () => {
    const provider = new MockDataProvider();
    expect(await provider.saveRecord("x", "bad" as never)).toBeNull();
    expect(await provider.listRecords(undefined as never)).toEqual([]);
    expect(await provider.deleteRecord("x", undefined as never)).toBe(false);
  });
});

describe("provider parity — mock and Supabase expose the same contract", () => {
  it("both satisfy the DataIntegrationProvider surface", () => {
    const mock: MockDataProvider = new MockDataProvider();
    const supabase: SupabaseDataProvider = new SupabaseDataProvider();
    // Compile-time contract: the exact same method names + signatures.
    const methods = ["getStatus", "listRecords", "saveRecord", "deleteRecord"] as const;
    for (const method of methods) {
      expect(typeof mock[method]).toBe("function");
      expect(typeof supabase[method]).toBe("function");
    }
    expect(mock.kind).toBe("mock");
    expect(supabase.kind).toBe("supabase");
  });

  it("the factory resolves supabase vs mock from the environment", () => {
    // Unset env → local-only (null provider).
    expect(getDataIntegrationEnvironment().kind).toBe("none");
    expect(getDataIntegrationProvider()).toBeNull();

    // Forced mock → mock provider.
    process.env.NEXT_PUBLIC_DATA_PROVIDER = "mock";
    resetDataIntegrationProviderForTests();
    resetDataIntegrationEnvironmentForTests();
    expect(getDataIntegrationEnvironment().kind).toBe("mock");
    expect(getDataIntegrationProvider()?.kind).toBe("mock");

    // Forced supabase without credentials → stays local-only (never a broken
    // provider pretending to be connected).
    process.env.NEXT_PUBLIC_DATA_PROVIDER = "supabase";
    resetDataIntegrationProviderForTests();
    resetDataIntegrationEnvironmentForTests();
    expect(getDataIntegrationEnvironment().kind).toBe("none");
    expect(getDataIntegrationProvider()).toBeNull();
  });
});

describe("buildDemoRecord", () => {
  it("is pure and deterministic", () => {
    const a = buildDemoRecord(PRODUCTS);
    const b = buildDemoRecord(PRODUCTS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("test hooks", () => {
  it("setDataIntegrationProviderForTests overrides the factory", () => {
    const provider = new MockDataProvider();
    setDataIntegrationProviderForTests(provider);
    expect(getDataIntegrationProvider()).toBe(provider);
  });
});
