// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// ShareDialog — component tests (gates, tabs, entry points)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useAuthStore } from "@/features/auth/auth-store";
import { useShareUiStore } from "../../store/share-ui-store";
import { setShareProviderForTests } from "../../services/share-link-service";
import { ShareDialog } from "../ShareDialog";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";

function fakeProvider() {
  return {
    kind: "mock",
    createShare: vi.fn().mockResolvedValue({
      link: {
        id: "share-1",
        projectId: "proj-1",
        status: "active",
        feedbackEnabled: true,
        requireName: false,
        expiresAt: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        lastOpenedAt: null,
        feedbackCount: 0,
      },
      rawToken: "t".repeat(43),
      url: "http://localhost:3000/share/tttt",
    }),
    listShares: vi.fn().mockResolvedValue([]),
    shareStatusBatch: vi.fn().mockResolvedValue({}),
    updateShare: vi.fn(),
    pushSnapshot: vi.fn().mockResolvedValue(undefined),
    regenerateShare: vi.fn(),
    revokeShare: vi.fn(),
    listComments: vi.fn().mockResolvedValue([]),
    submitComment: vi.fn(),
    setCommentResolved: vi.fn(),
    deleteComment: vi.fn(),
    resolvePublic: vi.fn(),
    deleteProjectShareData: vi.fn(),
  };
}

function openDialog() {
  useShareUiStore.getState().openShareDialog("create");
  return render(<ShareDialog />);
}

beforeEach(() => {
  useEditorStore.getState().hydrateProject(JSON.parse(JSON.stringify(MOCK_PROJECT)) as never, 3);
  useAuthStore.setState({
    status: "signed-in",
    session: {
      user: { id: "u1", email: "a@example.com", emailVerified: true },
      createdAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-08-08T00:00:00.000Z",
    },
    error: null,
    busy: false,
  });
  useShareUiStore.setState({ dialogOpen: false, tab: "create", refreshTick: 0 });
  setShareProviderForTests(fakeProvider() as never);
});

afterEach(() => {
  cleanup();
  useShareUiStore.setState({ dialogOpen: false });
  setShareProviderForTests(null);
});

describe("gates", () => {
  it("renders nothing when closed", () => {
    render(<ShareDialog />);
    expect(screen.queryByTestId("share-dialog")).toBeNull();
  });

  it("shows the create surface when signed in", () => {
    openDialog();
    expect(screen.getByTestId("share-dialog")).toBeTruthy();
    expect(screen.getByText("Create a review link")).toBeTruthy();
    expect(screen.getByTestId("share-feedback-toggle")).toBeTruthy();
    expect(screen.getByTestId("share-expiry-select")).toBeTruthy();
  });

  it("prompts to sign in when signed out", () => {
    useAuthStore.setState({ status: "signed-out", session: null });
    openDialog();
    expect(screen.getByText("Sign in to share this website")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("shows offline copy when the browser is offline", () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    try {
      openDialog();
      expect(screen.getByText(/reconnect to create or manage review links/i)).toBeTruthy();
    } finally {
      Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    }
  });

  it("closes on Escape and via the close button", () => {
    openDialog();
    fireEvent.click(screen.getByTestId("share-dialog-close"));
    expect(useShareUiStore.getState().dialogOpen).toBe(false);
    openDialog();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useShareUiStore.getState().dialogOpen).toBe(false);
  });
});

describe("tabs", () => {
  it("switches between Review links and Review feedback", () => {
    openDialog();
    fireEvent.click(screen.getByRole("tab", { name: "Review feedback" }));
    expect(screen.getByTestId("review-feedback-summary")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Review links" }));
    expect(screen.getByText("Create a review link")).toBeTruthy();
  });

  it("opens the feedback tab when requested via the store", () => {
    useShareUiStore.getState().openShareDialog("feedback");
    render(<ShareDialog />);
    expect(screen.getByTestId("review-feedback-summary")).toBeTruthy();
  });
});
