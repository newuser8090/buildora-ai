// ---------------------------------------------------------------------------
// DashboardPage — Phase E.2 export orchestration tests
//
// Renders the real dashboard page with a mocked useProjectsDashboard hook to
// verify the page-level export wiring:
//   - the Export menu action calls exportProjectById with the card's id
//   - the Export menu action never triggers Open
//   - a successful export calls downloadProjectFile with the returned content
//     and filename
//   - loading / serialization / download failures map to a UI error
//   - repeated export is blocked while one is in flight
//   - unmount before resolution prevents stale feedback
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import DashboardPage from "@/app/page";
import { downloadProjectFile } from "@/features/projects/utils/download-project-file";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockExportProjectById = vi.fn();
const mockOpenProject = vi.fn();
const mockCreateProject = vi.fn();
const mockLoadProjects = vi.fn();

vi.mock("@/features/projects/hooks/useProjectsDashboard", () => ({
  useProjectsDashboard: () => ({
    projects: mockProjects(),
    allProjects: mockProjects(),
    isLoading: false,
    isRefreshing: false,
    operation: null,
    searchQuery: "",
    sortMode: "last-edited",
    error: null,
    activeProjectId: "other-proj",
    loadProjects: mockLoadProjects,
    createProject: mockCreateProject,
    createProjectFromTemplate: vi.fn(),
    openProject: mockOpenProject,
    discardAndOpenProject: vi.fn(),
    renameProject: vi.fn(),
    duplicateProject: vi.fn(),
    deleteProject: vi.fn(),
    togglePin: vi.fn(),
    setSearchQuery: vi.fn(),
    setSortMode: vi.fn(),
    clearError: vi.fn(),
    parseImport: vi.fn(),
    commitImport: vi.fn(),
    exportProjectById: mockExportProjectById,
  }),
}));

// The dashboard now initializes the persistence controller on the route; mock it
// so page-render tests do not construct a real IndexedDB adapter.
vi.mock("@/features/persistence/hooks/useProjectController", () => ({
  useProjectController: () => ({ controller: null }),
}));

// The factory references mockProjects; hoisted above via function declaration.
function mockProjects() {
  return [
    {
      id: "proj-card-1",
      name: "Card One",
      revision: 3,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
      savedAt: "2026-06-01T00:00:00.000Z",
      isActive: false,
      isPinned: false,
      pageCount: 1,
      assetCount: 0,
    },
  ];
}

vi.mock("@/features/projects/utils/download-project-file", () => ({
  downloadProjectFile: vi.fn().mockReturnValue({ ok: true }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function openCardMenu() {
  const menuButton = screen.getByRole("button", { name: /menu for card one/i });
  fireEvent.click(menuButton);
}

async function clickExportMenuItem() {
  openCardMenu();
  fireEvent.click(screen.getByText("Export"));
  await waitFor(() => expect(mockExportProjectById).toHaveBeenCalled());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DashboardPage — Phase E.2 export orchestration", () => {
  beforeEach(() => {
    mockExportProjectById.mockReset();
    mockOpenProject.mockClear();
    mockPush.mockClear();
    vi.mocked(downloadProjectFile).mockClear();
    vi.mocked(downloadProjectFile).mockReturnValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
  });

  it("Export menu action loads the full project via exportProjectById and downloads the result", async () => {
    mockExportProjectById.mockResolvedValue({
      ok: true,
      filename: "card-one.buildora.json",
      content: '{"format":"buildora-project"}',
    });

    render(<DashboardPage />);
    await clickExportMenuItem();

    expect(mockExportProjectById).toHaveBeenCalledWith("proj-card-1");
    expect(downloadProjectFile).toHaveBeenCalledWith(
      "card-one.buildora.json",
      '{"format":"buildora-project"}',
    );
  });

  it("Export menu action does not trigger Open", async () => {
    mockExportProjectById.mockResolvedValue({
      ok: true,
      filename: "x.buildora.json",
      content: "{}",
    });

    render(<DashboardPage />);
    await clickExportMenuItem();

    expect(mockExportProjectById).toHaveBeenCalled();
    expect(mockOpenProject).not.toHaveBeenCalled();
  });

  it("loading failure prevents serialization and maps to a UI error", async () => {
    mockExportProjectById.mockResolvedValue({
      ok: false,
      error: { code: "EXPORT_SERIALIZATION_FAILED", message: "Could not load the project." },
    });

    render(<DashboardPage />);
    await clickExportMenuItem();

    await waitFor(() =>
      expect(screen.getByText("Could not load the project.")).toBeTruthy(),
    );
    expect(downloadProjectFile).not.toHaveBeenCalled();
  });

  it("serialization failure prevents download and maps to a UI error", async () => {
    mockExportProjectById.mockResolvedValue({
      ok: false,
      error: { code: "EXPORT_SERIALIZATION_FAILED", message: "Serialization failed." },
    });

    render(<DashboardPage />);
    await clickExportMenuItem();

    await waitFor(() =>
      expect(screen.getByText("Serialization failed.")).toBeTruthy(),
    );
    expect(downloadProjectFile).not.toHaveBeenCalled();
  });

  it("download failure maps to a UI error", async () => {
    mockExportProjectById.mockResolvedValue({
      ok: true,
      filename: "x.buildora.json",
      content: "{}",
    });
    vi.mocked(downloadProjectFile).mockReturnValue({
      ok: false,
      error: { code: "DOWNLOAD_FAILED", message: "Download could not be started." },
    });

    render(<DashboardPage />);
    await clickExportMenuItem();

    await waitFor(() =>
      expect(screen.getByText("Download could not be started.")).toBeTruthy(),
    );
  });

  it("repeated export is blocked while one is in flight", async () => {
    let resolveExport!: (value: unknown) => void;
    const deferred = new Promise((resolve) => { resolveExport = resolve; });
    mockExportProjectById.mockReturnValue(deferred);

    render(<DashboardPage />);

    // First Export click — the export stays in flight.
    openCardMenu();
    fireEvent.click(screen.getByText("Export"));

    // Re-open the menu (the first click closed it) and try again while the
    // first export is still pending. The page's exportingProjectId guard must
    // block this second dispatch.
    openCardMenu();
    fireEvent.click(screen.getByText("Export"));
    openCardMenu();
    fireEvent.click(screen.getByText("Export"));

    // Give the page a tick to settle the in-flight guard.
    await new Promise((r) => setTimeout(r, 10));

    // Only one export was dispatched.
    expect(mockExportProjectById).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveExport({
        ok: true,
        filename: "x.buildora.json",
        content: "{}",
      });
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it("unmount before resolution prevents stale feedback", async () => {
    let resolveExport!: (value: unknown) => void;
    const deferred = new Promise((resolve) => { resolveExport = resolve; });
    mockExportProjectById.mockReturnValue(deferred);

    const { unmount } = render(<DashboardPage />);
    openCardMenu();
    fireEvent.click(screen.getByText("Export"));

    // Unmount before the export resolves.
    unmount();

    await act(async () => {
      resolveExport({
        ok: true,
        filename: "x.buildora.json",
        content: "{}",
      });
      await new Promise((r) => setTimeout(r, 0));
    });

    // No download and no error feedback after unmount.
    expect(downloadProjectFile).not.toHaveBeenCalled();
  });

  it("failed export leaves no lingering download", async () => {
    mockExportProjectById.mockResolvedValue({
      ok: false,
      error: { code: "EXPORT_SERIALIZATION_FAILED", message: "boom" },
    });

    render(<DashboardPage />);
    await clickExportMenuItem();

    await waitFor(() => expect(screen.getByText("boom")).toBeTruthy());
    expect(downloadProjectFile).not.toHaveBeenCalled();
  });
});


