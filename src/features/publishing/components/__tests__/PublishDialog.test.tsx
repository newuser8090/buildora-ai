// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// PublishDialog — beginner publish flow (Phase P7)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { usePublishingStore } from "../../store/publishing-store";
import { setDeploymentAdapterForTests } from "../../storage/deployment-adapter";
import { getPublishingProvider } from "../../providers";
import { PublishDialog } from "../PublishDialog";
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
          { id: "s1", type: "hero", order: 1, visible: true, props: { headline: "Hello", primaryCta: { text: "Go", href: "#" } }, styles: {} },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

let adapter: MemoryAdapter;

beforeEach(() => {
  useEditorStore.getState().initProject(makeProject());
  usePublishingStore.getState().closeDialog();
  adapter = new MemoryAdapter();
  setDeploymentAdapterForTests(adapter);
});

afterEach(() => {
  setDeploymentAdapterForTests(null);
  vi.useRealTimers();
});

describe("PublishDialog — provider choice", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<PublishDialog />);
    expect(container.firstChild).toBeNull();
  });

  it("lists the demo publish and local export providers", () => {
    usePublishingStore.getState().openPublishDialog();
    render(<PublishDialog />);
    expect(screen.getByText("Publish your site")).toBeTruthy();
    expect(screen.getByText("Demo publish")).toBeTruthy();
    expect(screen.getByText("Download website files")).toBeTruthy();
    expect(screen.getByTestId("provider-mock")).toBeTruthy();
    expect(screen.getByTestId("provider-local-export")).toBeTruthy();
  });

  it("shows first-publish copy when nothing is live yet", () => {
    usePublishingStore.getState().openPublishDialog();
    render(<PublishDialog />);
    expect(screen.getByText("This is your first publish.")).toBeTruthy();
  });
});

describe("PublishDialog — publish flow", () => {
  it("publishes through the mock provider and shows the demo success screen", async () => {
    vi.useFakeTimers();
    usePublishingStore.getState().openPublishDialog();
    render(<PublishDialog />);

    fireEvent.click(screen.getByTestId("publish-confirm"));
    expect(screen.getByTestId("publish-progress")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.getByTestId("publish-success")).toBeTruthy();
    expect(screen.getByText("Demo site is ready.")).toBeTruthy();
    expect(screen.getByText(/not on the public internet/i)).toBeTruthy();

    // A live deployment was persisted to the deployment storage.
    const live = [...adapter.records.values()].find((d) => d.status === "live");
    expect(live).toBeDefined();
    expect(live!.url).toContain("/preview/proj-1");
  });

  it("does not mutate the project content during publishing", async () => {
    vi.useFakeTimers();
    usePublishingStore.getState().openPublishDialog();
    render(<PublishDialog />);
    const before = JSON.stringify(useEditorStore.getState().project);
    fireEvent.click(screen.getByTestId("publish-confirm"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(JSON.stringify(useEditorStore.getState().project)).toBe(before);
  });

  it("exposes the cached mock provider so tests can pre-seed history", () => {
    const provider = getPublishingProvider("mock");
    expect(provider).toBeDefined();
    expect(provider!.id).toBe("mock");
  });
});
