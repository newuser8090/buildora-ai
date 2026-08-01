// ---------------------------------------------------------------------------
// ImportProjectDialog component tests
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportProjectDialog } from "../components/ImportProjectDialog";
import type { ImportProjectPreview, ProjectTransferError } from "../types/project-transfer";

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Mock types
// ---------------------------------------------------------------------------

type OnParseFn = (text: string, filename: string) => Promise<
  { ok: true; preview: ImportProjectPreview } | { ok: false; error: ProjectTransferError }
>;

type OnCommitFn = (preview: ImportProjectPreview, finalName: string) => Promise<
  { ok: true; projectId: string } | { ok: false; error: ProjectTransferError }
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function renderDialog(props: Record<string, unknown> = {}) {
  const mockOnParse: OnParseFn = vi.fn(async () => ({
    ok: true as const,
    preview: makePreview(),
  }));
  const mockOnCommit: OnCommitFn = vi.fn(async () => ({
    ok: true as const,
    projectId: "proj-new",
  }));
  const mockOnClose = vi.fn();

  const utils = render(
    <ImportProjectDialog
      open={true}
      onParse={mockOnParse}
      onCommit={mockOnCommit}
      existingNames={["Existing Project"]}
      onClose={mockOnClose}
      {...props}
    />,
  );

  return { ...utils, mockOnParse, mockOnCommit, mockOnClose };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ImportProjectDialog", () => {
  beforeEach(() => {
    vi.stubGlobal("URL.createObjectURL", vi.fn(() => "blob:mock"));
    vi.stubGlobal("URL.revokeObjectURL", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("accessibility", () => {
    it("has role='dialog'", () => {
      renderDialog();
      expect(screen.getByRole("dialog")).toBeTruthy();
    });

    it("has aria-modal='true'", () => {
      renderDialog();
      const dialog = screen.getByRole("dialog");
      expect(dialog.getAttribute("aria-modal")).toBe("true");
    });

    it("has accessible title", () => {
      renderDialog();
      const dialog = screen.getByRole("dialog");
      const titleId = dialog.getAttribute("aria-labelledby");
      expect(titleId).toBeTruthy();
      const title = document.getElementById(titleId!);
      expect(title?.textContent).toBe("Import Project");
    });

    it("file input has accessible label", () => {
      renderDialog();
      const input = screen.getByTestId("import-file-input");
      expect(input.getAttribute("aria-label")).toBe("Select a project file to import");
    });

    it("Escape closes the dialog", () => {
      const { mockOnClose } = renderDialog();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe("file selection flow", () => {
    it("valid file reaches preview", async () => {
      const { mockOnParse } = renderDialog();

      const file = makeFile("test.buildora.json", '{"format":"buildora-project","formatVersion":1,"project":{}}');
      const input = screen.getByTestId("import-file-input");

      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(mockOnParse).toHaveBeenCalled();
      });
    });

    it("shows preview with project summary", async () => {
      const previewWithData = makePreview({
        project: {
          ...makePreview().project,
          pages: [
            { id: "p1", title: "Home", slug: "/", sections: [{ id: "s1", type: "hero", order: 1, visible: true, props: {}, styles: {} }] },
            { id: "p2", title: "About", slug: "/about", sections: [{ id: "s2", type: "hero", order: 1, visible: true, props: {}, styles: {} }] },
          ],
          assets: [
            { id: "a1", name: "logo.png", type: "image" as const, mimeType: "image/png", extension: ".png", size: 100, source: { type: "data-url" as const, value: "data:image/png;base64," }, createdAt: "2026-01-01T00:00:00.000Z" },
          ],
        },
        warnings: [{ code: "MIGRATION_APPLIED" as const, message: "Project was migrated from v1 to v2." }],
        migrationApplied: true,
      });

      const mockOnParse: OnParseFn = vi.fn(async () => ({
        ok: true as const,
        preview: previewWithData,
      }));

      render(
        <ImportProjectDialog
          open={true}
          onParse={mockOnParse}
          onCommit={vi.fn() as unknown as OnCommitFn}
          existingNames={[]}
          onClose={vi.fn()}
        />,
      );

      const file = makeFile();
      const input = screen.getByTestId("import-file-input");
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByText("Imported Project")).toBeTruthy();
        expect(screen.getByText("2 pages")).toBeTruthy();
        expect(screen.getByText("1 asset")).toBeTruthy();
      });
    });

    it("shows error for malformed JSON parse result", async () => {
      const mockOnParse: OnParseFn = vi.fn(async () => ({
        ok: false as const,
        error: { code: "INVALID_JSON" as const, message: "The file contains invalid JSON." },
      }));

      render(
        <ImportProjectDialog
          open={true}
          onParse={mockOnParse}
          onCommit={vi.fn() as unknown as OnCommitFn}
          existingNames={[]}
          onClose={vi.fn()}
        />,
      );

      const file = makeFile("test.buildora.json", "not json");
      const input = screen.getByTestId("import-file-input");
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByText("Import Failed")).toBeTruthy();
      });
    });

    it("shows name conflict controls when name exists", async () => {
      const mockOnParse: OnParseFn = vi.fn(async () => ({
        ok: true as const,
        preview: makePreview({ originalProjectName: "Existing Project" }),
      }));

      render(
        <ImportProjectDialog
          open={true}
          onParse={mockOnParse}
          onCommit={vi.fn() as unknown as OnCommitFn}
          existingNames={["Existing Project"]}
          onClose={vi.fn()}
        />,
      );

      const file = makeFile();
      const input = screen.getByTestId("import-file-input");
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByText("Name Conflict")).toBeTruthy();
      });
    });

    it("Import button triggers importing state", async () => {
      const deferredCommit = vi.fn(
        () => new Promise<{ ok: true; projectId: string } | { ok: false; error: ProjectTransferError }>((r) => setTimeout(() => r({ ok: true as const, projectId: "proj-new" }), 200)),
      );

      const mockOnParse: OnParseFn = vi.fn(async () => ({
        ok: true as const,
        preview: makePreview(),
      }));

      render(
        <ImportProjectDialog
          open={true}
          onParse={mockOnParse}
          onCommit={deferredCommit as unknown as OnCommitFn}
          existingNames={[]}
          onClose={vi.fn()}
        />,
      );

      const file = makeFile();
      const input = screen.getByTestId("import-file-input");
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByTestId("import-confirm-button")).toBeTruthy();
      });

      fireEvent.click(screen.getByTestId("import-confirm-button"));

      await waitFor(() => {
        expect(screen.getByText("Importing project...")).toBeTruthy();
      });
    });

    it("repeated submit is blocked", async () => {
      const deferredCommit = vi.fn(
        () => new Promise<{ ok: true; projectId: string } | { ok: false; error: ProjectTransferError }>((r) => setTimeout(() => r({ ok: true as const, projectId: "proj-new" }), 200)),
      );

      const mockOnParse: OnParseFn = vi.fn(async () => ({
        ok: true as const,
        preview: makePreview(),
      }));

      render(
        <ImportProjectDialog
          open={true}
          onParse={mockOnParse}
          onCommit={deferredCommit as unknown as OnCommitFn}
          existingNames={[]}
          onClose={vi.fn()}
        />,
      );

      const file = makeFile();
      const input = screen.getByTestId("import-file-input");
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByTestId("import-confirm-button")).toBeTruthy();
      });

      const importBtn = screen.getByTestId("import-confirm-button");
      fireEvent.click(importBtn);
      fireEvent.click(importBtn);

      expect(deferredCommit).toHaveBeenCalledTimes(1);
    });

    it("successful import shows success state", async () => {
      const mockOnParse: OnParseFn = vi.fn(async () => ({
        ok: true as const,
        preview: makePreview(),
      }));

      const mockOnCommit: OnCommitFn = vi.fn(async () => ({
        ok: true as const,
        projectId: "proj-123",
      }));

      render(
        <ImportProjectDialog
          open={true}
          onParse={mockOnParse}
          onCommit={mockOnCommit}
          existingNames={[]}
          onClose={vi.fn()}
        />,
      );

      const file = makeFile();
      const input = screen.getByTestId("import-file-input");
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByTestId("import-confirm-button")).toBeTruthy();
      });

      fireEvent.click(screen.getByTestId("import-confirm-button"));

      await waitFor(() => {
        expect(screen.getByText("Project imported successfully")).toBeTruthy();
      });
    });

    it("failed import remains open with retry option", async () => {
      const mockOnParse: OnParseFn = vi.fn(async () => ({
        ok: true as const,
        preview: makePreview(),
      }));

      const mockOnCommit: OnCommitFn = vi.fn(async () => ({
        ok: false as const,
        error: { code: "IMPORT_SAVE_FAILED" as const, message: "Database error" },
      }));

      render(
        <ImportProjectDialog
          open={true}
          onParse={mockOnParse}
          onCommit={mockOnCommit}
          existingNames={[]}
          onClose={vi.fn()}
        />,
      );

      const file = makeFile();
      const input = screen.getByTestId("import-file-input");
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByTestId("import-confirm-button")).toBeTruthy();
      });

      fireEvent.click(screen.getByTestId("import-confirm-button"));

      await waitFor(() => {
        expect(screen.getByText("Import Failed")).toBeTruthy();
      });
    });

    it("cancel persists nothing", async () => {
      const mockOnCommit: OnCommitFn = vi.fn();
      const mockOnClose = vi.fn();

      render(
        <ImportProjectDialog
          open={true}
          onParse={vi.fn() as unknown as OnParseFn}
          onCommit={mockOnCommit}
          existingNames={[]}
          onClose={mockOnClose}
        />,
      );

      const cancelButtons = screen.getAllByText("Cancel");
      fireEvent.click(cancelButtons[0]);
      expect(mockOnClose).toHaveBeenCalled();
      expect(mockOnCommit).not.toHaveBeenCalled();
    });

    it("error from onParse shows Import Failed state", async () => {
      const mockOnParse: OnParseFn = vi.fn(async () => ({
        ok: false as const,
        error: { code: "INVALID_JSON" as const, message: "Invalid JSON in file." },
      }));

      render(
        <ImportProjectDialog
          open={true}
          onParse={mockOnParse}
          onCommit={vi.fn() as unknown as OnCommitFn}
          existingNames={[]}
          onClose={vi.fn()}
        />,
      );

      const file = makeFile("test.buildora.json", "bad json");
      const input = screen.getByTestId("import-file-input");
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByText("Import Failed")).toBeTruthy();
        expect(screen.getByText("Try Different File")).toBeTruthy();
      });
    });
  });
});
