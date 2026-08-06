// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// SaveMyBlockDialog — component tests (Phase P4)
//
//   - suggested name from tree / section sources
//   - validation (empty name)
//   - duplicate-safe naming against the live library
//   - repeated submit blocking
//   - focus trap + Escape behavior
//   - success toast + refresh bump + auto-close
//   - unmount safety
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SaveMyBlockDialog } from "../components/SaveMyBlockDialog";
import { useMyBlocksUiStore } from "../store/my-blocks-ui-store";
import { setMyBlocksAdapterForTests } from "../storage/my-blocks-singleton";
import { InMemoryMyBlocksAdapter, makeSectionRecord, makeTree } from "./helpers";
import type { BaseSection } from "@/types/section";

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

function makeSection(name: string): BaseSection {
  const tree = makeTree();
  return makeSectionRecord(name, tree);
}

beforeEach(() => {
  adapter = new InMemoryMyBlocksAdapter();
  setMyBlocksAdapterForTests(adapter);
  resetUi();
});

describe("SaveMyBlockDialog — suggested names", () => {
  it("pre-fills the name from a tree source's suggestedName", () => {
    act(() => {
      useMyBlocksUiStore.getState().openSaveDialog({
        kind: "tree",
        tree: makeTree(),
        suggestedName: "Pricing hero",
      });
    });
    render(<SaveMyBlockDialog />);
    expect((screen.getByTestId("save-block-name") as HTMLInputElement).value).toBe("Pricing hero");
  });

  it("pre-fills the name from a section source's props", () => {
    act(() => {
      useMyBlocksUiStore.getState().openSaveDialog({
        kind: "section",
        section: makeSection("My imported design"),
      });
    });
    render(<SaveMyBlockDialog />);
    expect((screen.getByTestId("save-block-name") as HTMLInputElement).value).toBe("My imported design");
  });

  it("renders nothing when no source is set", () => {
    const { container } = render(<SaveMyBlockDialog />);
    expect(container.querySelector('[data-testid="save-my-block-dialog"]')).toBeNull();
  });
});

describe("SaveMyBlockDialog — validation", () => {
  it("blocks saving with an empty name (submit stays disabled)", () => {
    act(() => {
      useMyBlocksUiStore.getState().openSaveDialog({
        kind: "tree",
        tree: makeTree(),
        suggestedName: "Hero",
      });
    });
    render(<SaveMyBlockDialog />);
    const submit = screen.getByTestId("save-block-submit") as HTMLButtonElement;
    fireEvent.change(screen.getByTestId("save-block-name"), { target: { value: "   " } });
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    // Nothing was saved with an empty name.
    expect(useMyBlocksUiStore.getState().toast).toBeNull();
  });
});

describe("SaveMyBlockDialog — duplicate-safe naming", () => {
  it("saves with a suffixed name when the base name is already in the library", async () => {
    await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    act(() => {
      useMyBlocksUiStore.getState().openSaveDialog({
        kind: "tree",
        tree: makeTree(),
        suggestedName: "Hero",
      });
    });
    render(<SaveMyBlockDialog />);
    fireEvent.click(screen.getByTestId("save-block-submit"));

    await waitFor(() => {
      expect(useMyBlocksUiStore.getState().toast).toContain('"Hero 2"');
    });
    const list = await adapter.listMyBlocks();
    expect(list.ok && list.value.map((b) => b.name)).toContain("Hero 2");
  });

  it("saves successfully and closes after the success toast", async () => {
    act(() => {
      useMyBlocksUiStore.getState().openSaveDialog({
        kind: "tree",
        tree: makeTree(),
        suggestedName: "Fresh block",
      });
    });
    render(<SaveMyBlockDialog />);
    fireEvent.click(screen.getByTestId("save-block-submit"));

    await waitFor(() => {
      expect(useMyBlocksUiStore.getState().toast).toContain("Fresh block");
    });
    const list = await adapter.listMyBlocks();
    expect(list.ok && list.value).toHaveLength(1);
    // Auto-close after success.
    await waitFor(() => {
      expect(useMyBlocksUiStore.getState().saveSource).toBeNull();
    });
  });

  it("surfaces structured storage errors in the dialog", async () => {
    vi.spyOn(adapter, "createMyBlock").mockResolvedValue({
      ok: false,
      error: {
        code: "QUOTA_EXCEEDED",
        message: "Your saved-block library is full. Delete a saved block or free up space, then try again.",
      },
    });
    act(() => {
      useMyBlocksUiStore.getState().openSaveDialog({
        kind: "tree",
        tree: makeTree(),
        suggestedName: "Hero",
      });
    });
    render(<SaveMyBlockDialog />);
    fireEvent.click(screen.getByTestId("save-block-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("save-block-error").textContent).toContain("library is full");
    });
    // The dialog re-enables the submit so the user can retry.
    expect((screen.getByTestId("save-block-submit") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("SaveMyBlockDialog — repeated submit blocking", () => {
  it("a second submit while saving is a no-op (one record created)", async () => {
    act(() => {
      useMyBlocksUiStore.getState().openSaveDialog({
        kind: "tree",
        tree: makeTree(),
        suggestedName: "Hero",
      });
    });
    render(<SaveMyBlockDialog />);
    fireEvent.click(screen.getByTestId("save-block-submit"));
    fireEvent.click(screen.getByTestId("save-block-submit"));
    await waitFor(() => {
      expect(useMyBlocksUiStore.getState().toast).toBeTruthy();
    });
    const list = await adapter.listMyBlocks();
    expect(list.ok && list.value).toHaveLength(1);
  });
});

describe("SaveMyBlockDialog — keyboard behavior", () => {
  it("Escape closes the dialog when idle", () => {
    act(() => {
      useMyBlocksUiStore.getState().openSaveDialog({
        kind: "tree",
        tree: makeTree(),
        suggestedName: "Hero",
      });
    });
    render(<SaveMyBlockDialog />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useMyBlocksUiStore.getState().saveSource).toBeNull();
  });

  it("traps Tab focus within the dialog", () => {
    act(() => {
      useMyBlocksUiStore.getState().openSaveDialog({
        kind: "tree",
        tree: makeTree(),
        suggestedName: "Hero",
      });
    });
    render(<SaveMyBlockDialog />);
    const panel = screen.getByTestId("save-my-block-panel");
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    expect(focusables.length).toBeGreaterThan(0);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    // Shift+Tab on the first element wraps to the last.
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    // Tab on the last element wraps to the first.
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("restores focus to the previously focused element on close", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Trigger";
    document.body.appendChild(trigger);
    trigger.focus();
    act(() => {
      useMyBlocksUiStore.getState().openSaveDialog({
        kind: "tree",
        tree: makeTree(),
        suggestedName: "Hero",
      });
    });
    const { unmount } = render(<SaveMyBlockDialog />);
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});

describe("SaveMyBlockDialog — unmount safety", () => {
  it("unmounting mid-save never throws or corrupts the store", async () => {
    act(() => {
      useMyBlocksUiStore.getState().openSaveDialog({
        kind: "tree",
        tree: makeTree(),
        suggestedName: "Hero",
      });
    });
    const { unmount } = render(<SaveMyBlockDialog />);
    fireEvent.click(screen.getByTestId("save-block-submit"));
    unmount();
    expect(() => {
      useMyBlocksUiStore.getState().showToast("after unmount");
    }).not.toThrow();
  });
});
