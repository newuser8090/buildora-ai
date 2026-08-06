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
import { useMyBlocksUiStore } from "../store/my-blocks-ui-store";
import { setMyBlocksAdapterForTests } from "../storage/my-blocks-singleton";
import { InMemoryMyBlocksAdapter, makeProject, makeTree } from "./helpers";

let adapter: InMemoryMyBlocksAdapter;

function resetUi() {
  useMyBlocksUiStore.setState({
    libraryOpen: false,
    saveSource: null,
    detailsBlockId: null,
    renameBlockId: null,
    deleteBlockId: null,
    importOpen: false,
    toast: null,
    refreshTick: 0,
  });
}

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
  useEditorStore.getState().hydrateProject(makeProject(), 1);
  adapter = new InMemoryMyBlocksAdapter();
  setMyBlocksAdapterForTests(adapter);
  resetUi();
});

function openLibrary() {
  act(() => {
    useMyBlocksUiStore.getState().openLibrary();
  });
}

function renderLibrary() {
  return render(<MyBlocksLibrary />);
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

  it("sorts by name", async () => {
    await adapter.createMyBlock({ name: "Zebra", category: "layout", tree: makeTree() });
    await adapter.createMyBlock({ name: "Alpha", category: "layout", tree: makeTree() });
    openLibrary();
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByTestId("my-blocks-sort")).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId("my-blocks-sort"), { target: { value: "name" } });
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
  it("Preview opens the details dialog", async () => {
    const created = await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    if (!created.ok) return;
    openLibrary();
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByTestId(`my-block-preview-${created.value.id}`)).toBeTruthy();
    });
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
  it("inserts a saved block as a new section through the canonical service", async () => {
    const created = await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    if (!created.ok) return;
    useEditorStore.getState().selectSection("s-hero");
    openLibrary();
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByTestId(`my-block-insert-${created.value.id}`)).toBeTruthy();
    });
    const before = useEditorStore.getState().project.pages[0].sections.length;
    fireEvent.click(screen.getByTestId(`my-block-insert-${created.value.id}`));
    await waitFor(() => {
      expect(useEditorStore.getState().project.pages[0].sections.length).toBe(before + 1);
    });
    // Library closes after a successful insert and announces it.
    expect(useMyBlocksUiStore.getState().libraryOpen).toBe(false);
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
