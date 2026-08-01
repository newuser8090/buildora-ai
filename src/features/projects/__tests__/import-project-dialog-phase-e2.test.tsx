// ---------------------------------------------------------------------------
// ImportProjectDialog — Phase E.2 tests
//
// Covers:
//   - Canonical custom-name validation (validateProjectName) before commit
//   - Explicit conflict resolution for keep / rename-auto / custom policies
//   - Full focus trap (Tab/Shift+Tab wrap, containment, restore on close)
//   - Escape / commit-safety behavior
//   - Import-and-Open lifecycle safety (navigation, close/unmount guards)
//   - Accessibility announcements (live regions, alerts, associations)
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportProjectDialog } from "../components/ImportProjectDialog";
import type { ImportProjectPreview, ProjectTransferError } from "../types/project-transfer";
import { MAX_PROJECT_NAME_LENGTH } from "../utils/validate-project-name";

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Types + helpers
// ---------------------------------------------------------------------------

type OnParseFn = (text: string, filename: string) => Promise<
  { ok: true; preview: ImportProjectPreview } | { ok: false; error: ProjectTransferError }
>;
type OnCommitFn = (preview: ImportProjectPreview, finalName: string) => Promise<
  { ok: true; projectId: string } | { ok: false; error: ProjectTransferError }
>;

function makePreview(overrides?: Partial<ImportProjectPreview>): ImportProjectPreview {
  return {
    sourceFilename: "test.buildora.json",
    project: {
      id: "proj-imported",
      name: "Imported Project",
      theme: {
        palette: {
          background: "#ffffff", foreground: "#0a0a0a", primary: "#7c5cfc",
          primaryForeground: "#ffffff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
          muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
          accentForeground: "#ffffff", border: "#e5e5e5", card: "#ffffff",
          cardForeground: "#000000",
        },
        typography: { fontFamily: "Geist", headingFont: "Geist", baseSize: "16px", scale: 1.25 },
        spacing: { sectionPadding: "6rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
        radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
        shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
      },
      pages: [{ id: "p1", title: "Home", slug: "/", sections: [{ id: "s1", type: "hero", order: 1, visible: true, props: {}, styles: {} }] }],
      assets: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
    originalProjectId: "proj-original",
    originalProjectName: "Imported Project",
    schemaVersion: 2,
    migrationApplied: false,
    warnings: [],
    ...overrides,
  };
}

function makeFile(name = "test.buildora.json", content = "{}"): File {
  return new File([content], name, { type: "application/json" });
}

async function selectFile(input: HTMLElement, name = "test.buildora.json") {
  await userEvent.upload(input, makeFile(name));
}

function renderDialog(
  props: {
    existingNames?: string[];
    onParse?: OnParseFn;
    onCommit?: OnCommitFn;
  } = {},
) {
  const mockOnParse: OnParseFn =
    props.onParse ??
    (vi.fn(async () => ({ ok: true as const, preview: makePreview() })) as OnParseFn);
  const mockOnCommit: OnCommitFn =
    props.onCommit ??
    (vi.fn(async () => ({ ok: true as const, projectId: "proj-new" })) as OnCommitFn);
  const mockOnClose = vi.fn();

  const utils = render(
    <ImportProjectDialog
      open={true}
      onParse={mockOnParse}
      onCommit={mockOnCommit}
      existingNames={props.existingNames ?? []}
      onClose={mockOnClose}
    />,
  );

  return { ...utils, mockOnParse, mockOnCommit, mockOnClose };
}

async function reachPreview(opts: {
  onParse?: OnParseFn;
  onCommit?: OnCommitFn;
  existingNames?: string[];
  name?: string;
}) {
  const mocks = renderDialog(opts);
  await selectFile(screen.getByTestId("import-file-input"), opts.name);
  await waitFor(() => {
    expect(screen.getByTestId("import-confirm-button")).toBeTruthy();
  });
  return mocks;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe("ImportProjectDialog Phase E.2", () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Canonical custom-name validation
  // -------------------------------------------------------------------------

  describe("custom name — canonical validation", () => {
    it("rejects an empty custom name before commit", async () => {
      const { mockOnCommit } = await reachPreview({
        existingNames: ["Imported Project"],
        name: "a.buildora.json",
      });

      // Select Custom Name and leave it empty
      fireEvent.click(screen.getByLabelText("Custom Name"));
      const input = screen.getByTestId("import-custom-name-input");
      await userEvent.clear(input);

      fireEvent.click(screen.getByTestId("import-confirm-button"));

      expect(mockOnCommit).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toBeTruthy();
    });

    it("rejects a whitespace-only custom name before commit", async () => {
      const { mockOnCommit } = await reachPreview({ existingNames: ["Imported Project"] });

      fireEvent.click(screen.getByLabelText("Custom Name"));
      const input = screen.getByTestId("import-custom-name-input");
      await userEvent.type(input, "   ");

      fireEvent.click(screen.getByTestId("import-confirm-button"));

      expect(mockOnCommit).not.toHaveBeenCalled();
    });

    it("rejects more than 80 characters before commit", async () => {
      const { mockOnCommit } = await reachPreview({ existingNames: ["Imported Project"] });

      fireEvent.click(screen.getByLabelText("Custom Name"));
      const input = screen.getByTestId("import-custom-name-input");
      await userEvent.type(input, "a".repeat(MAX_PROJECT_NAME_LENGTH + 1));

      fireEvent.click(screen.getByTestId("import-confirm-button"));

      expect(mockOnCommit).not.toHaveBeenCalled();
    });

    it("accepts exactly 80 characters and commits the trimmed value", async () => {
      const { mockOnCommit } = await reachPreview({ existingNames: ["Imported Project"] });

      fireEvent.click(screen.getByLabelText("Custom Name"));
      const input = screen.getByTestId("import-custom-name-input");
      const exact = "a".repeat(MAX_PROJECT_NAME_LENGTH);
      await userEvent.type(input, exact);

      fireEvent.click(screen.getByTestId("import-confirm-button"));

      await waitFor(() => expect(mockOnCommit).toHaveBeenCalledTimes(1));
      const commitName = (mockOnCommit as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(commitName).toBe(exact);
    });

    it("accepts a padded value and commits the trimmed name", async () => {
      const { mockOnCommit } = await reachPreview({ existingNames: ["Imported Project"] });

      fireEvent.click(screen.getByLabelText("Custom Name"));
      const input = screen.getByTestId("import-custom-name-input");
      await userEvent.type(input, "  My Custom Name  ");

      fireEvent.click(screen.getByTestId("import-confirm-button"));

      await waitFor(() => expect(mockOnCommit).toHaveBeenCalledTimes(1));
      const commitName = (mockOnCommit as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(commitName).toBe("My Custom Name");
    });

    it("invalid value does not commit and preserves the custom name + policy for retry", async () => {
      const { mockOnCommit } = await reachPreview({ existingNames: ["Imported Project"] });

      const customRadio = () => screen.getByRole("radio", { name: /Custom Name/i });
      fireEvent.click(customRadio());
      const input = screen.getByTestId("import-custom-name-input");
      await userEvent.type(input, "   ");

      fireEvent.click(screen.getByTestId("import-confirm-button"));
      expect(mockOnCommit).not.toHaveBeenCalled();

      // Selected policy (custom) remains intact; the typed value is preserved.
      expect((customRadio() as HTMLInputElement).checked).toBe(true);
      expect((input as HTMLInputElement).value).toBe("   ");

      // Fix the name and retry — commit now succeeds with the trimmed value.
      await userEvent.type(input, "Fixed Name");
      fireEvent.click(screen.getByTestId("import-confirm-button"));
      await waitFor(() => expect(mockOnCommit).toHaveBeenCalledTimes(1));
      const commitName = (mockOnCommit as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(commitName).toBe("Fixed Name");
    });
  });

  // -------------------------------------------------------------------------
  // 2. Explicit conflict resolution policies
  // -------------------------------------------------------------------------

  describe("conflict resolution policies", () => {
    it("keep policy commits the original name", async () => {
      const { mockOnCommit } = await reachPreview({
        existingNames: ["Imported Project"],
        name: "a.buildora.json",
      });

      fireEvent.click(screen.getByRole("radio", { name: /Keep Name/i }));
      fireEvent.click(screen.getByTestId("import-confirm-button"));

      await waitFor(() => expect(mockOnCommit).toHaveBeenCalledTimes(1));
      expect((mockOnCommit as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe("Imported Project");
    });

    it("rename-auto (default) commits the generated unique name", async () => {
      const { mockOnCommit } = await reachPreview({
        existingNames: ["Imported Project"],
        name: "a.buildora.json",
      });

      fireEvent.click(screen.getByTestId("import-confirm-button"));

      await waitFor(() => expect(mockOnCommit).toHaveBeenCalledTimes(1));
      expect((mockOnCommit as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe("Imported Project (Imported)");
    });

    it("custom policy commits the typed custom name", async () => {
      const { mockOnCommit } = await reachPreview({
        existingNames: ["Imported Project"],
        name: "a.buildora.json",
      });

      fireEvent.click(screen.getByRole("radio", { name: /Custom Name/i }));
      await userEvent.type(screen.getByTestId("import-custom-name-input"), "My Brand");

      fireEvent.click(screen.getByTestId("import-confirm-button"));

      await waitFor(() => expect(mockOnCommit).toHaveBeenCalledTimes(1));
      expect((mockOnCommit as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe("My Brand");
    });

    it("switching back to rename-auto after typing a custom name commits the suggested name", async () => {
      const { mockOnCommit } = await reachPreview({
        existingNames: ["Imported Project"],
        name: "a.buildora.json",
      });

      fireEvent.click(screen.getByRole("radio", { name: /Custom Name/i }));
      await userEvent.type(screen.getByTestId("import-custom-name-input"), "My Brand");

      fireEvent.click(screen.getByRole("radio", { name: /Rename Automatically/i }));
      fireEvent.click(screen.getByTestId("import-confirm-button"));

      await waitFor(() => expect(mockOnCommit).toHaveBeenCalledTimes(1));
      // The suggested name is used, NOT the previously typed custom name.
      expect((mockOnCommit as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe("Imported Project (Imported)");
    });
  });

  // -------------------------------------------------------------------------
  // 3. Focus trap
  // -------------------------------------------------------------------------

  describe("focus trap", () => {
    it("moves initial focus inside the dialog", async () => {
      renderDialog();
      await waitFor(() => {
        const title = document.getElementById("import-dialog-title");
        expect(document.activeElement).toBe(title);
      });
    });

    it("Tab from the final focusable wraps to the first", async () => {
      await reachPreview({ name: "a.buildora.json" });
      const last = screen.getByTestId("import-and-open-button");
      const first = screen.getByLabelText("Close dialog");
      last.focus();

      fireEvent.keyDown(window, { key: "Tab" });

      expect(document.activeElement).toBe(first);
    });

    it("Shift+Tab from the first focusable wraps to the final", async () => {
      await reachPreview({ name: "a.buildora.json" });
      const first = screen.getByLabelText("Close dialog");
      const last = screen.getByTestId("import-and-open-button");
      first.focus();

      fireEvent.keyDown(window, { key: "Tab", shiftKey: true });

      expect(document.activeElement).toBe(last);
    });

    it("background focus is contained (focusin redirects into the dialog)", async () => {
      render(
        <>
          <button data-testid="outside-button">Outside</button>
          <ImportProjectDialog
            open={true}
            onParse={vi.fn() as unknown as OnParseFn}
            onCommit={vi.fn() as unknown as OnCommitFn}
            existingNames={[]}
            onClose={vi.fn()}
          />
        </>,
      );

      const outside = screen.getByTestId("outside-button");
      outside.focus();

      // Simulate a focus landing outside the dialog panel.
      fireEvent.focusIn(outside);

      await waitFor(() => {
        const first = screen.getByLabelText("Close dialog");
        expect(document.activeElement).toBe(first);
      });
    });

    it("disabled controls are skipped by the tab order", async () => {
      // During a deferred parse the only control is the disabled close button —
      // Tab must not move focus to it and must not throw.
      let resolveParse!: (v: unknown) => void;
      const deferredParse = new Promise((r) => { resolveParse = r; });
      const mockOnParse: OnParseFn = vi.fn(async () => {
        await deferredParse;
        return { ok: true as const, preview: makePreview() };
      }) as OnParseFn;

      renderDialog({ onParse: mockOnParse });
      await selectFile(screen.getByTestId("import-file-input"));

      await waitFor(() => {
        expect(screen.getByText("Validating project...")).toBeTruthy();
      });

      const close = screen.getByLabelText("Close dialog");
      expect((close as HTMLButtonElement).disabled).toBe(true);

      const activeBefore = document.activeElement;
      fireEvent.keyDown(window, { key: "Tab" });
      // Focus must not land on the disabled close button.
      expect(document.activeElement).not.toBe(close);
      expect(document.activeElement).toBe(activeBefore);

      await act(async () => { resolveParse(null); });
    });

    it("returns focus to the original trigger after close", async () => {
      const onParse = vi.fn(async () => ({ ok: true as const, preview: makePreview() })) as OnParseFn;
      const onCommit = vi.fn() as OnCommitFn;
      const mockOnClose = vi.fn();

      const { rerender } = render(
        <>
          <button data-testid="trigger">Import Project</button>
          <ImportProjectDialog open={false} onParse={onParse} onCommit={onCommit} existingNames={[]} onClose={mockOnClose} />
        </>,
      );

      const trigger = screen.getByTestId("trigger");
      trigger.focus();

      // Open the dialog — the trigger is captured as the focus-restore target.
      rerender(
        <>
          <button data-testid="trigger">Import Project</button>
          <ImportProjectDialog open={true} onParse={onParse} onCommit={onCommit} existingNames={[]} onClose={mockOnClose} />
        </>,
      );
      await waitFor(() => {
        expect(document.activeElement).toBe(document.getElementById("import-dialog-title"));
      });

      // Close — focus must return to the original trigger.
      rerender(
        <>
          <button data-testid="trigger">Import Project</button>
          <ImportProjectDialog open={false} onParse={onParse} onCommit={onCommit} existingNames={[]} onClose={mockOnClose} />
        </>,
      );

      await waitFor(() => {
        expect(document.activeElement).toBe(trigger);
      });
    });

    it("removes the listener after close (Escape no longer fires)", async () => {
      const { mockOnClose, mockOnCommit, mockOnParse, rerender } = renderDialog();

      // Close (same instance — re-rendered, not a second mount).
      rerender(
        <ImportProjectDialog
          open={false}
          onParse={mockOnParse}
          onCommit={mockOnCommit}
          existingNames={[]}
          onClose={mockOnClose}
        />,
      );

      fireEvent.keyDown(window, { key: "Escape" });
      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it("reopening installs only one effective Escape listener", async () => {
      const mockOnClose = vi.fn();
      const onParse = vi.fn() as unknown as OnParseFn;
      const onCommit = vi.fn() as unknown as OnCommitFn;

      const { rerender } = render(
        <ImportProjectDialog open={true} onParse={onParse} onCommit={onCommit} existingNames={[]} onClose={mockOnClose} />,
      );
      // Close
      rerender(<ImportProjectDialog open={false} onParse={onParse} onCommit={onCommit} existingNames={[]} onClose={mockOnClose} />);
      // Reopen
      rerender(<ImportProjectDialog open={true} onParse={onParse} onCommit={onCommit} existingNames={[]} onClose={mockOnClose} />);

      fireEvent.keyDown(window, { key: "Escape" });
      // Exactly one close call despite open → close → reopen (only one live listener).
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Escape / commit-safety behavior
  // -------------------------------------------------------------------------

  describe("Escape behavior", () => {
    it("Escape closes in the idle state", async () => {
      const { mockOnClose } = renderDialog();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it("Escape closes in the preview state", async () => {
      const { mockOnClose } = await reachPreview({ name: "a.buildora.json" });
      fireEvent.keyDown(window, { key: "Escape" });
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it("Escape closes in the validation-error state", async () => {
      const { mockOnClose } = await reachPreview({ existingNames: ["Imported Project"] });
      fireEvent.click(screen.getByLabelText("Custom Name"));
      await userEvent.type(screen.getByTestId("import-custom-name-input"), "   ");
      fireEvent.click(screen.getByTestId("import-confirm-button"));

      fireEvent.keyDown(window, { key: "Escape" });
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it("Escape does not close during parsing", async () => {
      let resolveParse!: (v: unknown) => void;
      const deferredParse = new Promise((r) => { resolveParse = r; });
      const mockOnParse: OnParseFn = vi.fn(async () => {
        await deferredParse;
        return { ok: true as const, preview: makePreview() };
      }) as OnParseFn;

      const { mockOnClose } = renderDialog({ onParse: mockOnParse });
      await selectFile(screen.getByTestId("import-file-input"));

      await waitFor(() => expect(screen.getByText("Validating project...")).toBeTruthy());
      fireEvent.keyDown(window, { key: "Escape" });
      expect(mockOnClose).not.toHaveBeenCalled();

      await act(async () => { resolveParse(null); });
    });

    it("Escape does not interrupt an unsafe commit", async () => {
      let resolveCommit!: (v: unknown) => void;
      const deferredCommit: OnCommitFn = vi.fn(async () => {
        await new Promise((r) => { resolveCommit = r; });
        return { ok: true as const, projectId: "proj-123" };
      }) as OnCommitFn;

      const { mockOnClose } = await reachPreview({ onCommit: deferredCommit, name: "a.buildora.json" });

      fireEvent.click(screen.getByTestId("import-confirm-button"));
      await waitFor(() => expect(screen.getByText("Importing project...")).toBeTruthy());

      // Escape during importing must not close the dialog or interrupt the commit.
      fireEvent.keyDown(window, { key: "Escape" });
      expect(mockOnClose).not.toHaveBeenCalled();
      expect(screen.getByText("Importing project...")).toBeTruthy();

      // Commit completes; success is shown; no partial state.
      await act(async () => { resolveCommit(null); });
      await waitFor(() => expect(screen.getByText("Project imported successfully")).toBeTruthy());
    });

    it("after commit failure Escape may close and retry remains available", async () => {
      const { mockOnClose, mockOnCommit } = await reachPreview({
        onCommit: vi.fn(async () => ({ ok: false as const, error: { code: "IMPORT_SAVE_FAILED" as const, message: "DB error" } })),
        name: "a.buildora.json",
      });

      fireEvent.click(screen.getByTestId("import-confirm-button"));
      await waitFor(() => expect(screen.getByText("Import Failed")).toBeTruthy());

      // Retry is available and keyboard-accessible.
      const retry = screen.getByText("Retry");
      expect(retry).toBeTruthy();

      // Escape may close now.
      fireEvent.keyDown(window, { key: "Escape" });
      expect(mockOnClose).toHaveBeenCalledTimes(1);

      expect(mockOnCommit).toHaveBeenCalledTimes(1);
    });

    it("retry after commit failure re-attempts the same commit", async () => {
      let attempt = 0;
      const mockOnCommit: OnCommitFn = vi.fn(async () => {
        attempt++;
        if (attempt === 1) {
          return { ok: false as const, error: { code: "IMPORT_SAVE_FAILED" as const, message: "DB error" } };
        }
        return { ok: true as const, projectId: "proj-final" };
      }) as OnCommitFn;

      await reachPreview({ onCommit: mockOnCommit, name: "a.buildora.json" });
      fireEvent.click(screen.getByTestId("import-confirm-button"));
      await waitFor(() => expect(screen.getByText("Import Failed")).toBeTruthy());

      fireEvent.click(screen.getByText("Retry"));
      await waitFor(() => expect(screen.getByText("Project imported successfully")).toBeTruthy());
      expect(mockOnCommit).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Import and Open lifecycle
  // -------------------------------------------------------------------------

  describe("Import and Open", () => {
    it("successful commit navigates once to /editor/<new-id>", async () => {
      const { mockOnCommit } = await reachPreview({ name: "a.buildora.json" });
      fireEvent.click(screen.getByTestId("import-and-open-button"));

      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
      expect(mockPush).toHaveBeenCalledWith("/editor/proj-new");
      expect(mockOnCommit).toHaveBeenCalledTimes(1);
    });

    it("persistence finishes before navigation", async () => {
      let resolveCommit!: (v: unknown) => void;
      const deferredCommit: OnCommitFn = vi.fn(async () => {
        await new Promise((r) => { resolveCommit = r; });
        return { ok: true as const, projectId: "proj-late" };
      }) as OnCommitFn;

      await reachPreview({ onCommit: deferredCommit, name: "a.buildora.json" });
      fireEvent.click(screen.getByTestId("import-and-open-button"));

      expect(mockPush).not.toHaveBeenCalled();
      await act(async () => { resolveCommit(null); });
      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
      expect(mockPush).toHaveBeenCalledWith("/editor/proj-late");
    });

    it("failed save does not navigate", async () => {
      await reachPreview({
        onCommit: vi.fn(async () => ({ ok: false as const, error: { code: "IMPORT_SAVE_FAILED" as const, message: "nope" } })),
        name: "a.buildora.json",
      });
      fireEvent.click(screen.getByTestId("import-and-open-button"));

      await waitFor(() => expect(screen.getByText("Import Failed")).toBeTruthy());
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("dialog close before resolution prevents navigation", async () => {
      let resolveCommit!: (v: unknown) => void;
      const deferredCommit: OnCommitFn = vi.fn(async () => {
        await new Promise((r) => { resolveCommit = r; });
        return { ok: true as const, projectId: "proj-x" };
      }) as OnCommitFn;

      const onParse = vi.fn(async () => ({ ok: true as const, preview: makePreview() })) as OnParseFn;
      const mockOnClose = vi.fn();

      const { rerender } = render(
        <ImportProjectDialog open={true} onParse={onParse} onCommit={deferredCommit} existingNames={[]} onClose={mockOnClose} />,
      );
      await selectFile(screen.getByTestId("import-file-input"));
      await waitFor(() => expect(screen.getByTestId("import-and-open-button")).toBeTruthy());
      fireEvent.click(screen.getByTestId("import-and-open-button"));

      // Close the dialog while the commit is still pending.
      rerender(
        <ImportProjectDialog open={false} onParse={onParse} onCommit={deferredCommit} existingNames={[]} onClose={mockOnClose} />,
      );

      await act(async () => { resolveCommit(null); });
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("unmount before resolution prevents navigation", async () => {
      let resolveCommit!: (v: unknown) => void;
      const deferredCommit: OnCommitFn = vi.fn(async () => {
        await new Promise((r) => { resolveCommit = r; });
        return { ok: true as const, projectId: "proj-u" };
      }) as OnCommitFn;

      const onParse = vi.fn(async () => ({ ok: true as const, preview: makePreview() })) as OnParseFn;
      const { unmount } = render(
        <ImportProjectDialog open={true} onParse={onParse} onCommit={deferredCommit} existingNames={[]} onClose={vi.fn()} />,
      );
      await selectFile(screen.getByTestId("import-file-input"));
      await waitFor(() => expect(screen.getByTestId("import-and-open-button")).toBeTruthy());
      fireEvent.click(screen.getByTestId("import-and-open-button"));

      unmount();
      await act(async () => { resolveCommit(null); });
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("repeated click starts exactly one commit", async () => {
      const { mockOnCommit } = await reachPreview({ name: "a.buildora.json" });
      const btn = screen.getByTestId("import-and-open-button");
      fireEvent.click(btn);
      fireEvent.click(btn);
      fireEvent.click(btn);

      await waitFor(() => expect(mockOnCommit).toHaveBeenCalledTimes(1));
    });

    it("a stale first import cannot navigate after a newer import succeeds", async () => {
      let resolveFirst!: (v: unknown) => void;
      const deferredCommit: OnCommitFn = vi.fn(async () => {
        await new Promise((r) => { resolveFirst = r; });
        return { ok: true as const, projectId: "proj-stale" };
      }) as OnCommitFn;

      const onParse = vi.fn(async () => ({ ok: true as const, preview: makePreview() })) as OnParseFn;
      const mockOnClose = vi.fn();

      const { rerender } = render(
        <ImportProjectDialog open={true} onParse={onParse} onCommit={deferredCommit} existingNames={[]} onClose={mockOnClose} />,
      );
      await selectFile(screen.getByTestId("import-file-input"));
      await waitFor(() => expect(screen.getByTestId("import-and-open-button")).toBeTruthy());
      fireEvent.click(screen.getByTestId("import-and-open-button"));

      // The first commit is superseded: close (invalidates) and import a new file.
      rerender(<ImportProjectDialog open={false} onParse={onParse} onCommit={deferredCommit} existingNames={[]} onClose={mockOnClose} />);

      // Second import completes successfully → navigates once.
      const okCommit = vi.fn(async () => ({ ok: true as const, projectId: "proj-second" })) as OnCommitFn;
      rerender(<ImportProjectDialog open={true} onParse={onParse} onCommit={okCommit} existingNames={[]} onClose={mockOnClose} />);
      await selectFile(screen.getByTestId("import-file-input"));
      await waitFor(() => expect(screen.getByTestId("import-and-open-button")).toBeTruthy());
      fireEvent.click(screen.getByTestId("import-and-open-button"));
      await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/editor/proj-second"));

      // Now the stale first commit resolves — it must not navigate again.
      await act(async () => { resolveFirst(null); });
      expect(mockPush).toHaveBeenCalledTimes(1);
    });

    it("navigation failure is mapped without duplicating the project", async () => {
      mockPush.mockImplementationOnce(() => { throw new Error("navigation failed"); });
      const { mockOnCommit } = await reachPreview({ name: "a.buildora.json" });

      fireEvent.click(screen.getByTestId("import-and-open-button"));

      await waitFor(() => expect(screen.getByText("Project imported successfully")).toBeTruthy());
      // Commit happened exactly once — no duplicate import on navigation failure.
      expect(mockOnCommit).toHaveBeenCalledTimes(1);
    });

    it("successful import without Open does not navigate", async () => {
      await reachPreview({ name: "a.buildora.json" });
      fireEvent.click(screen.getByTestId("import-confirm-button"));

      await waitFor(() => expect(screen.getByText("Project imported successfully")).toBeTruthy());
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 6. Accessibility announcements
  // -------------------------------------------------------------------------

  describe("accessibility announcements", () => {
    it("announces parsing through a live region", async () => {
      let resolveParse!: (v: unknown) => void;
      const deferredParse = new Promise((r) => { resolveParse = r; });
      const mockOnParse: OnParseFn = vi.fn(async () => {
        await deferredParse;
        return { ok: true as const, preview: makePreview() };
      }) as OnParseFn;

      renderDialog({ onParse: mockOnParse });
      await selectFile(screen.getByTestId("import-file-input"));

      await waitFor(() => {
        const status = screen.getByTestId("import-status");
        expect(status.getAttribute("role")).toBe("status");
        expect(status.textContent).toContain("Validating project...");
      });

      await act(async () => { resolveParse(null); });
    });

    it("announces importing through a live region", async () => {
      const deferredCommit: OnCommitFn = vi.fn(() => new Promise(() => {})) as OnCommitFn;
      await reachPreview({ onCommit: deferredCommit, name: "a.buildora.json" });
      fireEvent.click(screen.getByTestId("import-confirm-button"));

      await waitFor(() => {
        const status = screen.getByTestId("import-status");
        expect(status.textContent).toContain("Importing project...");
      });
    });

    it("announces success through a live region", async () => {
      await reachPreview({ name: "a.buildora.json" });
      fireEvent.click(screen.getByTestId("import-confirm-button"));

      await waitFor(() => {
        const status = screen.getByTestId("import-status");
        expect(status.textContent).toContain("Project imported successfully");
      });
    });

    it("warnings use a polite live region", async () => {
      const previewWithWarnings = makePreview({
        warnings: [{ code: "FILE_EXTENSION_NOT_BUILDORA", message: "File extension is not .buildora.json." }],
      });
      const mockOnParse: OnParseFn = vi.fn(async () => ({ ok: true as const, preview: previewWithWarnings })) as OnParseFn;

      renderDialog({ onParse: mockOnParse });
      await selectFile(screen.getByTestId("import-file-input"), "project.json");

      await waitFor(() => {
        const warningsRegion = screen.getByTestId("import-warnings");
        expect(warningsRegion.textContent).toContain("Import Warnings");
        expect(warningsRegion.getAttribute("role")).toBe("status");
      });
    });

    it("validation errors use role=alert", async () => {
      await reachPreview({ existingNames: ["Imported Project"] });
      fireEvent.click(screen.getByRole("radio", { name: /Custom Name/i }));
      await userEvent.type(screen.getByTestId("import-custom-name-input"), "   ");

      expect(screen.getByRole("alert")).toBeTruthy();
    });

    it("file errors are associated with the file input", async () => {
      const mockOnParse: OnParseFn = vi.fn() as OnParseFn;
      const mockOnCommit: OnCommitFn = vi.fn() as OnCommitFn;
      renderDialog({ onParse: mockOnParse, onCommit: mockOnCommit });

      // A .txt file fails in readProjectFile (extension error).
      await selectFile(screen.getByTestId("import-file-input"), "bad.txt");

      await waitFor(() => expect(screen.getByText("Import Failed")).toBeTruthy());

      const input = screen.getByTestId("import-file-input");
      const describedBy = input.getAttribute("aria-describedby");
      expect(describedBy).toBe("import-file-error");
      const errorEl = document.getElementById("import-file-error");
      expect(errorEl).toBeTruthy();
      expect(errorEl?.getAttribute("role")).toBe("alert");
    });

    it("custom-name errors are associated with the custom-name input", async () => {
      await reachPreview({ existingNames: ["Imported Project"] });
      fireEvent.click(screen.getByRole("radio", { name: /Custom Name/i }));
      const input = screen.getByTestId("import-custom-name-input");
      await userEvent.type(input, "   ");

      expect(input.getAttribute("aria-invalid")).toBe("true");
      const describedBy = input.getAttribute("aria-describedby");
      expect(describedBy).toBe("import-custom-name-error");
      expect(document.getElementById("import-custom-name-error")).toBeTruthy();
    });

    it("conflict radio group has an accessible group label", async () => {
      await reachPreview({ existingNames: ["Imported Project"] });
      const group = screen.getByRole("group", { name: "Name conflict resolution" });
      expect(group).toBeTruthy();
    });

    it("Import and Import-and-Open buttons have distinct accessible names", async () => {
      await reachPreview({ name: "a.buildora.json" });
      expect(screen.getByRole("button", { name: "Import Project" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Import and Open" })).toBeTruthy();
    });

    it("conveys the busy state with aria-busy", async () => {
      const deferredCommit: OnCommitFn = vi.fn(() => new Promise(() => {})) as OnCommitFn;
      await reachPreview({ onCommit: deferredCommit, name: "a.buildora.json" });
      fireEvent.click(screen.getByTestId("import-confirm-button"));

      await waitFor(() => {
        const dialog = screen.getByRole("dialog");
        expect(dialog.getAttribute("aria-busy")).toBe("true");
      });
    });
  });
});
