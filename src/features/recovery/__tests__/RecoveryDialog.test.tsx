// ---------------------------------------------------------------------------
// Draft Recovery (Phase P9) — RecoveryDialog tests
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { RecoveryDialog } from "../components/RecoveryDialog";
import { setRecoveryServiceForTests } from "../services/recovery-service";
import { setProjectController } from "@/features/persistence/services/project-controller";
import type { RecoverySnapshot } from "../types";
import type { Project } from "@/types/project";

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "proj-x",
    name: "My Website",
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
    assets: [],
    pages: [
      {
        id: "p1",
        title: "Home",
        slug: "/",
        sections: [
          {
            id: "s1",
            type: "hero",
            order: 1,
            visible: true,
            props: { headline: "Hi", primaryCta: { text: "Go", href: "#" } },
            styles: {},
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSnapshot(overrides?: Partial<RecoverySnapshot>): RecoverySnapshot {
  return {
    id: "snap-1",
    projectId: "proj-x",
    revision: 3,
    createdAt: "2026-01-02T10:00:00.000Z",
    reason: "autosave",
    project: makeProject({ name: "Backup version" }),
    ...overrides,
  };
}

describe("RecoveryDialog", () => {
  const saveProject = vi.fn();

  function mockController() {
    setProjectController({ adapter: { saveProject } } as never);
  }

  function mockService(snapshots: RecoverySnapshot[]) {
    setRecoveryServiceForTests({
      listSnapshots: vi.fn().mockResolvedValue({ ok: true, snapshots }),
      prepareRestore: vi.fn().mockImplementation(async (id: string) => {
        const snap = snapshots.find((s) => s.id === id);
        return snap
          ? { ok: true, project: snap.project, revision: snap.revision }
          : { ok: false, error: { code: "RECOVERY_NOT_FOUND", message: "Not found" } };
      }),
    } as never);
  }

  beforeEach(() => {
    cleanup();
    saveProject.mockReset();
    setRecoveryServiceForTests(null);
    mockController();
  });

  it("lists snapshots with reason labels and content summary", async () => {
    mockService([
      makeSnapshot({ id: "s-old", createdAt: "2026-01-01T08:00:00.000Z", reason: "manual" }),
      makeSnapshot({ id: "s-new", createdAt: "2026-01-02T10:00:00.000Z", reason: "autosave" }),
    ]);
    render(
      <RecoveryDialog open projectId="proj-x" onClose={() => {}} onRestored={() => {}} />,
    );

    await waitFor(() => expect(screen.getAllByTestId("recovery-snapshot")).toHaveLength(2));
    expect(screen.getByText("Auto-saved")).toBeTruthy();
    expect(screen.getByText("Saved backup")).toBeTruthy();
    expect(screen.getAllByText(/1 page · 1 section/).length).toBe(2);
  });

  it("shows the empty state when no snapshots exist", async () => {
    mockService([]);
    render(
      <RecoveryDialog open projectId="proj-x" onClose={() => {}} onRestored={() => {}} />,
    );

    await waitFor(() => expect(screen.getByText("No backups found")).toBeTruthy());
  });

  it("surfaces a load error", async () => {
    setRecoveryServiceForTests({
      listSnapshots: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: "RECOVERY_STORE_UNAVAILABLE", message: "Backups could not be loaded." },
      }),
    } as never);
    render(
      <RecoveryDialog open projectId="proj-x" onClose={() => {}} onRestored={() => {}} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("recovery-error").textContent).toContain(
        "Backups could not be loaded.",
      ),
    );
  });

  it("previews a backup without restoring it", async () => {
    mockService([makeSnapshot({ project: makeProject({ name: "Preview me" }) })]);
    render(
      <RecoveryDialog open projectId="proj-x" onClose={() => {}} onRestored={() => {}} />,
    );

    await waitFor(() => expect(screen.getAllByTestId("recovery-snapshot")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /Preview backup/i }));
    expect(screen.getByTestId("recovery-preview").textContent).toContain("Preview me");
    expect(saveProject).not.toHaveBeenCalled();
  });

  it("restores through the persistence save path after confirmation", async () => {
    const snap = makeSnapshot({ project: makeProject({ name: "Restored version" }) });
    mockService([snap]);
    saveProject.mockResolvedValue({ success: true });
    const onRestored = vi.fn();

    render(
      <RecoveryDialog open projectId="proj-x" onClose={() => {}} onRestored={onRestored} />,
    );

    await waitFor(() => expect(screen.getAllByTestId("recovery-snapshot")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /^Restore$/ }));
    fireEvent.click(screen.getByTestId("recovery-confirm-restore"));
    await waitFor(() => expect(onRestored).toHaveBeenCalled());

    expect(saveProject).toHaveBeenCalledWith(
      expect.objectContaining({
        project: expect.objectContaining({ name: "Restored version" }),
      }),
    );
  });

  it("keeps current version without writing when closed", () => {
    mockService([makeSnapshot()]);
    const onClose = vi.fn();
    render(
      <RecoveryDialog open projectId="proj-x" onClose={onClose} onRestored={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Keep current version/i }));
    expect(onClose).toHaveBeenCalled();
    expect(saveProject).not.toHaveBeenCalled();
  });

  it("renders nothing when closed", () => {
    render(
      <RecoveryDialog open={false} projectId={null} onClose={() => {}} onRestored={() => {}} />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
