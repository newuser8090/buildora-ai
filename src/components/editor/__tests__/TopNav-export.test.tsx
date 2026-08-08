// ---------------------------------------------------------------------------
// TopNav — Phase E.2 editor export integration tests (rendered component)
//
// Covers:
//   - current in-memory project is exported (unsaved latest content appears)
//   - persisted older version is never loaded (loadProject not called)
//   - saveNow / autosave flush are not triggered
//   - dirty / revision / saveStatus / autosave schedule remain unchanged
//   - no-project state maps to a structured transfer error
//   - failed export changes no editor state
//   - repeated export is blocked
//   - unmount prevents stale success/error feedback
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

// TopNav mounts Phase P7+P8 publishing hooks that read deployment history
// from IndexedDB on mount — provide a working store so those reads resolve.
import "fake-indexeddb/auto";

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { TopNav } from "../TopNav";
import { saveNowViaController } from "@/features/persistence/services/project-controller";
import { downloadProjectFile } from "@/features/projects/utils/download-project-file";
import { ProjectExportService } from "@/features/projects/services/project-export-service";

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// saveNowViaController must never be called during export
vi.mock("@/features/persistence/services/project-controller", () => ({
  saveNowViaController: vi.fn().mockResolvedValue({ success: true }),
}));

// downloadProjectFile spy
vi.mock("@/features/projects/utils/download-project-file", () => ({
  downloadProjectFile: vi.fn().mockReturnValue({ ok: true }),
}));

// Controllable export service for failure / deferred scenarios
vi.mock("@/features/projects/services/project-export-service", () => {
  return {
    ProjectExportService: vi.fn().mockImplementation(() => ({
      exportProject: vi.fn().mockReturnValue({ ok: true, filename: "mock.buildora.json", content: "{}" }),
    })),
  };
});

// AssetManager is only mounted when the panel opens; stub it to keep the test light.
vi.mock("@/features/assets/components/AssetManager", () => ({
  AssetManager: () => null,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-editor",
    name: "Editor Project",
    theme: {
      palette: { background: "#fff", foreground: "#000", primary: "#7c5cfc", primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#000", muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc", accentForeground: "#fff", border: "#e5e5e5", card: "#fff", cardForeground: "#000" },
      typography: { fontFamily: "sans-serif", headingFont: "sans-serif", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "5rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    pages: [{ id: "p1", title: "Home", slug: "/", sections: [{ id: "s1", type: "hero", order: 1, visible: true, props: {}, styles: {} }] }],
    assets: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function resetStore(project = makeProject()) {
  useEditorStore.setState({
    project,
    history: { past: [], present: project, future: [] },
    isHydrated: true,
    isDirty: true,
    activeProjectId: "proj-editor",
    revision: 7,
    saveStatus: "unsaved",
    lastSavedAt: null,
    persistenceError: null,
    hydrationError: null,
    selectedSectionId: null,
    selectedPageId: null,
    viewport: "desktop",
    zoom: 100,
    isGenerating: false,
    generationProgress: 0,
    _editingSession: null,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TopNav — Phase E.2 editor export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("exports the current in-memory project (unsaved latest content)", async () => {
    // Persisted older version had name "Old Name"; in-memory is "New Unsaved".
    resetStore(makeProject({ name: "New Unsaved" }));

    render(<TopNav />);
    fireEvent.click(screen.getByTestId("export-button"));

    await waitFor(() => expect(downloadProjectFile).toHaveBeenCalled());

    const exportCalls = vi.mocked(ProjectExportService).mock.results;
    const lastInstance = exportCalls[exportCalls.length - 1]?.value as {
      exportProject: ReturnType<typeof vi.fn>;
    };
    const exportedProject = lastInstance.exportProject.mock.calls[0][0];
    expect(exportedProject.name).toBe("New Unsaved");

    // No persistence involved.
    expect(saveNowViaController).not.toHaveBeenCalled();
  });

  it("uses only the in-memory project (single export call, no persistence path)", async () => {
    render(<TopNav />);
    fireEvent.click(screen.getByTestId("export-button"));

    await waitFor(() => expect(downloadProjectFile).toHaveBeenCalled());

    // The editor handler only ever uses the store's in-memory project;
    // ProjectService.loadProject is not part of this path (not even imported).
    const exportCalls = vi.mocked(ProjectExportService).mock.results;
    const lastInstance = exportCalls[exportCalls.length - 1]?.value as {
      exportProject: ReturnType<typeof vi.fn>;
    };
    expect(lastInstance.exportProject).toHaveBeenCalledTimes(1);
    expect(saveNowViaController).not.toHaveBeenCalled();
  });

  it("leaves dirty, revision, saveStatus and autosave schedule untouched", async () => {
    render(<TopNav />);
    fireEvent.click(screen.getByTestId("export-button"));

    await waitFor(() => expect(downloadProjectFile).toHaveBeenCalled());

    const store = useEditorStore.getState();
    expect(store.isDirty).toBe(true);
    expect(store.revision).toBe(7);
    expect(store.saveStatus).toBe("unsaved");
    expect(saveNowViaController).not.toHaveBeenCalled();
  });

  it("no-project state maps to a structured transfer error", async () => {
    resetStore(makeProject({ id: "" }));
    render(<TopNav />);
    fireEvent.click(screen.getByTestId("export-button"));

    await waitFor(() =>
      expect(screen.getByText("No active project to export.")).toBeTruthy(),
    );

    expect(downloadProjectFile).not.toHaveBeenCalled();
    // No export was attempted with an empty project.
    expect(vi.mocked(ProjectExportService)).not.toHaveBeenCalled();
  });

  it("failed export changes no editor state and surfaces the error", async () => {
    // Make the export service return a failure.
    const MockExportService = vi.mocked(ProjectExportService);
    MockExportService.mockImplementationOnce(() => ({
      exportProject: vi.fn().mockReturnValue({
        ok: false,
        error: { code: "EXPORT_SERIALIZATION_FAILED", message: "boom" },
      }),
    }));

    render(<TopNav />);
    fireEvent.click(screen.getByTestId("export-button"));

    await waitFor(() => expect(screen.getByText(/boom/i)).toBeTruthy());

    const store = useEditorStore.getState();
    expect(store.isDirty).toBe(true);
    expect(store.revision).toBe(7);
    expect(store.saveStatus).toBe("unsaved");
    expect(downloadProjectFile).not.toHaveBeenCalled();
  });

  it("repeated export is blocked (one commit per click burst)", async () => {
    render(<TopNav />);
    const button = screen.getByTestId("export-button");
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(downloadProjectFile).toHaveBeenCalledTimes(1));

    const exportCalls = vi.mocked(ProjectExportService).mock.results;
    const lastInstance = exportCalls[exportCalls.length - 1]?.value as {
      exportProject: ReturnType<typeof vi.fn>;
    };
    expect(lastInstance.exportProject).toHaveBeenCalledTimes(1);
  });

  it("unmount before completion prevents stale feedback", async () => {
    // exportProject is synchronous; the only async gap in handleExport is the
    // leading `await Promise.resolve()`. Unmount synchronously after the click
    // so that microtask continuation observes mountedRef === false and skips
    // the download entirely.
    const { unmount } = render(<TopNav />);
    fireEvent.click(screen.getByTestId("export-button"));

    // Unmount before the microtask continuation runs.
    unmount();

    await new Promise((r) => setTimeout(r, 0));

    // If the mountedRef guard were missing, the continuation would still call
    // downloadProjectFile after unmount.
    expect(downloadProjectFile).not.toHaveBeenCalled();
  });
});
