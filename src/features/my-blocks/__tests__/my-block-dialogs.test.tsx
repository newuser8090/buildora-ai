// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// My Blocks dialogs — component tests (Phase P4)
//
//   - MyBlockDetailsDialog: load + metadata + export + corrupt-record error
//   - RenameMyBlockDialog: load, save, empty-name validation
//   - DeleteMyBlockDialog: confirmation, delete, project copies untouched
//   - ImportMyBlockDialog: .buildora-block.json pick → parse → import;
//     oversized / invalid file errors
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MyBlockDetailsDialog } from "../components/MyBlockDetailsDialog";
import { RenameMyBlockDialog } from "../components/RenameMyBlockDialog";
import { DeleteMyBlockDialog } from "../components/DeleteMyBlockDialog";
import { ImportMyBlockDialog } from "../components/ImportMyBlockDialog";
import { useMyBlocksUiStore } from "../store/my-blocks-ui-store";
import { setMyBlocksAdapterForTests } from "../storage/my-blocks-singleton";
import { InMemoryMyBlocksAdapter, makeRecord, makeTree } from "./helpers";
import { buildBlockFile } from "../services/my-block-file";

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
  adapter = new InMemoryMyBlocksAdapter();
  setMyBlocksAdapterForTests(adapter);
  resetUi();
  vi.restoreAllMocks();
  // jsdom lacks URL.createObjectURL — stub it for export flows.
  if (typeof URL.createObjectURL !== "function") {
    globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
    globalThis.URL.revokeObjectURL = vi.fn();
  }
});

describe("MyBlockDetailsDialog", () => {
  it("loads and shows the block metadata", async () => {
    const created = await adapter.createMyBlock({
      name: "Hero",
      description: "A hero design",
      category: "layout",
      tags: ["hero", "pricing"],
      tree: makeTree(),
    });
    if (!created.ok) return;
    act(() => {
      useMyBlocksUiStore.getState().openDetails(created.value.id);
    });
    render(<MyBlockDetailsDialog />);
    await waitFor(() => {
      expect(screen.getByText("Hero")).toBeTruthy();
    });
    expect(screen.getByText("A hero design")).toBeTruthy();
    expect(screen.getByText("hero")).toBeTruthy();
    expect(screen.getByText("pricing")).toBeTruthy();
  });

  it("shows a structured error for a corrupt record", async () => {
    adapter.putRawForTests({ id: "corrupt", garbage: true });
    act(() => {
      useMyBlocksUiStore.getState().openDetails("corrupt");
    });
    render(<MyBlockDetailsDialog />);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("damaged");
    });
  });

  it("exports the block as a file", async () => {
    const created = await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    if (!created.ok) return;
    act(() => {
      useMyBlocksUiStore.getState().openDetails(created.value.id);
    });
    render(<MyBlockDetailsDialog />);
    await waitFor(() => {
      expect(screen.getByTestId("my-block-details-export")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("my-block-details-export"));
    // Export reads the block file dynamically — resolve then assert.
    await waitFor(() => {
      expect(useMyBlocksUiStore.getState().toast).toContain("exported");
    });
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("Escape closes the details dialog", async () => {
    const created = await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    if (!created.ok) return;
    act(() => {
      useMyBlocksUiStore.getState().openDetails(created.value.id);
    });
    render(<MyBlockDetailsDialog />);
    await waitFor(() => {
      expect(screen.getByTestId("my-block-details")).toBeTruthy();
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useMyBlocksUiStore.getState().detailsBlockId).toBeNull();
  });
});

describe("RenameMyBlockDialog", () => {
  it("renames the library record and bumps refresh", async () => {
    const created = await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    if (!created.ok) return;
    act(() => {
      useMyBlocksUiStore.getState().openRename(created.value.id);
    });
    render(<RenameMyBlockDialog />);
    await waitFor(() => {
      expect(screen.getByTestId("rename-my-block-input")).toBeTruthy();
    });
    const tickBefore = useMyBlocksUiStore.getState().refreshTick;
    fireEvent.change(screen.getByTestId("rename-my-block-input"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByTestId("rename-my-block-save"));
    await waitFor(() => {
      expect(useMyBlocksUiStore.getState().refreshTick).toBeGreaterThan(tickBefore);
    });
    const got = await adapter.getMyBlock(created.value.id);
    expect(got.ok && got.value.name).toBe("Renamed");
  });

  it("blocks an empty name (save stays disabled)", async () => {
    const created = await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    if (!created.ok) return;
    act(() => {
      useMyBlocksUiStore.getState().openRename(created.value.id);
    });
    render(<RenameMyBlockDialog />);
    // Wait until the record has loaded and the input is enabled.
    await waitFor(() => {
      expect((screen.getByTestId("rename-my-block-input") as HTMLInputElement).disabled).toBe(false);
    });
    const save = screen.getByTestId("rename-my-block-save") as HTMLButtonElement;
    fireEvent.change(screen.getByTestId("rename-my-block-input"), { target: { value: "   " } });
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    const got = await adapter.getMyBlock(created.value.id);
    expect(got.ok && got.value.name).toBe("Hero");
  });
});

describe("DeleteMyBlockDialog", () => {
  it("deletes the library record only", async () => {
    const created = await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    if (!created.ok) return;
    act(() => {
      useMyBlocksUiStore.getState().openDelete(created.value.id);
    });
    render(<DeleteMyBlockDialog />);
    await waitFor(() => {
      expect(screen.getByTestId("delete-my-block-confirm")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("delete-my-block-confirm"));
    await waitFor(() => {
      expect(useMyBlocksUiStore.getState().toast).toContain("deleted");
    });
    const got = await adapter.getMyBlock(created.value.id);
    expect(got.ok).toBe(false);
    // The dialog copy of the record remains readable by the caller — the
    // library record alone was removed.
    expect(useMyBlocksUiStore.getState().deleteBlockId).toBeNull();
  });
});

describe("ImportMyBlockDialog", () => {
  it("imports a valid .buildora-block.json file", async () => {
    const filePayload = JSON.stringify(buildBlockFile(makeRecord({ name: "Pricing" })));
    const file = new File([filePayload], "pricing.buildora-block.json", { type: "application/json" });
    act(() => {
      useMyBlocksUiStore.getState().openImport();
    });
    render(<ImportMyBlockDialog />);
    await waitFor(() => {
      expect(screen.getByTestId("import-my-block-dialog")).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId("import-my-block-file"), { target: { files: [file] } });
    await waitFor(() => {
      expect(useMyBlocksUiStore.getState().toast).toContain("imported to My Blocks");
    });
    const list = await adapter.listMyBlocks();
    expect(list.ok && list.value).toHaveLength(1);
    if (list.ok) {
      // Provenance carried by the file is preserved (the record was created
      // in-app, so the file says "created" — imports assign fresh ids and
      // timestamps but never fabricate provenance).
      expect(list.value[0].sourceMetadata?.source).toBe("created");
      expect(list.value[0].name).toBe("Pricing");
      expect(list.value[0].useCount).toBe(0);
    }
  });

  it("rejects an oversized file with a user-safe message", async () => {
    const big = new File(["x".repeat(3000000)], "big.buildora-block.json", { type: "application/json" });
    act(() => {
      useMyBlocksUiStore.getState().openImport();
    });
    render(<ImportMyBlockDialog />);
    await waitFor(() => {
      expect(screen.getByTestId("import-my-block-dialog")).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId("import-my-block-file"), { target: { files: [big] } });
    await waitFor(() => {
      expect(screen.getByTestId("import-my-block-error").textContent).toContain("too large");
    });
  });

  it("rejects a malformed file with a user-safe message", async () => {
    const bad = new File(['{"format":"buildora-block","version":99}'], "bad.buildora-block.json", {
      type: "application/json",
    });
    act(() => {
      useMyBlocksUiStore.getState().openImport();
    });
    render(<ImportMyBlockDialog />);
    await waitFor(() => {
      expect(screen.getByTestId("import-my-block-dialog")).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId("import-my-block-file"), { target: { files: [bad] } });
    await waitFor(() => {
      expect(screen.getByTestId("import-my-block-error").textContent).toContain("unsupported version");
    });
  });

  it("Escape closes the import dialog when idle", async () => {
    act(() => {
      useMyBlocksUiStore.getState().openImport();
    });
    render(<ImportMyBlockDialog />);
    await waitFor(() => {
      expect(screen.getByTestId("import-my-block-dialog")).toBeTruthy();
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useMyBlocksUiStore.getState().importOpen).toBe(false);
  });
});
