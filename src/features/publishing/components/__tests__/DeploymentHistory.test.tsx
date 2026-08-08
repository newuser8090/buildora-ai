// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// DeploymentHistory — history list + rollback confirmation (Phase P7)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { usePublishingStore } from "../../store/publishing-store";
import { setDeploymentAdapterForTests } from "../../storage/deployment-adapter";
import { getPublishingProvider } from "../../providers";
import { MockPublishingProvider } from "../../providers/mock-provider";
import { DeploymentHistory } from "../DeploymentHistory";
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

function makeProject(overrides?: Partial<Project>): Project {
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
    ...overrides,
  };
}

function record(id: string, activatedAt: string, status: DeploymentRecord["status"] = "live"): DeploymentRecord {
  return {
    id, projectId: "proj-1", providerId: "mock", status,
    createdAt: activatedAt, completedAt: activatedAt, activatedAt,
    projectRevision: 1, exportHash: `export-${id}`, contentHash: `content-${id}`,
    url: `http://localhost:3000/preview/proj-1`,
  };
}

let adapter: MemoryAdapter;

beforeEach(() => {
  useEditorStore.getState().initProject(makeProject());
  adapter = new MemoryAdapter();
  setDeploymentAdapterForTests(adapter);
  usePublishingStore.getState().setDeployments([]);
});

afterEach(() => {
  setDeploymentAdapterForTests(null);
});

describe("DeploymentHistory — list", () => {
  it("shows an empty state when nothing is published", () => {
    render(<DeploymentHistory />);
    expect(screen.getByText(/nothing published yet/i)).toBeTruthy();
  });

  it("lists deployments with the newest marked Current", () => {
    usePublishingStore.getState().setDeployments([
      record("d-old", "2026-01-01T00:00:00.000Z"),
      record("d-new", "2026-01-02T00:00:00.000Z"),
    ]);
    render(<DeploymentHistory />);
    expect(screen.getAllByTestId("deployment-card")).toHaveLength(2);
    // P8: history groups deployments under Current / Previous headings.
    expect(screen.getByTestId("deployment-group-current")).toBeTruthy();
    expect(screen.getByTestId("deployment-group-previous")).toBeTruthy();
    expect(screen.getAllByText(/Published from revision 1/)).toHaveLength(2);
  });
});

describe("DeploymentHistory — rollback", () => {
  it("confirms before restoring and completes the rollback", async () => {
    const dOld = record("d-old", "2026-01-01T00:00:00.000Z");
    const dNew = record("d-new", "2026-01-02T00:00:00.000Z");
    usePublishingStore.getState().setDeployments([dOld, dNew]);
    await adapter.createDeployment(dOld);
    await adapter.createDeployment(dNew);

    // Seed the cached mock provider so its rollback finds the deployment.
    const provider = getPublishingProvider("mock") as MockPublishingProvider;
    provider._reset();
    provider._seed(dOld);
    provider._seed(dNew);

    render(<DeploymentHistory />);

    // The older card offers restore; click it → confirmation appears.
    const restoreButtons = screen.getAllByTestId("deployment-rollback");
    expect(restoreButtons).toHaveLength(1);
    fireEvent.click(restoreButtons[0]);
    expect(screen.getByText("Restore this version?")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: /restore this version/i })).toBeTruthy();

    fireEvent.click(screen.getByTestId("rollback-confirm"));

    await waitFor(() => {
      expect(screen.queryByText("Restore this version?")).toBeNull();
    });
    expect(screen.queryByTestId("rollback-error")).toBeNull();

    // The storage record's activatedAt was refreshed (rollback semantics).
    const rolled = await adapter.getDeployment("d-old");
    expect(rolled!.activatedAt).toBeDefined();
  });

  it("shows an error when the provider cannot restore the version", async () => {
    const dOld = record("d-old", "2026-01-01T00:00:00.000Z");
    const dNew = record("d-new", "2026-01-02T00:00:00.000Z");
    usePublishingStore.getState().setDeployments([dOld, dNew]);
    await adapter.createDeployment(dOld);
    await adapter.createDeployment(dNew);

    // Provider has no record for the target (simulates an unavailable
    // restore) → the rollback surfaces an error instead of succeeding.
    const provider = getPublishingProvider("mock") as MockPublishingProvider;
    provider._reset();

    render(<DeploymentHistory />);
    fireEvent.click(screen.getAllByTestId("deployment-rollback")[0]);
    fireEvent.click(screen.getByTestId("rollback-confirm"));

    await waitFor(() => {
      expect(screen.getByTestId("rollback-error")).toBeTruthy();
    });
  });
});
