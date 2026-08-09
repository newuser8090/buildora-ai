// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// ReviewLinksTab — create + manage review links (component tests)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useShareUiStore } from "../../store/share-ui-store";
import { setShareProviderForTests } from "../../services/share-link-service";
import { clearShareLocalCacheForTests } from "../../services/share-local-cache";
import { ReviewLinksTab } from "../ReviewLinksTab";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";

function makeLink(overrides: Record<string, unknown> = {}) {
  return {
    id: "share-1",
    projectId: "proj-1",
    status: "active",
    feedbackEnabled: true,
    requireName: false,
    expiresAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    lastOpenedAt: null,
    feedbackCount: 2,
    ...overrides,
  };
}

function fakeProvider(overrides: Record<string, unknown> = {}) {
  return {
    kind: "mock",
    createShare: vi.fn().mockResolvedValue({
      link: makeLink(),
      rawToken: "t".repeat(43),
      url: "http://localhost:3000/share/tttt",
    }),
    listShares: vi.fn().mockResolvedValue([makeLink()]),
    shareStatusBatch: vi.fn().mockResolvedValue({}),
    updateShare: vi.fn(),
    pushSnapshot: vi.fn().mockResolvedValue(undefined),
    regenerateShare: vi.fn().mockResolvedValue({
      link: makeLink({ id: "share-2" }),
      rawToken: "r".repeat(43),
      url: "http://localhost:3000/share/rrrr",
    }),
    revokeShare: vi.fn().mockResolvedValue(undefined),
    listComments: vi.fn().mockResolvedValue([]),
    submitComment: vi.fn(),
    setCommentResolved: vi.fn(),
    deleteComment: vi.fn(),
    resolvePublic: vi.fn(),
    deleteProjectShareData: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  clearShareLocalCacheForTests();
  useEditorStore.getState().hydrateProject(JSON.parse(JSON.stringify(MOCK_PROJECT)) as never, 3);
  useShareUiStore.setState({ dialogOpen: false, tab: "create", refreshTick: 0 });
});

afterEach(() => {
  cleanup();
  setShareProviderForTests(null);
});

describe("create flow", () => {
  it("creates a link, pushes the projection, and shows the copyable URL", async () => {
    const provider = fakeProvider();
    setShareProviderForTests(provider as never);
    render(<ReviewLinksTab projectId="proj-1" />);

    await act(async () => {});
    fireEvent.click(screen.getByTestId("share-create-button"));
    await waitFor(() => {
      expect(screen.getByTestId("share-created-card")).toBeTruthy();
    });
    expect((screen.getByTestId("share-created-url") as HTMLInputElement).value).toBe(
      "http://localhost:3000/share/tttt",
    );
    expect(provider.createShare).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj-1", feedbackEnabled: true, preset: "never" }),
    );
    // The sanitized projection is pushed so the link renders immediately.
    expect(provider.pushSnapshot).toHaveBeenCalledWith(
      "share-1",
      expect.any(String),
      expect.any(Number),
    );
  });

  it("respects the feedback/name toggles and expiry selector", async () => {
    const provider = fakeProvider();
    setShareProviderForTests(provider as never);
    render(<ReviewLinksTab projectId="proj-1" />);

    fireEvent.click(screen.getByTestId("share-feedback-toggle")); // off
    fireEvent.change(screen.getByTestId("share-expiry-select"), { target: { value: "7d" } });
    fireEvent.click(screen.getByTestId("share-create-button"));
    await waitFor(() => {
      expect(screen.getByTestId("share-created-card")).toBeTruthy();
    });
    expect(provider.createShare).toHaveBeenCalledWith(
      expect.objectContaining({ feedbackEnabled: false, requireName: false, preset: "7d" }),
    );
  });

  it("surfaces creation errors with beginner copy", async () => {
    const provider = fakeProvider();
    provider.createShare.mockRejectedValue({ code: "PROJECTION_TOO_LARGE", message: "too large" });
    setShareProviderForTests(provider as never);
    render(<ReviewLinksTab projectId="proj-1" />);
    fireEvent.click(screen.getByTestId("share-create-button"));
    await waitFor(() => {
      const banner = screen.getByTestId("share-error");
      expect(banner.textContent).toContain("too large to share right now");
    });
  });

  it("revokes the link and shows an honest error when the snapshot push fails", async () => {
    const provider = fakeProvider();
    provider.pushSnapshot.mockRejectedValue({ code: "NETWORK_FAILED", message: "offline" });
    setShareProviderForTests(provider as never);
    render(<ReviewLinksTab projectId="proj-1" />);

    await act(async () => {});
    fireEvent.click(screen.getByTestId("share-create-button"));
    // The just-created link is best-effort revoked (never leave an active
    // link that 404s for viewers).
    await waitFor(() => {
      expect(provider.revokeShare).toHaveBeenCalledWith("share-1");
    });
    await waitFor(() => {
      const banner = screen.getByTestId("share-error");
      expect(banner.textContent).toContain("review service");
    });
    // Never a "ready" card for a dead link.
    expect(screen.queryByTestId("share-created-card")).toBeNull();
  });
});

describe("manage list", () => {
  it("lists links with metadata and copy/revoke/regenerate actions", async () => {
    const provider = fakeProvider({
      listShares: vi.fn().mockResolvedValue([
        makeLink({ id: "share-1", feedbackCount: 3, lastOpenedAt: "2026-08-05T00:00:00.000Z" }),
      ]),
    });
    setShareProviderForTests(provider as never);
    render(<ReviewLinksTab projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("share-feedback-count")).toBeTruthy();
    });
    expect(screen.getByTestId("share-feedback-count").textContent).toContain("3");
    expect(screen.getByTestId("share-last-opened").textContent).toContain("Opened");
    expect(screen.getByTestId("share-revoke-share-1")).toBeTruthy();
    expect(screen.getByTestId("share-regenerate-share-1")).toBeTruthy();
  });

  it("revoke requires confirmation and calls the provider", async () => {
    const provider = fakeProvider();
    setShareProviderForTests(provider as never);
    render(<ReviewLinksTab projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("share-revoke-share-1")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("share-revoke-share-1"));
    expect(screen.getByTestId("share-confirm-dialog")).toBeTruthy();
    // Cancel does nothing.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(provider.revokeShare).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("share-revoke-share-1"));
    fireEvent.click(screen.getByTestId("share-confirm-action"));
    await waitFor(() => {
      expect(provider.revokeShare).toHaveBeenCalledWith("share-1");
    });
  });

  it("regenerate requires confirmation and returns a fresh link", async () => {
    const provider = fakeProvider();
    setShareProviderForTests(provider as never);
    render(<ReviewLinksTab projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("share-regenerate-share-1")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("share-regenerate-share-1"));
    fireEvent.click(screen.getByTestId("share-confirm-action"));
    await waitFor(() => {
      expect(provider.regenerateShare).toHaveBeenCalledWith("share-1");
    });
    await waitFor(() => {
      expect(screen.getByTestId("share-created-card")).toBeTruthy();
    });
  });
});
