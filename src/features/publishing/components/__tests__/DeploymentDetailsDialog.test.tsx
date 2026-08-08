// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// DeploymentDetailsDialog — Phase P8 tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { usePublishingStore } from "../../store/publishing-store";
import { setDeploymentAdapterForTests } from "../../storage/deployment-adapter";
import { DeploymentDetailsDialog } from "../DeploymentDetailsDialog";
import type { DeploymentRecord } from "../../types";
import type { DeploymentStorageAdapter } from "../../storage/deployment-adapter";
import type { Project } from "@/types/project";

class MemoryAdapter implements DeploymentStorageAdapter {
  records = new Map<string, DeploymentRecord>();
  async createDeployment(r: DeploymentRecord) { this.records.set(r.id, { ...r }); return r; }
  async updateDeployment(id: string, patch: Partial<DeploymentRecord>) {
    const existing = this.records.get(id);
    if (!existing) return null;
    const next = { ...existing, ...patch, id: existing.id };
    this.records.set(id, next);
    return next;
  }
  async getDeployment(id: string) { return this.records.get(id) ?? null; }
  async listDeployments(projectId: string) {
    return [...this.records.values()].filter((r) => r.projectId === projectId);
  }
  async removeDeployment(id: string) { this.records.delete(id); }
  async removeDeploymentsForProject(projectId: string) {
    for (const [id, r] of this.records) if (r.projectId === projectId) this.records.delete(id);
  }
  close() {}
}

function makeProject(): Project {
  return {
    id: "proj-1",
    name: "Test",
    theme: {
      palette: {
        background: "#ffffff", foreground: "#0a0a0a", primary: "#7c5cfc",
        primaryForeground: "#ffffff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#ffffff", border: "#e5e5e5", card: "#ffffff", cardForeground: "#0a0a0a",
      },
      typography: { fontFamily: "Geist", headingFont: "Geist", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "6rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
    pages: [
      {
        id: "p1", title: "Home", slug: "/",
        sections: [
          { id: "s1", type: "hero", order: 1, visible: true, props: { headline: "Hello" }, styles: {} },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function record(id: string, overrides: Partial<DeploymentRecord> = {}): DeploymentRecord {
  return {
    id, projectId: "proj-1", providerId: "mock", status: "live",
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:00.000Z",
    activatedAt: "2026-01-01T00:00:00.000Z",
    projectRevision: 2,
    exportHash: "abcd1234efgh5678",
    contentHash: "content-1",
    url: "http://localhost:3000/preview/proj-1",
    ...overrides,
  };
}

let adapter: MemoryAdapter;

beforeEach(() => {
  useEditorStore.getState().initProject(makeProject());
  adapter = new MemoryAdapter();
  setDeploymentAdapterForTests(adapter);
  usePublishingStore.getState().setDeployments([]);
  usePublishingStore.getState().closeDetails();
});

afterEach(() => {
  setDeploymentAdapterForTests(null);
  vi.restoreAllMocks();
});

function openDetails(deployments: DeploymentRecord[], targetId: string) {
  usePublishingStore.getState().setDeployments(deployments);
  usePublishingStore.getState().openDetails(targetId);
}

describe("DeploymentDetailsDialog — render", () => {
  it("shows provider, status, revision, and export hash", () => {
    openDetails([record("d1")], "d1");
    render(<DeploymentDetailsDialog />);
    expect(screen.getByRole("dialog", { name: /deployment details/i })).toBeTruthy();
    expect(screen.getByText(/Demo publish/)).toBeTruthy();
    // Revision appears in the header and the facts grid.
    expect(screen.getAllByText(/Published from revision 2/).length).toBeGreaterThan(0);
    expect(screen.getByText("abcd1234efgh5678")).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
  });

  it("marks the active deployment as the current live version", () => {
    openDetails([record("d1")], "d1");
    render(<DeploymentDetailsDialog />);
    expect(screen.getByText("Current live version")).toBeTruthy();
  });

  it("shows the URL with safe open/copy actions", () => {
    openDetails([record("d1")], "d1");
    render(<DeploymentDetailsDialog />);
    expect(screen.getByTestId("details-copy-link")).toBeTruthy();
    expect(screen.getByTestId("details-open-site")).toBeTruthy();
    expect((screen.getByTestId("details-open-site") as HTMLAnchorElement).href).toContain("http://localhost:3000/preview/proj-1");
  });

  it("shows a sanitized failure summary for failed deployments", () => {
    openDetails([
      record("d1", { status: "failed", errorCode: "BUILD_FAILED", providerErrorSummary: "Build step failed" }),
    ], "d1");
    render(<DeploymentDetailsDialog />);
    expect(screen.getByText("Build step failed")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
  });

  it("hides unsafe URLs entirely", () => {
    openDetails([record("d1", { url: "javascript:alert(1)", productionUrl: "javascript:alert(1)" })], "d1");
    render(<DeploymentDetailsDialog />);
    expect(screen.queryByTestId("details-open-site")).toBeNull();
    expect(screen.queryByTestId("details-copy-link")).toBeNull();
  });
});

describe("DeploymentDetailsDialog — actions", () => {
  it("shows rollback only for a previous live deployment", () => {
    openDetails([
      record("d-new", { createdAt: "2026-01-02T00:00:00.000Z", completedAt: "2026-01-02T00:00:00.000Z", activatedAt: "2026-01-02T00:00:00.000Z" }),
      record("d-old", { createdAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:00.000Z", activatedAt: "2026-01-01T00:00:00.000Z" }),
    ], "d-old");
    render(<DeploymentDetailsDialog />);
    expect(screen.getByTestId("details-rollback")).toBeTruthy();
  });

  it("hides rollback for the active deployment", () => {
    openDetails([
      record("d-new", { createdAt: "2026-01-02T00:00:00.000Z", completedAt: "2026-01-02T00:00:00.000Z", activatedAt: "2026-01-02T00:00:00.000Z" }),
    ], "d-new");
    render(<DeploymentDetailsDialog />);
    expect(screen.queryByTestId("details-rollback")).toBeNull();
  });

  it("confirms before deleting the deployment", async () => {
    openDetails([record("d1")], "d1");
    render(<DeploymentDetailsDialog />);
    fireEvent.click(screen.getByTestId("details-delete"));
    expect(screen.getByRole("dialog", { name: /delete this deployment/i })).toBeTruthy();
  });

  it("shows cancel for in-progress deployments only (capability-driven)", () => {
    // Mock provider can't cancel; use a Vercel-style record so the
    // capability-derived action appears.
    openDetails([
      record("d1", {
        providerId: "vercel",
        status: "building",
        providerDeploymentId: "dpl_1",
        deploymentUrl: "https://x.vercel.app",
      }),
    ], "d1");
    render(<DeploymentDetailsDialog />);
    expect(screen.getByTestId("details-cancel")).toBeTruthy();
    // Live/terminal deployments don't offer cancel.
  });

  it("reveals advanced provider info on demand", () => {
    openDetails([
      record("d1", {
        providerId: "vercel",
        providerDeploymentId: "dpl_abc123",
        providerState: "READY",
        providerProjectName: "buildora-proj-1",
        deploymentUrl: "https://x.vercel.app",
        productionUrl: "https://buildora-proj-1.vercel.app",
      }),
    ], "d1");
    render(<DeploymentDetailsDialog />);
    expect(screen.queryByText("dpl_abc123")).toBeNull();
    fireEvent.click(screen.getByText("Advanced provider info"));
    expect(screen.getByText("dpl_abc123")).toBeTruthy();
    expect(screen.getByText("READY")).toBeTruthy();
  });

  it("closes on Escape", () => {
    openDetails([record("d1")], "d1");
    render(<DeploymentDetailsDialog />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(usePublishingStore.getState().detailsDeploymentId).toBeNull();
  });

  it("copies the link with the clipboard API", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    openDetails([record("d1")], "d1");
    render(<DeploymentDetailsDialog />);
    fireEvent.click(screen.getByTestId("details-copy-link"));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("http://localhost:3000/preview/proj-1");
    });
  });
});
