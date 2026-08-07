// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// LaunchCenter — the finishing hub (Phase P7)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useLaunchCenterStore } from "../../store/launch-center-store";
import { useSiteSettingsUiStore } from "@/features/site-settings/store/site-settings-ui-store";
import { usePreviewStore } from "@/features/preview/store/preview-store";
import { usePublishingStore } from "@/features/publishing/store/publishing-store";
import { setDeploymentAdapterForTests } from "@/features/publishing/storage/deployment-adapter";
import { LaunchCenter, runFixAction } from "../LaunchCenter";
import type { LaunchCheck } from "../../types";
import type { DeploymentRecord } from "@/features/publishing/types";
import type { DeploymentStorageAdapter } from "@/features/publishing/storage/deployment-adapter";
import type { Project } from "@/types/project";

// In-memory adapter so usePublishing (mounted by LaunchCenter) can list deployments.
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

beforeEach(() => {
  useEditorStore.getState().initProject(makeProject());
  useLaunchCenterStore.getState().closeLaunchCenter();
  useSiteSettingsUiStore.getState().closeDialog();
  usePreviewStore.getState().closePreview();
  usePublishingStore.getState().closeDialog();
  setDeploymentAdapterForTests(new MemoryAdapter());
});

describe("LaunchCenter — rendering", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<LaunchCenter />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the readiness score, findings, and ready sections", () => {
    useLaunchCenterStore.getState().openLaunchCenter();
    render(<LaunchCenter />);
    expect(screen.getByTestId("launch-score")).toBeTruthy();
    expect(screen.getByText("Things worth fixing")).toBeTruthy();
    expect(screen.getByText("What's ready")).toBeTruthy();
    expect(screen.getByText("Good to know")).toBeTruthy();
  });

  it("shows a blocked callout when export problems exist", () => {
    useEditorStore.getState().initProject(
      makeProject({
        assets: [],
        pages: [{
          id: "p1", title: "Home", slug: "/",
          sections: [
            { id: "s1", type: "header", order: 1, visible: true, props: { logoText: "X", logoImage: { assetId: "missing-logo" }, navLinks: [] }, styles: {} },
            { id: "s2", type: "hero", order: 2, visible: true, props: { headline: "Hello", primaryCta: { text: "Go", href: "#" } }, styles: {} },
          ],
        }],
      }),
    );
    useLaunchCenterStore.getState().openLaunchCenter();
    render(<LaunchCenter />);
    expect(screen.getByText("A few things must be fixed before publishing")).toBeTruthy();
  });

  it("shows 'ready to launch' for a near-perfect project", async () => {
    useEditorStore.getState().initProject(
      makeProject({
        siteSettings: {
          siteName: "Test",
          siteDescription: "desc",
          language: "en",
          seo: { title: "Test | Home", description: "desc", robotsIndex: true },
        },
        pages: [{
          id: "p1", title: "Home", slug: "/",
          meta: { title: "Home SEO" },
          sections: [
            { id: "s1", type: "header", order: 1, visible: true, props: { logoText: "Test", navLinks: [], ctaHref: "#", ctaText: "Go" }, styles: {} },
            { id: "s2", type: "hero", order: 2, visible: true, props: { headline: "Hello", primaryCta: { text: "Go", href: "#" } }, styles: {} },
            { id: "s3", type: "footer", order: 3, visible: true, props: { text: "© 2026", links: [] }, styles: {} },
          ],
        }],
      }),
    );
    useLaunchCenterStore.getState().openLaunchCenter();
    render(<LaunchCenter />);
    await waitFor(() => {
      expect(screen.getByText("Your site is ready to launch")).toBeTruthy();
    });
  });
});

describe("LaunchCenter — actions", () => {
  it("opens the publish dialog from the publish button", () => {
    useLaunchCenterStore.getState().openLaunchCenter();
    render(<LaunchCenter />);
    fireEvent.click(screen.getByTestId("launch-publish"));
    expect(usePublishingStore.getState().dialogOpen).toBe(true);
    expect(usePublishingStore.getState().view).toBe("publish");
    expect(useLaunchCenterStore.getState().open).toBe(false);
  });

  it("opens the visitor preview from the preview button", () => {
    useLaunchCenterStore.getState().openLaunchCenter();
    render(<LaunchCenter />);
    fireEvent.click(screen.getByTestId("launch-preview"));
    expect(usePreviewStore.getState().open).toBe(true);
    expect(usePreviewStore.getState().route).toBe("/");
  });

  it("opens search & sharing settings from the settings button", () => {
    useLaunchCenterStore.getState().openLaunchCenter();
    render(<LaunchCenter />);
    fireEvent.click(screen.getByText("Search & sharing settings"));
    expect(useSiteSettingsUiStore.getState().dialogOpen).toBe(true);
    expect(useSiteSettingsUiStore.getState().initialTab).toBe("search");
  });

  it("runs fix actions from finding cards", () => {
    useLaunchCenterStore.getState().openLaunchCenter();
    render(<LaunchCenter />);
    // The incomplete project has findings with an open-site-settings fix.
    const fixButton = screen.getAllByTestId("launch-fix-action")[0];
    fireEvent.click(fixButton);
    expect(useSiteSettingsUiStore.getState().dialogOpen).toBe(true);
  });
});

describe("runFixAction", () => {
  const deps = {
    openSiteSettings: () => {},
    openPreview: () => {},
    closeLaunchCenter: () => {},
  };

  function check(fixActionId: LaunchCheck["fixActionId"]): LaunchCheck {
    return {
      id: "x", category: "site-basics", status: "warning", title: "T",
      explanation: "E", suggestedAction: "S", fixActionId, severity: "minor", weight: 1,
    };
  }

  it("routes open-site-settings to the basics tab", () => {
    let tab = "";
    runFixAction(check("open-site-settings"), {
      ...deps,
      openSiteSettings: (t) => { tab = t ?? ""; },
    });
    expect(tab).toBe("basics");
  });

  it("routes open-seo-settings to the search tab", () => {
    let tab = "";
    runFixAction(check("open-seo-settings"), {
      ...deps,
      openSiteSettings: (t) => { tab = t ?? ""; },
    });
    expect(tab).toBe("search");
  });

  it("routes open-mobile-preview to a phone preview", () => {
    const calls: string[] = [];
    const dispatchSpy = (event: string) => calls.push(event);
    const originalDispatch = window.dispatchEvent.bind(window);
    window.dispatchEvent = ((event: Event) => {
      dispatchSpy((event as CustomEvent<string>).type);
      return true;
    }) as typeof window.dispatchEvent;

    try {
      runFixAction(check("open-mobile-preview"), {
        openSiteSettings: deps.openSiteSettings,
        openPreview: () => calls.push("preview"),
        closeLaunchCenter: () => calls.push("close"),
      });
      expect(calls).toContain("close");
      expect(calls).toContain("preview");
      expect(calls).toContain("buildora:preview-device");
    } finally {
      window.dispatchEvent = originalDispatch;
    }
  });

  it("falls back to preview for select-section actions", () => {
    const calls: string[] = [];
    runFixAction(check("select-section"), {
      ...deps,
      openPreview: () => calls.push("preview"),
      closeLaunchCenter: () => calls.push("close"),
    });
    expect(calls).toContain("close");
    expect(calls).toContain("preview");
  });
});
