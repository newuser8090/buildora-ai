// ---------------------------------------------------------------------------
// Binding resolver tests (Phase P22-J)
//
// Covers: direct/nested/array-index paths, missing collection/field/record,
// invalid + unsafe paths, prototype pollution, type coercion, image/URL
// safety, determinism, never-throws, and the export bake path.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { Collection, CollectionRecords } from "@/features/elements/collections/types";
import type { ElementBinding } from "../types";
import type { ElementTree } from "../../types";
import {
  bakeTreeBindings,
  isSafeBindingImageValue,
  isSafeBindingUrlValue,
  resolveBinding,
  resolveNodeBindingProps,
  resolveProjectBindingsForExport,
} from "../resolve";
import type { Project } from "@/types/project";

const PRODUCTS: Collection = {
  id: "products",
  name: "Products",
  fields: [
    { id: "f1", name: "name", type: "text" },
    { id: "f2", name: "price", type: "number" },
    { id: "f3", name: "inStock", type: "boolean" },
    { id: "f4", name: "image", type: "image" },
    { id: "f5", name: "link", type: "url" },
  ],
};

const RECORDS: CollectionRecords = {
  products: [
    {
      id: "p1",
      name: "Nimbus Pro",
      price: "49",
      inStock: "true",
      image: "https://cdn.example.com/nimbus.png",
      link: "https://example.com/buy",
      product: { name: "Nested" },
      images: [{ src: "https://cdn.example.com/a.png" }, { src: "https://cdn.example.com/b.png" }],
    },
  ],
};

const CONTEXT = { collections: [PRODUCTS], records: RECORDS };

function binding(patch: Partial<ElementBinding>): ElementBinding {
  return {
    source: "collection",
    collectionId: "products",
    path: "name",
    field: "text",
    ...patch,
  };
}

describe("resolveBinding", () => {
  it("resolves a direct field with type coercion (number)", () => {
    const r = resolveBinding(binding({ path: "price", field: "price" }), CONTEXT);
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") {
      expect(r.value).toBe(49);
      expect(r.fieldType).toBe("number");
    }
  });

  it("coerces boolean text values to booleans", () => {
    const r = resolveBinding(binding({ path: "inStock", field: "inStock" }), CONTEXT);
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") expect(r.value).toBe(true);
  });

  it("resolves a nested field", () => {
    const r = resolveBinding(binding({ path: "product.name", field: "name" }), CONTEXT);
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") expect(r.value).toBe("Nested");
  });

  it("resolves an array index path", () => {
    const r = resolveBinding(binding({ path: "images[1].src", field: "src" }), CONTEXT);
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") expect(r.value).toBe("https://cdn.example.com/b.png");
  });

  it("resolves an image-typed value only when it is a safe image URL", () => {
    const ok = resolveBinding(binding({ path: "image", field: "image" }), CONTEXT);
    expect(ok.status).toBe("resolved");
    const bad = resolveBinding(
      binding({ path: "image", field: "image" }),
      { collections: [PRODUCTS], records: { products: [{ image: "javascript:alert(1)" }] } },
    );
    expect(bad).toEqual({ status: "unresolved", reason: "unsafe-value" });
  });

  it("resolves a url-typed value only when it is a safe link", () => {
    const ok = resolveBinding(binding({ path: "link", field: "link" }), CONTEXT);
    expect(ok.status).toBe("resolved");
    const bad = resolveBinding(
      binding({ path: "link", field: "link" }),
      { collections: [PRODUCTS], records: { products: [{ link: "vbscript:msgbox(1)" }] } },
    );
    expect(bad).toEqual({ status: "unresolved", reason: "unsafe-value" });
  });

  it("returns unsupported-source for non-collection bindings", () => {
    const r = resolveBinding({ source: "form", field: "text" }, CONTEXT);
    expect(r).toEqual({ status: "unresolved", reason: "unsupported-source" });
  });

  it("returns missing-collection when the collection does not exist", () => {
    const r = resolveBinding(binding({ collectionId: "ghost" }), CONTEXT);
    expect(r).toEqual({ status: "unresolved", reason: "missing-collection" });
  });

  it("returns missing-record when no records exist", () => {
    const r = resolveBinding(binding({}), { collections: [PRODUCTS], records: {} });
    expect(r).toEqual({ status: "unresolved", reason: "missing-record" });
  });

  it("returns missing-path when the record lacks the field", () => {
    const r = resolveBinding(binding({ path: "nope" }), CONTEXT);
    expect(r).toEqual({ status: "unresolved", reason: "missing-path" });
  });

  it("rejects invalid paths (leading dot, spaces, quotes, mixed syntax)", () => {
    for (const path of [".price", "price.", "a b", "a\"b", "a'", "a//b", "price..", "..", "[0]", "a[0]x", "a[]"]) {
      const r = resolveBinding(binding({ path }), CONTEXT);
      expect(r).toEqual({ status: "unresolved", reason: "invalid-path" });
    }
  });

  it("rejects unsafe keys (prototype pollution + prototype access)", () => {
    const polluted: CollectionRecords = {
      products: [
        Object.assign(Object.create(null), {
          __proto__: { price: 1 },
          prototype: { price: 2 },
          constructor: { price: 3 },
          toString: { price: 4 },
          valueOf: { price: 5 },
          hasOwnProperty: { price: 6 },
        }),
      ],
    };
    for (const key of ["__proto__", "prototype", "constructor", "toString", "valueOf", "hasOwnProperty"]) {
      const r = resolveBinding(binding({ path: `${key}.price` }), { collections: [PRODUCTS], records: polluted });
      expect(r).toEqual({ status: "unresolved", reason: "unsafe-path" });
    }
  });

  it("never reads through an own __proto__ record value", () => {
    const malicious = JSON.parse('{"products":[{"__proto__":{"price":999}}]}') as CollectionRecords;
    const r = resolveBinding(binding({ path: "__proto__.price" }), { collections: [PRODUCTS], records: malicious });
    expect(r).toEqual({ status: "unresolved", reason: "unsafe-path" });
  });

  it("rejects out-of-bounds and negative array indexes", () => {
    const r1 = resolveBinding(binding({ path: "images[5].src" }), CONTEXT);
    expect(r1).toEqual({ status: "unresolved", reason: "missing-path" });
    const r2 = resolveBinding(binding({ path: "images[-1].src" }), CONTEXT);
    expect(r2).toEqual({ status: "unresolved", reason: "invalid-path" });
  });

  it("rejects unsafe values (functions, circular data, huge payloads)", () => {
    const fn: CollectionRecords = { products: [{ name: (() => "x") as unknown as string }] };
    expect(resolveBinding(binding({}), { collections: [PRODUCTS], records: fn })).toEqual({
      status: "unresolved",
      reason: "unsafe-value",
    });

    const circular: Record<string, unknown> = { name: "x" };
    circular.self = circular;
    const circ: CollectionRecords = { products: [circular] };
    expect(resolveBinding(binding({ path: "self", field: "name" }), { collections: [PRODUCTS], records: circ })).toEqual({
      status: "unresolved",
      reason: "unsafe-value",
    });

    const huge: CollectionRecords = { products: [{ name: "x".repeat(60_000) }] };
    expect(resolveBinding(binding({}), { collections: [PRODUCTS], records: huge })).toEqual({
      status: "unresolved",
      reason: "unsafe-value",
    });
  });

  it("is deterministic — same inputs always produce the same result", () => {
    const a = resolveBinding(binding({ path: "price", field: "price" }), CONTEXT);
    const b = resolveBinding(binding({ path: "price", field: "price" }), CONTEXT);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("never throws on hostile input", () => {
    const hostile: unknown[] = [
      null,
      undefined,
      "collection",
      42,
      { source: "collection", collectionId: "products", path: "__proto__.x" },
      { source: "collection", path: "a[999999999999].b" },
      { source: "collection", path: "a".repeat(10_000) },
      { source: "collection", path: "x", collectionId: "products" },
    ];
    for (const input of hostile) {
      expect(() => resolveBinding(input as ElementBinding, CONTEXT)).not.toThrow();
    }
  });
});

describe("resolveNodeBindingProps", () => {
  it("overrides the bound prop when resolved; keeps fallback when unresolved", () => {
    const node = { binding: binding({ path: "name", field: "text" }), props: { text: "Fallback" } };
    expect(resolveNodeBindingProps(node, CONTEXT)).toEqual({ text: "Nimbus Pro" });

    const unresolved = { binding: binding({ path: "ghost" }), props: { text: "Fallback" } };
    expect(resolveNodeBindingProps(unresolved, CONTEXT)).toEqual({ text: "Fallback" });
  });

  it("keeps props unchanged when there is no binding", () => {
    const node = { props: { text: "Static" } };
    expect(resolveNodeBindingProps(node, CONTEXT)).toEqual({ text: "Static" });
  });

  it("gates src props through the image policy as defense-in-depth", () => {
    const node = {
      binding: { source: "collection" as const, collectionId: "products", path: "link", field: "src" },
      props: { src: "fallback.png" },
    };
    // The record link is https — but as an image src it still passes.
    expect(resolveNodeBindingProps(node, CONTEXT)).toEqual({ src: "https://example.com/buy" });

    const javascript = {
      binding: { source: "collection" as const, collectionId: "products", path: "name", field: "src" },
      props: { src: "fallback.png" },
    };
    // A javascript: value for src → fallback kept (never an unsafe src).
    expect(
      resolveNodeBindingProps(javascript, {
        collections: [PRODUCTS],
        records: { products: [{ name: "javascript:alert(1)" }] },
      }),
    ).toEqual({ src: "fallback.png" });
  });
});

describe("bakeTreeBindings / export snapshot", () => {
  function makeTree(): ElementTree {
    const headingId = "node-1";
    return {
      rootIds: ["root"],
      nodes: {
        root: { id: "root", type: "container", parentId: null, children: [headingId], props: {}, style: {}, responsive: {}, visible: true, locked: false, hidden: false },
        [headingId]: {
          id: headingId,
          type: "heading",
          parentId: "root",
          children: [],
          props: { text: "Fallback heading" },
          style: {},
          responsive: {},
          visible: true,
          locked: false,
          hidden: false,
          binding: binding({ path: "name", field: "text" }),
        },
      },
    };
  }

  it("bakes resolved values into props and removes binding metadata", () => {
    const baked = bakeTreeBindings(makeTree(), CONTEXT);
    expect(baked.nodes["node-1"].props.text).toBe("Nimbus Pro");
    expect(baked.nodes["node-1"].binding).toBeUndefined();
    expect(baked.nodes["node-1"].id).toBe("node-1");
    // Root node (no binding) is untouched structurally.
    expect(baked.nodes.root.children).toEqual(["node-1"]);
  });

  it("keeps the static fallback for unresolved bindings", () => {
    const tree = makeTree();
    tree.nodes["node-1"].binding = binding({ path: "ghost" });
    const baked = bakeTreeBindings(tree, CONTEXT);
    expect(baked.nodes["node-1"].props.text).toBe("Fallback heading");
    expect(baked.nodes["node-1"].binding).toBeUndefined();
  });

  it("resolveProjectBindingsForExport bakes only custom-block trees and never mutates the input", () => {
    const project: Project = {
      id: "p1",
      name: "P",
      theme: {
        palette: { background: "#fff", foreground: "#000", primary: "#7c5cfc", primaryForeground: "#fff", secondary: "#eee", secondaryForeground: "#000", muted: "#eee", mutedForeground: "#777", accent: "#7c5cfc", accentForeground: "#fff", border: "#ddd", card: "#fff", cardForeground: "#000" },
        typography: { fontFamily: "Geist", headingFont: "Geist", baseSize: "16px", scale: 1.25 },
        spacing: { sectionPadding: "6rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
        radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
        shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
      },
      assets: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      collections: [PRODUCTS],
      pages: [
        {
          id: "page-1",
          title: "Home",
          slug: "/",
          sections: [
            {
              id: "s1",
              type: "custom-block",
              order: 1,
              visible: true,
              props: { name: "Design", tree: makeTree() },
              styles: {},
            },
            {
              id: "s2",
              type: "hero",
              order: 2,
              visible: true,
              props: { headline: "Static" },
              styles: {},
            },
          ],
        },
      ],
    };
    const before = JSON.stringify(project);
    const resolved = resolveProjectBindingsForExport(project, RECORDS);
    expect(JSON.stringify(project)).toBe(before); // input untouched

    const tree = (resolved.pages[0].sections[0].props as { tree: ElementTree }).tree;
    expect(tree.nodes["node-1"].props.text).toBe("Nimbus Pro");
    expect(tree.nodes["node-1"].binding).toBeUndefined();
    // Non-custom-block section props are untouched.
    expect(resolved.pages[0].sections[1].props.headline).toBe("Static");
  });
});

describe("URL safety helpers", () => {
  it("accepts http(s), relative and hash links; rejects javascript/vbscript/data", () => {
    expect(isSafeBindingImageValue("https://cdn.example.com/a.png")).toBe(true);
    expect(isSafeBindingImageValue("/images/a.png")).toBe(true);
    expect(isSafeBindingImageValue("javascript:alert(1)")).toBe(false);
    expect(isSafeBindingImageValue("data:text/html,<script>")).toBe(false);

    expect(isSafeBindingUrlValue("https://example.com/x")).toBe(true);
    expect(isSafeBindingUrlValue("mailto:hi@example.com")).toBe(true);
    expect(isSafeBindingUrlValue("#section")).toBe(true);
    expect(isSafeBindingUrlValue("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeBindingUrlValue("data:text/html,x")).toBe(false);
  });
});
