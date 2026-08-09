// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// FeedbackSheet — anonymous viewer feedback (component tests)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { setShareProviderForTests } from "../../services/share-link-service";
import { FeedbackSheet } from "../FeedbackSheet";

const SHARE = {
  shareId: "share-1",
  projectId: "proj-1",
  projectName: "My Site",
  feedbackEnabled: true,
  requireName: false,
};

function fakeProvider() {
  return {
    kind: "mock",
    createShare: vi.fn(),
    listShares: vi.fn(),
    shareStatusBatch: vi.fn(),
    updateShare: vi.fn(),
    pushSnapshot: vi.fn(),
    regenerateShare: vi.fn(),
    revokeShare: vi.fn(),
    listComments: vi.fn(),
    submitComment: vi.fn().mockResolvedValue({
      id: "c1",
      shareId: "share-1",
      projectId: "proj-1",
      pageId: "page-1",
      body: "Nice!",
      createdAt: "2026-08-06T00:00:00.000Z",
      resolvedAt: null,
    }),
    setCommentResolved: vi.fn(),
    deleteComment: vi.fn(),
    resolvePublic: vi.fn(),
    deleteProjectShareData: vi.fn(),
  };
}

beforeEach(() => {
  setShareProviderForTests(null);
});

afterEach(() => {
  cleanup();
  setShareProviderForTests(null);
});

describe("form", () => {
  it("requires a name when the share requires one", async () => {
    setShareProviderForTests(fakeProvider() as never);
    render(<FeedbackSheet share={{ ...SHARE, requireName: true }} token="token" onClose={vi.fn()} />);
    const submit = screen.getByTestId("feedback-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("feedback-name"), { target: { value: "Sam" } });
    fireEvent.change(screen.getByTestId("feedback-body"), { target: { value: "Nice!" } });
    expect(submit.disabled).toBe(false);
  });

  it("submits and shows a success confirmation", async () => {
    const provider = fakeProvider();
    setShareProviderForTests(provider as never);
    render(
      <FeedbackSheet share={SHARE} token="raw-token" pageId="page-1" onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByTestId("feedback-body"), { target: { value: "Nice!" } });
    fireEvent.click(screen.getByTestId("feedback-submit"));
    await waitFor(() => {
      expect(provider.submitComment).toHaveBeenCalledWith(
        "share-1",
        "raw-token",
        expect.objectContaining({ pageId: "page-1", body: "Nice!" }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText(/thanks — your feedback was sent/i)).toBeTruthy();
    });
  });

  it("surfaces safe error copy on failure", async () => {
    const provider = fakeProvider();
    provider.submitComment.mockRejectedValue({ code: "RATE_LIMITED", message: "rate limited" });
    setShareProviderForTests(provider as never);
    render(<FeedbackSheet share={SHARE} token="raw-token" onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId("feedback-body"), { target: { value: "hello" } });
    fireEvent.click(screen.getByTestId("feedback-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("feedback-error")).toBeTruthy();
    });
    expect(screen.getByTestId("feedback-error").textContent).toContain(
      "Too many comments",
    );
  });

  it("caps the body at the comment limit", () => {
    setShareProviderForTests(fakeProvider() as never);
    render(<FeedbackSheet share={SHARE} token="token" onClose={vi.fn()} />);
    const textarea = screen.getByTestId("feedback-body") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "x".repeat(2500) } });
    expect(textarea.value.length).toBe(2000);
  });

  it("renders comment text as plain text (no HTML execution)", async () => {
    const provider = fakeProvider();
    provider.submitComment.mockResolvedValue({
      id: "c1",
      shareId: "share-1",
      projectId: "proj-1",
      body: '<img src=x onerror="alert(1)">',
      createdAt: "2026-08-06T00:00:00.000Z",
      resolvedAt: null,
    });
    setShareProviderForTests(provider as never);
    render(<FeedbackSheet share={SHARE} token="token" onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId("feedback-body"), {
      target: { value: '<img src=x onerror="alert(1)">' },
    });
    fireEvent.click(screen.getByTestId("feedback-submit"));
    await waitFor(() => {
      expect(screen.getByText(/thanks — your feedback was sent/i)).toBeTruthy();
    });
  });
});
