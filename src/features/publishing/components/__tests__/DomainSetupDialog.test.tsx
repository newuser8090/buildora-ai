// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// DomainSetupDialog — Phase P8 tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { usePublishingStore } from "../../store/publishing-store";
import { setDeploymentAdapterForTests } from "../../storage/deployment-adapter";
import { setDomainAdapterForTests } from "../../domain/domain-storage";
import { DomainSetupDialog } from "../DomainSetupDialog";
import type { DeploymentRecord } from "../../types";
import type { DeploymentStorageAdapter } from "../../storage/deployment-adapter";
import type { DomainStorageAdapter } from "../../domain/domain-storage";
import type { Project } from "@/types/project";
import type { DeploymentDomainRecord } from "../../domain/types";

// Deterministic domain state — never touches IndexedDB or the provider.
const domainState: {
  domains: DeploymentDomainRecord[];
  supportsDomains: boolean;
  attachResult: { ok: false; error: { code: string; message: string } } | null;
} = {
  domains: [],
  supportsDomains: true,
  attachResult: null,
};

vi.mock("../../hooks/useDomains", () => ({
  useDomains: () => ({
    domains: domainState.domains,
    loading: false,
    supportsDomains: domainState.supportsDomains,
    primaryDomain: null,
    refresh: vi.fn(),
    attach: vi.fn(async () => {
      if (domainState.attachResult) return domainState.attachResult;
      const record = pendingDomainFixture();
      domainState.domains = [...domainState.domains, record];
      return { ok: true as const, value: record };
    }),
    refreshStatus: vi.fn(async (r: DeploymentDomainRecord) => ({ ok: true as const, value: r })),
    remove: vi.fn(async () => ({ ok: true as const, value: undefined })),
  }),
}));

function pendingDomainFixture(): DeploymentDomainRecord {
  return {
    id: "example.com",
    projectId: "proj-1",
    providerId: "vercel",
    domain: "example.com",
    status: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    verification: [
      { type: "CNAME", name: "example.com", value: "cname.vercel-dns.com.", purpose: "Point this name at your site." },
    ],
  };
}

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

class MemoryDomains implements DomainStorageAdapter {
  records = new Map<string, DeploymentDomainRecord>();
  async createDomain(r: DeploymentDomainRecord) { this.records.set(r.id, { ...r }); return r; }
  async updateDomain(id: string, patch: Partial<DeploymentDomainRecord>) {
    const existing = this.records.get(id);
    if (!existing) return null;
    const next = { ...existing, ...patch, id: existing.id };
    this.records.set(id, next);
    return next;
  }
  async getDomain(id: string) { return this.records.get(id) ?? null; }
  async listDomains(projectId: string) {
    return [...this.records.values()].filter((r) => r.projectId === projectId);
  }
  async removeDomain(id: string) { this.records.delete(id); }
  async removeDomainsForProject(projectId: string) {
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

function liveVercelDeployment(): DeploymentRecord {
  return {
    id: "d1",
    projectId: "proj-1",
    providerId: "vercel",
    status: "live",
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:00.000Z",
    activatedAt: "2026-01-01T00:00:00.000Z",
    projectRevision: 1,
    exportHash: "e",
    contentHash: "c",
    url: "https://buildora-proj-1.vercel.app",
    productionUrl: "https://buildora-proj-1.vercel.app",
    deploymentUrl: "https://x.vercel.app",
  };
}

function pendingDomain(): DeploymentDomainRecord {
  return {
    id: "example.com",
    projectId: "proj-1",
    providerId: "vercel",
    domain: "example.com",
    status: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    verification: [
      { type: "CNAME", name: "example.com", value: "cname.vercel-dns.com.", purpose: "Point this name at your site." },
    ],
  };
}

function verifiedDomain(): DeploymentDomainRecord {
  return {
    ...pendingDomain(),
    status: "verified",
    primary: true,
    httpsReady: true,
  };
}

let deploymentAdapter: MemoryAdapter;
let domainAdapter: MemoryDomains;

beforeEach(() => {
  useEditorStore.getState().initProject(makeProject());
  deploymentAdapter = new MemoryAdapter();
  domainAdapter = new MemoryDomains();
  setDeploymentAdapterForTests(deploymentAdapter);
  setDomainAdapterForTests(domainAdapter);
  usePublishingStore.getState().setDeployments([]);
  usePublishingStore.getState().closeDomainDialog();
  domainState.domains = [];
  domainState.supportsDomains = true;
  domainState.attachResult = null;
});

afterEach(() => {
  setDeploymentAdapterForTests(null);
  setDomainAdapterForTests(null);
  vi.restoreAllMocks();
});

async function seedLiveDeployment() {
  usePublishingStore.getState().setDeployments([liveVercelDeployment()]);
  // usePublishing refreshes from the adapter on mount — seed it too so the
  // refresh keeps the live Vercel deployment visible.
  await deploymentAdapter.createDeployment(liveVercelDeployment());
}

function openDialog() {
  usePublishingStore.getState().openDomainDialog();
}

describe("DomainSetupDialog — gating", () => {
  it("shows the publish-first gate when no live Vercel deployment exists", async () => {
    openDialog();
    render(<DomainSetupDialog />);
    expect(screen.getByText(/Publish your site first/)).toBeTruthy();
  });

  it("explains when the provider doesn't support domains here", async () => {
    domainState.supportsDomains = false;
    openDialog();
    await seedLiveDeployment();
    render(<DomainSetupDialog />);
    expect(screen.getByText(/Custom domains aren't available/)).toBeTruthy();
  });
});

describe("DomainSetupDialog — attach flow", () => {
  it("validates input gently and blocks invalid domains", async () => {
    openDialog();
    await seedLiveDeployment();
    render(<DomainSetupDialog />);
    const input = screen.getByTestId("domain-input");
    fireEvent.change(input, { target: { value: "https://example.com/page" } });
    expect(screen.getByText(/no https:\/\/ needed/)).toBeTruthy();
    await waitFor(() => {
      expect((screen.getByTestId("domain-attach") as HTMLButtonElement).disabled).toBe(true);
    });
  });

  it("attaches a valid domain and renders the pending card + instructions", async () => {
    openDialog();
    await seedLiveDeployment();
    render(<DomainSetupDialog />);

    const input = screen.getByTestId("domain-input");
    fireEvent.change(input, { target: { value: "example.com" } });
    fireEvent.click(screen.getByTestId("domain-attach"));

    // The mocked useDomains.attach returns a pending record; the dialog
    // re-renders with it because attach updates the mocked state.
    await waitFor(() => {
      expect(screen.getByTestId("domain-instructions")).toBeTruthy();
    });
    expect(screen.getByText(/Open the place where you bought/)).toBeTruthy();
    expect(screen.getByText(/cname.vercel-dns\.com\./)).toBeTruthy();
    expect(screen.getByText(/Still connecting/)).toBeTruthy();
    expect(screen.getByTestId("domain-check-example.com")).toBeTruthy();
  });

  it("surfaces attach failures in a beginner-safe way", async () => {
    domainState.attachResult = {
      ok: false,
      error: { code: "DOMAIN_ALREADY_IN_USE", message: "That domain is already connected to a project." },
    };
    openDialog();
    await seedLiveDeployment();
    render(<DomainSetupDialog />);
    fireEvent.change(screen.getByTestId("domain-input"), { target: { value: "example.com" } });
    fireEvent.click(screen.getByTestId("domain-attach"));
    await waitFor(() => {
      expect(screen.getByTestId("domain-attach-error")).toBeTruthy();
    });
    expect(screen.getByText(/already connected/)).toBeTruthy();
  });
});

describe("DomainSetupDialog — verification states", () => {
  it("shows the success banner for a verified primary domain", async () => {
    domainState.domains = [verifiedDomain()];
    openDialog();
    await seedLiveDeployment();
    render(<DomainSetupDialog />);
    expect(screen.getByTestId("domain-success")).toBeTruthy();
    expect(screen.getByText("Your domain is connected.")).toBeTruthy();
    expect(screen.getByTestId("domain-success-copy")).toBeTruthy();
    expect(screen.getByTestId("domain-success-done")).toBeTruthy();
    expect(screen.getByText(/Secure connection ready/)).toBeTruthy();
  });

  it("renders a pending domain card with check-again and remove", async () => {
    domainState.domains = [pendingDomain()];
    openDialog();
    await seedLiveDeployment();
    render(<DomainSetupDialog />);
    expect(screen.getByRole("dialog", { name: /connect your own domain/i })).toBeTruthy();
    expect(screen.getByTestId("domain-check-example.com")).toBeTruthy();
    expect(screen.getByTestId("domain-remove-example.com")).toBeTruthy();
    expect(screen.queryByTestId("domain-success")).toBeNull();
  });

  it("closes on Escape", () => {
    openDialog();
    render(<DomainSetupDialog />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(usePublishingStore.getState().domainDialogOpen).toBe(false);
  });
});
