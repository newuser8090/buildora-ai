// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// MyBlocksLibrary — component tests (Phase P4)
//
//   - loading state, empty state
//   - search + category filter + sorting
//   - preview / rename / duplicate / delete open the canonical dialogs
//   - insert through the canonical service (fresh IDs, one history entry)
//   - storage errors surfaced, unmount safety, Escape + focus behavior
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";
import { MyBlocksLibrary } from "../components/MyBlocksLibrary";
import { PlacementPickerDialog } from "../components/PlacementPickerDialog";
import { useMyBlocksUiStore } from "../store/my-blocks-ui-store";
import { setMyBlocksAdapterForTests } from "../storage/my-blocks-singleton";
import { setMyBlockThumbnailStorageForTests } from "../thumbnails/my-block-thumbnail-singleton";
import { InMemoryMyBlocksAdapter, makeProject, makeTree } from "./helpers";
import type { MyBlockThumbnailStorageAdapter } from "../thumbnails/my-block-thumbnail-types";

// A no-op thumbnail storage so the library's usage footer never touches
// IndexedDB in these component tests.
const noopThumbStorage: MyBlockThumbnailStorageAdapter = {
  getThumbnail: async () => ({ ok: false, error: { code: "THUMBNAIL_NOT_FOUND", message: "none" } }),
  saveThumbnail: async () => ({ ok: false, error: { code: "THUMBNAIL_GENERATION_FAILED", message: "noop" } }),
  removeThumbnail: async () => ({ ok: true, value: { blockId: "" } }),
  listThumbnailMetadata: async () => ({ ok: true, value: [] }),
  estimateThumbnailUsage: async () => ({ ok: true, value: { count: 0, bytes: 0 } }),
  close: () => {},
};

let adapter: InMemoryMyBlocksAdapter;

function resetUi() {
  useMyBlocksUiStore.setState({
    libraryOpen: false,
    saveSource: null,
    detailsBlockId: null,
    renameBlockId: null,
    deleteBlockId: null,
    importOpen: false,
    placementBlock: null,
    collectionDialog: null,
    moveBlockIds: null,
    bulkDeleteBlockIds: null,
    toast: null,
    refreshTick: 0,
  });
}

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
  useEditorStore.getState().hydrateProject(makeProject(), 1);
  adapter = new InMemoryMyBlocksAdapter();
  setMyBlocksAdapterForTests(adapter);
  setMyBlockThumbnailStorageForTests(noopThumbStorage);
  // Library preferences persist in localStorage — clear them so one test's
  // section/collection selection never pollutes the next.
  window.localStorage.removeItem("buildora:my-blocks-preferences");
  resetUi();
});

function openLibrary() {
  act(() => {
    useMyBlocksUiStore.getState().openLibrary();
  });
}

function renderLibrary() {
  // The placement picker lives in MyBlocksRoot; render it alongside the
  // library so the insert flow can be exercised end to end.
  return render(
    <>
      <MyBlocksLibrary />
      <PlacementPickerDialog />
    </>,
  );
}

describe("MyBlocksLibrary — states", () => {
  it("renders nothing when closed", () => {
    const { container } = renderLibrary();
    expect(container.querySelector('[data-testid="my-blocks-library"]')).toBeNull();
  });

  it("shows a loading state then the empty state for a fresh library", async () => {
    openLibrary();
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByTestId("my-blocks-empty")).toBeTruthy();
    });
    expect(screen.getByText(/No saved blocks yet/)).toBeTruthy();
  });

  it("lists saved blocks as cards", async () => {
    await adapter.createMyBlock({ name: "Hero A", category: "layout", tree: makeTree() });
    await adapter.createMyBlock({ name: "Contact form", category: "forms", tree: makeTree() });
    const list = await adapter.listMyBlocks();
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    openLibrary();
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByTestId(`my-block-card-${list.value[0].id}`)).toBeTruthy();
    });
    for (const block of list.value) {
      expect(screen.getByText(block.name)).toBeTruthy();
    }
  });
});

describe("MyBlocksLibrary — search / filter / sort", () => {
  it("filters by search query across name, description and tags", async () => {
    const a = await adapter.createMyBlock({ name: "Hero A", category: "layout", tree: makeTree() });
    const b = await adapter.createMyBlock({
      name: "Signup",
      description: "Collects leads",
      category: "forms",
      tree: makeTree(),
    });
    if (!a.ok || !b.ok) return;
    openLibrary();
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByTestId(`my-block-card-${a.value!.id}`)).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId("my-blocks-search"), { target: { value: "leads" } });
    expect(screen.queryByTestId(`my-block-card-${a.value!.id}`)).toBeNull();
    expect(screen.getByTestId(`my-block-card-${b.value!.id}`)).toBeTruthy();
  });

  it("filters by category", async () => {
    const a = await adapter.createMyBlock({ name: "Hero A", category: "layout", tree: makeTree() });
    const b = await adapter.createMyBlock({ name: "Signup", category: "forms", tree: makeTree() });
    if (!a.ok || !b.ok) return;
    openLibrary();
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByTestId(`my-block-card-${a.value!.id}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("my-blocks-cat-forms"));
    expect(screen.queryByTestId(`my-block-card-${a.value!.id}`)).toBeNull();
    expect(screen.getByTestId(`my-block-card-${b.value!.id}`)).toBeTruthy();
  });

  it("sorts by name (A–Z)", async () => {
    await adapter.createMyBlock({ name: "Zebra", category: "layout", tree: makeTree() });
    await adapter.createMyBlock({ name: "Alpha", category: "layout", tree: makeTree() });
    openLibrary();
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByTestId("my-blocks-sort")).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId("my-blocks-sort"), { target: { value: "name-asc" } });
    const cards = await waitFor(() =>
      Array.from(document.querySelectorAll('[data-testid^="my-block-card-"]')),
    );
    const names = cards.map((c) => c.textContent);
    const alphaIndex = names.findIndex((n) => n?.includes("Alpha"));
    const zebraIndex = names.findIndex((n) => n?.includes("Zebra"));
    expect(alphaIndex).toBeGreaterThanOrEqual(0);
    expect(zebraIndex).toBeGreaterThan(alphaIndex);
  });
});

describe("MyBlocksLibrary — card actions use canonical dialogs", () => {
  it("Preview (via the More menu) opens the details dialog", async () => {
    const created = await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    if (!created.ok) return;
    openLibrary();
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByTestId(`my-block-menu-${created.value.id}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId(`my-block-menu-${created.value.id}`));
    fireEvent.click(screen.getByTestId(`my-block-preview-${created.value.id}`));
    expect(useMyBlocksUiStore.getState().detailsBlockId).toBe(created.value.id);
  });

  it("Rename / Duplicate / Delete open the canonical dialogs", async () => {
    const created = await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    if (!created.ok) return;
    openLibrary();
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByTestId(`my-block-menu-${created.value.id}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId(`my-block-menu-${created.value.id}`));
    fireEvent.click(screen.getByTestId(`my-block-rename-${created.value.id}`));
    expect(useMyBlocksUiStore.getState().renameBlockId).toBe(created.value.id);

    fireEvent.click(screen.getByTestId(`my-block-menu-${created.value.id}`));
    fireEvent.click(screen.getByTestId(`my-block-delete-${created.value.id}`));
    expect(useMyBlocksUiStore.getState().deleteBlockId).toBe(created.value.id);
  });

  it("Duplicate creates an independent record and bumps refresh", async () => {
    const created = await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    if (!created.ok) return;
    openLibrary();
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByTestId(`my-block-menu-${created.value.id}`)).toBeTruthy();
    });
    const tickBefore = useMyBlocksUiStore.getState().refreshTick;
    fireEvent.click(screen.getByTestId(`my-block-menu-${created.value.id}`));
    fireEvent.click(screen.getByTestId(`my-block-duplicate-${created.value.id}`));
    await waitFor(() => {
      expect(useMyBlocksUiStore.getState().refreshTick).toBeGreaterThan(tickBefore);
    });
    expect(useMyBlocksUiStore.getState().toast).toContain("duplicated");
    const list = await adapter.listMyBlocks();
    expect(list.ok && list.value).toHaveLength(2);
  });
});

describe("MyBlocksLibrary — insert", () => {
  it("Insert opens the placement picker; choosing a spot inserts through the canonical service", async () => {
    const created = await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    if (!created.ok) return;
    useEditorStore.getState().selectSection("s-hero");
    openLibrary();
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByTestId(`my-block-insert-${created.value.id}`)).toBeTruthy();
    });
    // Insert opens the placement picker (Phase P5) instead of auto-inserting.
    fireEvent.click(screen.getByTestId(`my-block-insert-${created.value.id}`));
    expect(useMyBlocksUiStore.getState().placementBlock?.id).toBe(created.value.id);
    // The picker offers the selected-context option; picking it commits once.
    const before = useEditorStore.getState().project.pages[0].sections.length;
    fireEvent.click(screen.getByTestId("placement-option-below"));
    await waitFor(() => {
      expect(useEditorStore.getState().project.pages[0].sections.length).toBe(before + 1);
    });
    // Library + picker close after a successful insert and announce it.
    expect(useMyBlocksUiStore.getState().libraryOpen).toBe(false);
    expect(useMyBlocksUiStore.getState().placementBlock).toBeNull();
    expect(useMyBlocksUiStore.getState().toast).toContain("added to your page");
    // Exactly one history entry for the whole copy.
    expect(useEditorStore.getState().history.past.length).toBe(1);
  });
});

describe("MyBlocksLibrary — errors and safety", () => {
  it("surfaces a storage load error", async () => {
    vi.spyOn(adapter, "listMyBlocks").mockResolvedValue({
      ok: false,
      error: { code: "DATABASE_OPEN_FAILED", message: "Failed to open the saved-blocks database." },
    });
    openLibrary();
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByTestId("my-blocks-error").textContent).toContain("Failed to open");
    });
  });

  it("Escape closes the library", async () => {
    await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    openLibrary();
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByTestId("my-blocks-library")).toBeTruthy();
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useMyBlocksUiStore.getState().libraryOpen).toBe(false);
  });

  it("unmounting while the library is open never throws", () => {
    openLibrary();
    const { unmount } = renderLibrary();
    unmount();
    expect(() => {
      useMyBlocksUiStore.getState().openLibrary();
    }).not.toThrow();
  });
});

describe("MyBlocksLibrary — favorites and recent sections", () => {
  it("favorite toggle stars a block and persists through the adapter", async () => {
    const created = await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    if (!created.ok) return;
    openLibrary();
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByTestId(`my-block-favorite-${created.value.id}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId(`my-block-favorite-${created.value.id}`));
    await waitFor(() => {
      expect(useMyBlocksUiStore.getState().toast).toContain("Favorites");
    });
    const after = await adapter.getMyBlock(created.value.id);
    expect(after.ok && after.value.favorite).toBe(true);
  });

  it("Favorites section shows only starred blocks", async () => {
    const a = await adapter.createMyBlock({ name: "Starred", category: "layout", tree: makeTree() });
    const b = await adapter.createMyBlock({ name: "Plain", category: "layout", tree: makeTree() });
    if (!a.ok || !b.ok) return;
    await adapter.updateMyBlock(a.value.id, { favorite: true });
    openLibrary();
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByTestId(`my-block-card-${a.value.id}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("my-blocks-section-favorites"));
    await waitFor(() => {
      expect(screen.queryByTestId(`my-block-card-${b.value.id}`)).toBeNull();
    });
    expect(screen.getByTestId(`my-block-card-${a.value.id}`)).toBeTruthy();
  });
});

describe("MyBlocksLibrary — collections", () => {
  it("collections section lists collections and filters their members", async () => {
    const created = await adapter.createMyBlockCollection({ name: "Landing" });
    if (!created.ok) return;
    const block = await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    const other = await adapter.createMyBlock({ name: "Other", category: "layout", tree: makeTree() });
    if (!block.ok || !other.ok) return;
    await adapter.updateMyBlock(block.value.id, { collectionIds: [created.value.id] });

    openLibrary();
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByTestId(`my-block-card-${block.value.id}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("my-blocks-section-collections"));
    await waitFor(() => {
      expect(screen.getByTestId(`my-blocks-collection-${created.value.id}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId(`my-blocks-collection-${created.value.id}`));
    await waitFor(() => {
      expect(screen.queryByTestId(`my-block-card-${other.value.id}`)).toBeNull();
    });
    expect(screen.getByTestId(`my-block-card-${block.value.id}`)).toBeTruthy();
  });

  it("card shows a collection chip for its membership", async () => {
    const collection = await adapter.createMyBlockCollection({ name: "Landing" });
    const block = await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    if (!collection.ok || !block.ok) return;
    await adapter.updateMyBlock(block.value.id, { collectionIds: [collection.value.id] });
    openLibrary();
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByTestId(`my-block-collection-chip-${collection.value.id}`)).toBeTruthy();
    });
  });
});

describe("MyBlocksLibrary — grid/list view toggle (persisted preferences)", () => {
  it("switches between grid and list and persists the choice", async () => {
    await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    openLibrary();
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByTestId("my-blocks-grid")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("my-blocks-view-list"));
    await waitFor(() => {
      expect(screen.getByTestId("my-blocks-grid").className).toContain("flex-col");
    });
    // The preference was persisted to localStorage (harmless UI state only).
    const raw = window.localStorage.getItem("buildora:my-blocks-preferences");
    expect(raw).toBeTruthy();
    if (raw) expect(JSON.parse(raw).view).toBe("list");
  });
});

describe("MyBlocksLibrary — selection mode and bulk actions", () => {
  async function seedBlocks(count: number) {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const created = await adapter.createMyBlock({ name: `Block ${i}`, category: "layout", tree: makeTree() });
      if (created.ok) ids.push(created.value.id);
    }
    return ids;
  }

  it("selection mode lets you select individual cards and counts them", async () => {
    const ids = await seedBlocks(3);
    openLibrary();
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByTestId(`my-block-card-${ids[0]}`)).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("my-blocks-select-mode"));
    await waitFor(() => {
      expect(screen.getByTestId("my-blocks-selection-toolbar")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId(`my-block-select-${ids[0]}`));
    fireEvent.click(screen.getByTestId(`my-block-select-${ids[1]}`));
    expect(screen.getByText("2 selected")).toBeTruthy();
  });

  it("Select all visible selects every visible card; Clear empties it", async () => {
    const ids = await seedBlocks(3);
    openLibrary();
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByTestId(`my-block-card-${ids[0]}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("my-blocks-select-mode"));
    await waitFor(() => {
      expect(screen.getByTestId("my-blocks-select-all")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("my-blocks-select-all"));
    expect(screen.getByText("3 selected")).toBeTruthy();
    // Toggle becomes Clear when everything is selected.
    fireEvent.click(screen.getByTestId("my-blocks-select-all"));
    expect(screen.getByText("0 selected")).toBeTruthy();
  });

  it("bulk favorite updates every selected record", async () => {
    const ids = await seedBlocks(2);
    openLibrary();
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByTestId(`my-block-card-${ids[0]}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("my-blocks-select-mode"));
    await waitFor(() => {
      expect(screen.getByTestId("my-blocks-select-all")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("my-blocks-select-all"));
    fireEvent.click(screen.getByTestId("my-blocks-bulk-favorite"));
    await waitFor(() => {
      expect(useMyBlocksUiStore.getState().toast).toContain("Favorited 2");
    });
    for (const id of ids) {
      const after = await adapter.getMyBlock(id);
      expect(after.ok && after.value.favorite).toBe(true);
    }
  });

  it("bulk delete opens the confirmation dialog with the selected count", async () => {
    const ids = await seedBlocks(2);
    openLibrary();
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByTestId(`my-block-card-${ids[0]}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("my-blocks-select-mode"));
    await waitFor(() => {
      expect(screen.getByTestId("my-blocks-select-all")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("my-blocks-select-all"));
    fireEvent.click(screen.getByTestId("my-blocks-bulk-delete"));
    const state = useMyBlocksUiStore.getState();
    expect(new Set(state.bulkDeleteBlockIds ?? [])).toEqual(new Set(ids));
  });

  it("bulk move opens the move-to-collection dialog with the selected ids", async () => {
    const ids = await seedBlocks(2);
    openLibrary();
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByTestId(`my-block-card-${ids[0]}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("my-blocks-select-mode"));
    await waitFor(() => {
      expect(screen.getByTestId("my-blocks-select-all")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("my-blocks-select-all"));
    fireEvent.click(screen.getByTestId("my-blocks-bulk-move"));
    // Order follows the filtered list; compare as sets.
    const opened = useMyBlocksUiStore.getState().moveBlockIds ?? [];
    expect(new Set(opened)).toEqual(new Set(ids));
  });
});
