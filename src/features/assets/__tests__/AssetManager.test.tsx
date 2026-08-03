// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { AssetManager } from "../components/AssetManager";
import { AssetPicker } from "../components/AssetPicker";
import { AssetCard } from "../components/AssetCard";
import { DragDropZone } from "../components/DragDropZone";
import { ReplaceAssetInput } from "../components/ReplaceAssetInput";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { validateFile } from "@/features/assets/services/file-validator";
import type { Project } from "@/types/project";
import type { Asset } from "@/features/assets/types";

// ---------------------------------------------------------------------------
// Mock file-validator so we can control validation without real File objects
// ---------------------------------------------------------------------------
vi.mock("@/features/assets/services/file-validator", () => ({
  validateFile: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock image-processor to avoid FileReader dependency in jsdom
// ---------------------------------------------------------------------------
vi.mock("@/features/assets/services/image-processor", () => ({
  processImageFile: vi.fn().mockResolvedValue({
    id: "new-asset",
    name: "test.png",
    type: "image",
    mimeType: "image/png",
    extension: ".png",
    size: 1024,
    width: 100,
    height: 100,
    source: { type: "data-url", value: "data:image/png;base64,test" },
    createdAt: "2026-01-01T00:00:00.000Z",
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAsset(overrides?: Partial<Asset>): Asset {
  return {
    id: overrides?.id ?? "a1",
    name: overrides?.name ?? "logo.png",
    type: overrides?.type ?? "image",
    mimeType: overrides?.mimeType ?? "image/png",
    extension: overrides?.extension ?? ".png",
    size: overrides?.size ?? 1024,
    source: { type: "data-url", value: "data:image/png;base64,iVBOR" },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeProject(): Project {
  return {
    id: "proj-1",
    name: "Test",
    theme: {
      palette: {
        background: "#fff", foreground: "#000", primary: "#7c5cfc",
        primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#000",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#fff", border: "#e5e5e5", card: "#fff", cardForeground: "#000",
      },
      typography: { fontFamily: "sans-serif", headingFont: "sans-serif", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "5rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [
      makeAsset({ id: "a1", name: "logo.png", type: "logo" }),
      makeAsset({ id: "a2", name: "hero.jpg", type: "image", width: 1200, height: 800 }),
      makeAsset({ id: "a3", name: "bg.webp", type: "background" }),
    ],
    pages: [
      {
        id: "page-1", title: "Home", slug: "/",
        sections: [
          {
            id: "s-header", type: "header", order: 1, visible: true,
            props: { logoText: "Brand", logoImage: { assetId: "a1" }, navLinks: [] },
            styles: {},
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function setupStore(project?: Project) {
  const p = project ?? makeProject();
  useEditorStore.setState({
    project: p,
    selectedSectionId: null,
    selectedPageId: "page-1",
    viewport: "desktop",
    zoom: 100,
    isGenerating: false,
    generationProgress: 0,
    history: { past: [], present: JSON.parse(JSON.stringify(p)), future: [] },
    _editingSession: null,
  });
}

// ---------------------------------------------------------------------------
// Tests — AssetManager
// ---------------------------------------------------------------------------

describe("AssetManager — rendering", () => {
  beforeEach(() => setupStore());

  it("renders the modal with title", () => {
    render(<AssetManager onClose={() => {}} />);
    expect(screen.getByText("Asset Manager")).toBeDefined();
  });

  it("shows asset count", () => {
    render(<AssetManager onClose={() => {}} />);
    expect(screen.getByText("3 assets")).toBeDefined();
  });

  it("renders asset cards", () => {
    render(<AssetManager onClose={() => {}} />);
    expect(screen.getByText("logo.png")).toBeDefined();
    expect(screen.getByText("hero.jpg")).toBeDefined();
    expect(screen.getByText("bg.webp")).toBeDefined();
  });
});

describe("AssetManager — empty state", () => {
  it("shows empty state when no assets", () => {
    setupStore(makeProject());
    const p = useEditorStore.getState().project;
    p.assets = [];
    useEditorStore.setState({ project: { ...p } });
    render(<AssetManager onClose={() => {}} />);
    expect(screen.getByText("No assets found.")).toBeDefined();
  });
});

describe("AssetManager — search", () => {
  beforeEach(() => setupStore());

  it("filters by name (case-insensitive)", () => {
    render(<AssetManager onClose={() => {}} />);
    const input = screen.getByPlaceholderText("Search by name...");
    fireEvent.change(input, { target: { value: "LOGO" } });
    expect(screen.getByText("logo.png")).toBeDefined();
    expect(() => screen.getByText("hero.jpg")).toThrow();
  });

  it("shows empty state when no match", () => {
    render(<AssetManager onClose={() => {}} />);
    const input = screen.getByPlaceholderText("Search by name...");
    fireEvent.change(input, { target: { value: "nonexistent" } });
    expect(screen.getByText("No matching assets.")).toBeDefined();
  });
});

describe("AssetManager — filtering", () => {
  beforeEach(() => setupStore());

  it("filters by type", () => {
    render(<AssetManager onClose={() => {}} />);
    const select = screen.getByLabelText("Filter by asset type");
    fireEvent.change(select, { target: { value: "logo" } });
    expect(screen.getByText("logo.png")).toBeDefined();
    expect(() => screen.getByText("hero.jpg")).toThrow();
    expect(() => screen.getByText("bg.webp")).toThrow();
  });

  it("shows all assets for 'all' filter", () => {
    render(<AssetManager onClose={() => {}} />);
    expect(screen.getByText("logo.png")).toBeDefined();
    expect(screen.getByText("hero.jpg")).toBeDefined();
    expect(screen.getByText("bg.webp")).toBeDefined();
  });

  it("combines search and filter", () => {
    render(<AssetManager onClose={() => {}} />);
    const select = screen.getByLabelText("Filter by asset type");
    fireEvent.change(select, { target: { value: "image" } });
    const input = screen.getByPlaceholderText("Search by name...");
    fireEvent.change(input, { target: { value: "hero" } });
    expect(screen.getByText("hero.jpg")).toBeDefined();
    expect(() => screen.getByText("logo.png")).toThrow();
  });
});

describe("AssetManager — close behavior", () => {
  beforeEach(() => setupStore());

  it("calls onClose when backdrop is clicked", () => {
    const onClose = vi.fn();
    render(<AssetManager onClose={onClose} />);
    const backdrop = screen.getByRole("dialog");
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<AssetManager onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

// ---- Upload behavior ----

describe("AssetManager — upload behavior", () => {
  beforeEach(() => {
    setupStore();
    vi.clearAllMocks();
  });

  it("valid file adds asset to store (mocked processing)", async () => {
    const mockValidate = vi.mocked(validateFile);
    mockValidate.mockReturnValue({ valid: true });

    render(<AssetManager onClose={() => {}} />);

    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();

    const validFile = new File(["png"], "photo.png", { type: "image/png" });

    await act(async () => {
      fireEvent.change(fileInput!, { target: { files: [validFile] } });
      await new Promise((r) => setTimeout(r, 50));
    });

    const store = useEditorStore.getState();
    await waitFor(() => {
      expect(store.project.assets.length).toBeGreaterThanOrEqual(4);
    });
  });

  it("invalid file does not add to store", async () => {
    const mockValidate = vi.mocked(validateFile);
    mockValidate.mockReturnValue({ valid: false, error: "Unsupported file type." });

    render(<AssetManager onClose={() => {}} />);

    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();

    const invalidFile = new File(["dummy"], "test.exe", { type: "application/x-msdownload" });

    await act(async () => {
      fireEvent.change(fileInput!, { target: { files: [invalidFile] } });
      await new Promise((r) => setTimeout(r, 50));
    });

    // Verify store unchanged
    const store = useEditorStore.getState();
    expect(store.project.assets.length).toBe(3);

    // Verify validateFile was called (the upload code path was exercised)
    expect(mockValidate).toHaveBeenCalledWith(invalidFile);
  });

  it("mixed batch: valid file adds to store, invalid file does not", async () => {
    const mockValidate = vi.mocked(validateFile);
    // First call = valid, second call = invalid
    mockValidate
      .mockReturnValueOnce({ valid: true })
      .mockReturnValueOnce({ valid: false, error: "Unsupported file type." });

    render(<AssetManager onClose={() => {}} />);

    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();

    const validFile = new File(["png"], "photo.png", { type: "image/png" });
    const invalidFile = new File(["exe"], "bad.exe", { type: "application/x-msdownload" });

    // Process valid file first
    await act(async () => {
      fireEvent.change(fileInput!, { target: { files: [validFile] } });
      await new Promise((r) => setTimeout(r, 100));
    });

    // Process invalid file second
    await act(async () => {
      fireEvent.change(fileInput!, { target: { files: [invalidFile] } });
      await new Promise((r) => setTimeout(r, 50));
    });

    // Store should have gained exactly 1 asset (the valid one)
    const store = useEditorStore.getState();
    expect(store.project.assets.length).toBe(4);

    // validateFile was called twice (once per file)
    expect(mockValidate).toHaveBeenCalledTimes(2);
    expect(mockValidate).toHaveBeenNthCalledWith(1, validFile);
    expect(mockValidate).toHaveBeenNthCalledWith(2, invalidFile);
  });

  it("resets file input so the same file can be selected again", async () => {
    const mockValidate = vi.mocked(validateFile);
    mockValidate.mockReturnValue({ valid: true });

    render(<AssetManager onClose={() => {}} />);

    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();

    const file = new File(["png"], "photo.png", { type: "image/png" });

    await act(async () => {
      fireEvent.change(fileInput!, { target: { files: [file] } });
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(fileInput!.value).toBe("");
  });
});

// ---- Escape and backdrop blocking ----

describe("AssetManager — escape and backdrop blocking", () => {
  beforeEach(() => {
    setupStore();
    vi.clearAllMocks();
  });

  it("blocks Escape when delete dialog is open", () => {
    const onClose = vi.fn();
    render(<AssetManager onClose={onClose} />);

    const deleteButtons = screen.getAllByLabelText(/Delete/);
    fireEvent.click(deleteButtons[1]);

    expect(screen.getByText(/sure you want to delete/i)).toBeDefined();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("blocks backdrop click when rename dialog is open", () => {
    const onClose = vi.fn();
    render(<AssetManager onClose={onClose} />);

    const renameButtons = screen.getAllByLabelText(/Rename/);
    fireEvent.click(renameButtons[0]);

    expect(screen.getByText("Rename asset")).toBeDefined();

    // With rename dialog open there are two dialogs — get the first (asset manager)
    const backdrops = screen.getAllByRole("dialog");
    fireEvent.click(backdrops[0]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("blocks backdrop click when replace dialog is open", () => {
    const onClose = vi.fn();
    render(<AssetManager onClose={onClose} />);

    const replaceButtons = screen.getAllByLabelText(/Replace/);
    fireEvent.click(replaceButtons[0]);

    expect(screen.getByText(/Select replacement file/i)).toBeDefined();

    const backdrops = screen.getAllByRole("dialog");
    fireEvent.click(backdrops[0]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("allows Escape when no sub-dialog is open", () => {
    const onClose = vi.fn();
    render(<AssetManager onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---- Delete ----

describe("AssetManager — delete", () => {
  beforeEach(() => setupStore());

  it("shows delete confirmation for unused asset", () => {
    render(<AssetManager onClose={() => {}} />);
    const deleteButtons = screen.getAllByLabelText(/Delete/);
    fireEvent.click(deleteButtons[1]);
    expect(screen.getByText(/sure you want to delete/i)).toBeDefined();
    expect(screen.getByText("Delete")).toBeDefined();
    expect(screen.getByText("Cancel")).toBeDefined();
  });

  it("shows usage info for used asset", () => {
    render(<AssetManager onClose={() => {}} />);
    const deleteButtons = screen.getAllByLabelText(/Delete/);
    fireEvent.click(deleteButtons[0]);
    expect(screen.getByText(/used in your sections/i)).toBeDefined();
    expect(screen.getByText("Delete anyway")).toBeDefined();
  });

  it("cancels delete and closes dialog", () => {
    render(<AssetManager onClose={() => {}} />);
    const deleteButtons = screen.getAllByLabelText(/Delete/);
    fireEvent.click(deleteButtons[1]);
    expect(screen.getByText(/sure you want to delete/i)).toBeDefined();

    const cancelButton = screen.getByText("Cancel");
    fireEvent.click(cancelButton);
    expect(() => screen.getByText(/sure you want to delete/i)).toThrow();
  });

  it("deletes unused asset from store", () => {
    render(<AssetManager onClose={() => {}} />);
    const deleteButtons = screen.getAllByLabelText(/Delete/);
    fireEvent.click(deleteButtons[1]);

    const confirmButton = screen.getByText("Delete");
    fireEvent.click(confirmButton);

    const state = useEditorStore.getState();
    expect(state.project.assets.find((a) => a.id === "a2")).toBeUndefined();
  });
});

// ---- Rename ----

describe("AssetManager — rename", () => {
  beforeEach(() => setupStore());

  it("opens rename dialog", () => {
    render(<AssetManager onClose={() => {}} />);
    const renameButtons = screen.getAllByLabelText(/Rename/);
    fireEvent.click(renameButtons[0]);
    expect(screen.getByText("Rename asset")).toBeDefined();
  });

  it("shows validation error for empty name", () => {
    render(<AssetManager onClose={() => {}} />);
    const renameButtons = screen.getAllByLabelText(/Rename/);
    fireEvent.click(renameButtons[0]);

    const input = screen.getByLabelText("New asset name");
    fireEvent.change(input, { target: { value: "" } });

    const saveButton = screen.getByLabelText("Save rename");
    fireEvent.click(saveButton);

    expect(screen.getByText("Name cannot be empty.")).toBeDefined();
  });

  it("cancels rename without changes", () => {
    render(<AssetManager onClose={() => {}} />);
    const renameButtons = screen.getAllByLabelText(/Rename/);
    fireEvent.click(renameButtons[0]);
    expect(screen.getByText("Rename asset")).toBeDefined();

    const cancelButton = screen.getByLabelText("Cancel");
    fireEvent.click(cancelButton);
    expect(() => screen.getByText("Rename asset")).toThrow();
  });
});

// ---- Usage ----

describe("AssetManager — usage display", () => {
  beforeEach(() => setupStore());

  it("shows usage count on cards", () => {
    render(<AssetManager onClose={() => {}} />);
    expect(screen.getByText(/Used in 1 place/)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests — AssetCard event handling
// ---------------------------------------------------------------------------

describe("AssetCard — event handling", () => {
  beforeEach(() => setupStore());

  it("action clicks do not trigger card selection through event bubbling", () => {
    const onSelect = vi.fn();

    render(
      <AssetCard
        asset={makeAsset({ id: "a1", name: "test.png" })}
        usageCount={0}
        onSelect={onSelect}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText(/Rename test/));
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(/Delete test/));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("action buttons are focusable via keyboard", () => {
    render(
      <AssetCard
        asset={makeAsset({ id: "a1", name: "test.png" })}
        usageCount={0}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );

    const renameBtn = screen.getByLabelText(/Rename test/);
    expect(renameBtn.tagName).toBe("BUTTON");

    const deleteBtn = screen.getByLabelText(/Delete test/);
    expect(deleteBtn.tagName).toBe("BUTTON");
    expect(deleteBtn.getAttribute("tabindex")).not.toBe("-1");
  });
});

// ---------------------------------------------------------------------------
// Tests — DragDropZone (duplicate drop protection)
// ---------------------------------------------------------------------------

describe("DragDropZone — duplicate event protection", () => {
  it("uses drag counter to prevent premature drag-leave reset", () => {
    const onFilesSelected = vi.fn();

    render(<DragDropZone onFilesSelected={onFilesSelected} />);

    const zone = screen.getByLabelText("Upload image files");

    // Create a minimal DataTransfer-like object for jsdom
    const dataTransfer = { items: [{ kind: "file" }] as unknown as DataTransferItemList };
    const dragEventOpts = { dataTransfer: dataTransfer as unknown as DataTransfer };

    // Fire two dragenter events (simulating browser re-fire)
    fireEvent.dragEnter(zone, dragEventOpts);
    fireEvent.dragEnter(zone, dragEventOpts);

    // Verify dragging state is active after two enters
    expect(screen.getByText("Drop files here")).toBeDefined();

    // Fire one dragleave — counter goes to 1, should still show dragging
    fireEvent.dragLeave(zone);
    expect(screen.getByText("Drop files here")).toBeDefined();

    // Fire second dragleave — counter goes to 0, dragging ends
    fireEvent.dragLeave(zone);

    // After all dragleaves, the zone should return to neutral text
    expect(screen.getByText("Click or drag to upload")).toBeDefined();
  });

  it("fires onFilesSelected only once on drop", () => {
    const onFilesSelected = vi.fn();

    render(<DragDropZone onFilesSelected={onFilesSelected} />);

    const zone = screen.getByLabelText("Upload image files");
    const file = new File(["png"], "test.png", { type: "image/png" });

    // Simulate a drop event
    fireEvent.drop(zone, {
      dataTransfer: { files: [file], items: [{ kind: "file" }] },
    } as unknown as Partial<DragEvent>);

    expect(onFilesSelected).toHaveBeenCalledTimes(1);
    expect(onFilesSelected).toHaveBeenCalledWith([file]);
  });

  it("ignores drop when disabled", () => {
    const onFilesSelected = vi.fn();

    render(<DragDropZone onFilesSelected={onFilesSelected} disabled={true} />);

    const zone = screen.getByLabelText("Upload image files");
    const file = new File(["png"], "test.png", { type: "image/png" });

    fireEvent.drop(zone, {
      dataTransfer: { files: [file], items: [{ kind: "file" }] },
    } as unknown as Partial<DragEvent>);

    expect(onFilesSelected).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — ReplaceAssetInput
// ---------------------------------------------------------------------------

describe("ReplaceAssetInput — replacement behavior", () => {
  it("calls onReplace with the selected file", async () => {
    const onReplace = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    render(
      <ReplaceAssetInput
        assetName="logo.png"
        onReplace={onReplace}
        onCancel={onCancel}
      />,
    );

    // Click the select button to find the hidden file input
    fireEvent.click(screen.getByText("Select replacement file"));
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();

    const file = new File(["png"], "new.png", { type: "image/png" });

    await act(async () => {
      fireEvent.change(fileInput!, { target: { files: [file] } });
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(onReplace).toHaveBeenCalledWith(file);
  });

  it("shows error when onReplace rejects and does not call onCancel", async () => {
    const onReplace = vi.fn().mockRejectedValue(new Error("Replace failed: Invalid format."));
    const onCancel = vi.fn();

    render(
      <ReplaceAssetInput
        assetName="logo.png"
        onReplace={onReplace}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByText("Select replacement file"));
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();

    const file = new File(["svg"], "bad.svg", { type: "image/svg+xml" });

    await act(async () => {
      fireEvent.change(fileInput!, { target: { files: [file] } });
      await new Promise((r) => setTimeout(r, 50));
    });

    // Error message should be visible
    expect(screen.getByText(/Replace failed: Invalid format/)).toBeDefined();
    // onCancel should NOT have been called (error preserves the dialog)
    expect(onCancel).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — AssetPicker
// ---------------------------------------------------------------------------

describe("AssetPicker — selection behavior", () => {
  beforeEach(() => setupStore());

  it("calls onSelect when an asset is clicked", () => {
    const onSelect = vi.fn();
    render(
      <AssetPicker
        onSelect={onSelect}
        onClear={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("logo.png"));
    expect(onSelect).toHaveBeenCalled();
  });

  it("calls onClose when backdrop is clicked", () => {
    const onClose = vi.fn();
    render(
      <AssetPicker
        onSelect={vi.fn()}
        onClear={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows clear selection and upload controls", () => {
    render(
      <AssetPicker
        onSelect={vi.fn()}
        onClear={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Clear selection")).toBeDefined();
    expect(screen.getByText(/Click or drag to upload/i)).toBeDefined();
  });

  it("calls onClear when clear selection is clicked", () => {
    const onClear = vi.fn();
    render(
      <AssetPicker
        onSelect={vi.fn()}
        onClear={onClear}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Clear selection"));
    expect(onClear).toHaveBeenCalled();
  });

  it("accepts custom title", () => {
    render(
      <AssetPicker
        onSelect={vi.fn()}
        onClear={vi.fn()}
        onClose={vi.fn()}
        title="Custom Title"
      />,
    );

    expect(screen.getByText("Custom Title")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests — Event cleanup on unmount
// ---------------------------------------------------------------------------

describe("Event cleanup", () => {
  it("removes keydown event listener when AssetPicker unmounts", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    setupStore();
    const { unmount } = render(
      <AssetPicker
        onSelect={() => {}}
        onClear={() => {}}
        onClose={() => {}}
      />,
    );

    expect(addSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("removes keydown event listener when AssetManager unmounts", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    setupStore();
    const { unmount } = render(<AssetManager onClose={() => {}} />);

    expect(addSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
