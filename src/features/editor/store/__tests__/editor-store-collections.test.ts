// ---------------------------------------------------------------------------
// Editor store — collections (Phase P22-J)
//   - collection CRUD through the store boundary (withHistory)
//   - exactly ONE history entry per mutation; undo/redo restore state
//   - field add/remove/rename/type-change
//   - invalid names/types/limits rejected (never stored)
//   - no-op (identical content) skips history
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { Project } from "@/types/project";

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "proj-p22j-store",
    name: "P22J Store",
    theme: {
      palette: {
        background: "#fff", foreground: "#0a0a0a", primary: "#7c5cfc",
        primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#fff", border: "#e5e5e5", card: "#fff", cardForeground: "#0a0a0a",
      },
      typography: { fontFamily: "Geist", headingFont: "Geist", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "6rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
    pages: [
      {
        id: "page-1",
        title: "Home",
        slug: "/",
        sections: [
          { id: "s-hero", type: "hero", order: 1, visible: true, props: {}, styles: {} },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function collections() {
  return useEditorStore.getState().project.collections ?? [];
}

beforeEach(() => {
  useEditorStore.getState().initProject(makeProject());
});

describe("collection CRUD", () => {
  it("adds a collection with fields (one history entry)", () => {
    const before = useEditorStore.getState().history.past.length;
    const result = useEditorStore
      .getState()
      .addCollection("Products", [
        { id: "f1", name: "name", type: "text" },
        { id: "f2", name: "price", type: "number" },
      ]);
    expect(result.ok).toBe(true);
    expect(useEditorStore.getState().history.past.length).toBe(before + 1);
    const list = collections();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Products");
    expect(list[0].fields).toHaveLength(2);
  });

  it("renames a collection", () => {
    useEditorStore.getState().addCollection("Products");
    const id = collections()[0].id;
    const result = useEditorStore.getState().renameCollection(id, "Catalog");
    expect(result.ok).toBe(true);
    expect(collections()[0].name).toBe("Catalog");
  });

  it("deletes a collection", () => {
    useEditorStore.getState().addCollection("Products");
    const id = collections()[0].id;
    useEditorStore.getState().deleteCollection(id);
    expect(collections()).toHaveLength(0);
  });

  it("rejects an empty collection name", () => {
    const result = useEditorStore.getState().addCollection("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("COLLECTION_NAME_INVALID");
    expect(collections()).toHaveLength(0);
  });

  it("rejects renaming a missing collection", () => {
    const result = useEditorStore.getState().renameCollection("ghost", "X");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("COLLECTION_NOT_FOUND");
  });
});

describe("collection fields", () => {
  function setup(): string {
    useEditorStore.getState().addCollection("Products");
    return collections()[0].id;
  }

  it("adds a field (one history entry)", () => {
    const id = setup();
    const before = useEditorStore.getState().history.past.length;
    const result = useEditorStore.getState().addCollectionField(id, "price", "number");
    expect(result.ok).toBe(true);
    expect(useEditorStore.getState().history.past.length).toBe(before + 1);
    expect(collections()[0].fields).toHaveLength(1);
    expect(collections()[0].fields[0]).toMatchObject({ name: "price", type: "number" });
  });

  it("removes a field", () => {
    const id = setup();
    useEditorStore.getState().addCollectionField(id, "name", "text");
    useEditorStore.getState().addCollectionField(id, "price", "number");
    const fieldId = collections()[0].fields[0].id;
    const result = useEditorStore.getState().removeCollectionField(id, fieldId);
    expect(result.ok).toBe(true);
    expect(collections()[0].fields).toHaveLength(1);
    expect(collections()[0].fields[0].name).toBe("price");
  });

  it("renames a field", () => {
    const id = setup();
    useEditorStore.getState().addCollectionField(id, "name", "text");
    const fieldId = collections()[0].fields[0].id;
    const result = useEditorStore.getState().renameCollectionField(id, fieldId, "title");
    expect(result.ok).toBe(true);
    expect(collections()[0].fields[0].name).toBe("title");
  });

  it("changes a field type", () => {
    const id = setup();
    useEditorStore.getState().addCollectionField(id, "name", "text");
    const fieldId = collections()[0].fields[0].id;
    const result = useEditorStore.getState().setCollectionFieldType(id, fieldId, "url");
    expect(result.ok).toBe(true);
    expect(collections()[0].fields[0].type).toBe("url");
  });

  it("rejects an unsupported field type", () => {
    const id = setup();
    const result = useEditorStore.getState().addCollectionField(id, "when", "date" as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("COLLECTION_FIELD_TYPE_INVALID");
  });

  it("rejects a missing field target", () => {
    const id = setup();
    const result = useEditorStore.getState().removeCollectionField(id, "ghost");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("COLLECTION_FIELD_NOT_FOUND");
  });
});

describe("undo / redo", () => {
  it("undoes and redoes a single collection action atomically", () => {
    useEditorStore.getState().addCollection("Products");
    expect(collections()).toHaveLength(1);
    const added = collections()[0].id;

    useEditorStore.getState().renameCollection(added, "Catalog");
    expect(collections()[0].name).toBe("Catalog");

    useEditorStore.getState().undo();
    expect(collections()[0].name).toBe("Products");
    useEditorStore.getState().undo();
    expect(collections()).toHaveLength(0);
    useEditorStore.getState().redo();
    expect(collections()[0].name).toBe("Products");
  });

  it("undoes field adds together with the collection (single entries)", () => {
    useEditorStore.getState().addCollection("Products");
    const id = collections()[0].id;
    useEditorStore.getState().addCollectionField(id, "price", "number");
    expect(collections()[0].fields).toHaveLength(1);
    useEditorStore.getState().undo();
    expect(collections()[0].fields).toHaveLength(0);
    useEditorStore.getState().redo();
    expect(collections()[0].fields).toHaveLength(1);
  });

  it("a no-op rename does not create a history entry", () => {
    useEditorStore.getState().addCollection("Products");
    const id = collections()[0].id;
    const before = useEditorStore.getState().history.past.length;
    const result = useEditorStore.getState().renameCollection(id, "Products");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(false);
    expect(useEditorStore.getState().history.past.length).toBe(before);
  });
});
