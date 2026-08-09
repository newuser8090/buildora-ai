// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// ReviewFeedbackTab — owner review panel (component tests)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useShareUiStore } from "../../store/share-ui-store";
import { setShareProviderForTests } from "../../services/share-link-service";
import { ReviewFeedbackTab } from "../ReviewFeedbackTab";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";

function makeComment(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    shareId: "share-1",
    projectId: "proj-1",
    pageId: "page-1",
    sectionId: "s-hero",
    authorName: "Sam",
    body: "Love the hero!",
    createdAt: "2026-08-05T00:00:00.000Z",
    resolvedAt: null,
    ...overrides,
  };
}

function fakeProvider(comments: unknown[]) {
  return {
    kind: "mock",
    createShare: vi.fn(),
    listShares: vi.fn().mockResolvedValue([
      { id: "share-1", projectId: "proj-1", status: "active" },
    ]),
    shareStatusBatch: vi.fn().mockResolvedValue({}),
    updateShare: vi.fn(),
    pushSnapshot: vi.fn(),
    regenerateShare: vi.fn(),
    revokeShare: vi.fn(),
    listComments: vi.fn().mockResolvedValue(comments),
    submitComment: vi.fn(),
    setCommentResolved: vi.fn().mockResolvedValue(undefined),
    deleteComment: vi.fn().mockResolvedValue(undefined),
    resolvePublic: vi.fn(),
    deleteProjectShareData: vi.fn(),
  };
}

beforeEach(() => {
  useEditorStore.getState().hydrateProject(JSON.parse(JSON.stringify(MOCK_PROJECT)) as never, 3);
  useShareUiStore.setState({ dialogOpen: false, tab: "feedback", refreshTick: 0 });
});

afterEach(() => {
  cleanup();
  setShareProviderForTests(null);
});

describe("comment list", () => {
  it("renders comments grouped by page with author, date, and body as text", async () => {
    setShareProviderForTests(fakeProvider([makeComment()]) as never);
    render(<ReviewFeedbackTab />);
    await waitFor(() => {
      expect(screen.getByTestId("review-comment")).toBeTruthy();
    });
    expect(screen.getByText("Sam")).toBeTruthy();
    expect(screen.getByText("Love the hero!")).toBeTruthy();
    // Grouped under the page title (from the live project).
    expect(screen.getByText("Home")).toBeTruthy();
  });

  it("groups page-less comments under General", async () => {
    setShareProviderForTests(fakeProvider([makeComment({ pageId: undefined })]) as never);
    render(<ReviewFeedbackTab />);
    await waitFor(() => {
      expect(screen.getByText("General")).toBeTruthy();
    });
  });

  it("shows an honest deleted-section state and does not attach elsewhere", async () => {
    // The comment references a section that does not exist in the live project.
    setShareProviderForTests(fakeProvider([makeComment({ sectionId: "s-gone" })]) as never);
    render(<ReviewFeedbackTab />);
    await waitFor(() => {
      expect(screen.getByText("This section no longer exists")).toBeTruthy();
    });
  });
});

describe("resolve / reopen / delete", () => {
  it("resolves a comment and reopens it", async () => {
    const provider = fakeProvider([makeComment()]);
    setShareProviderForTests(provider as never);
    render(<ReviewFeedbackTab />);
    await waitFor(() => {
      expect(screen.getByTestId("comment-resolve-c1")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("comment-resolve-c1"));
    await waitFor(() => {
      expect(provider.setCommentResolved).toHaveBeenCalledWith("share-1", "c1", true);
    });
    await waitFor(() => {
      expect(screen.getByTestId("comment-reopen-c1")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("comment-reopen-c1"));
    await waitFor(() => {
      expect(provider.setCommentResolved).toHaveBeenCalledWith("share-1", "c1", false);
    });
  });

  it("deletes a comment after confirmation", async () => {
    const provider = fakeProvider([makeComment()]);
    setShareProviderForTests(provider as never);
    render(<ReviewFeedbackTab />);
    await waitFor(() => {
      expect(screen.getByTestId("comment-delete-c1")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("comment-delete-c1"));
    expect(screen.getByTestId("share-delete-comment-dialog")).toBeTruthy();
    fireEvent.click(screen.getByTestId("share-delete-comment-confirm"));
    await waitFor(() => {
      expect(provider.deleteComment).toHaveBeenCalledWith("share-1", "c1");
    });
    await waitFor(() => {
      expect(screen.queryByTestId("review-comment")).toBeNull();
    });
  });
});

describe("jump to location", () => {
  it("selects the page and section in the editor and closes the dialog", async () => {
    setShareProviderForTests(fakeProvider([makeComment()]) as never);
    render(<ReviewFeedbackTab />);
    await waitFor(() => {
      expect(screen.getByText("Jump to section")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Jump to section"));
    expect(useEditorStore.getState().selectedPageId).toBe("page-1");
    expect(useEditorStore.getState().selectedSectionId).toBe("s-hero");
    // The canonical dialog closes (assert store state — spying on the zustand
    // action is a stale closure).
    expect(useShareUiStore.getState().dialogOpen).toBe(false);
  });
});
