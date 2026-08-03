// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// LeftSidebar — AI-editing mode tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useChatStore } from "@/features/chat/store/chat-store";
import { LeftSidebar } from "../LeftSidebar";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function heroProps(): Record<string, unknown> {
  const section = useEditorStore
    .getState()
    .project.pages[0].sections.find((s) => s.id === "s-hero");
  return (section?.props ?? {}) as Record<string, unknown>;
}

function stubEditFetch() {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      success: true,
      source: "rule-based",
      edits: [{ type: "hero", props: { headline: "Edited By AI" } }],
      warnings: [],
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function lastRequestBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return JSON.parse(String(init?.body ?? "{}"));
}

beforeEach(() => {
  vi.unstubAllGlobals();
  useChatStore.getState().clearMessages();
  useEditorStore.getState().initProject(MOCK_PROJECT);
  Element.prototype.scrollIntoView = vi.fn();
});

function seedSelection() {
  useEditorStore.getState().selectSection("s-hero");
}

// ---------------------------------------------------------------------------
// Edit-target chip
// ---------------------------------------------------------------------------

describe("LeftSidebar edit mode", () => {
  it("shows the edit chip when a section is selected", () => {
    seedSelection();
    render(<LeftSidebar />);
    expect(screen.getByTestId("edit-target-chip")).toBeTruthy();
    expect(screen.getByText("Hero section")).toBeTruthy();
  });

  it("hides the chip when no section is selected", () => {
    render(<LeftSidebar />);
    expect(screen.queryByTestId("edit-target-chip")).toBeNull();
  });

  it("stop-editing clears the section selection", () => {
    seedSelection();
    render(<LeftSidebar />);
    fireEvent.click(screen.getByLabelText("Stop editing section"));
    expect(useEditorStore.getState().selectedSectionId).toBeNull();
  });

  it("placeholder reflects the selected section", () => {
    seedSelection();
    render(<LeftSidebar />);
    const textarea = screen.getByTestId("prompt-input");
    expect((textarea as HTMLTextAreaElement).placeholder).toBe(
      "Describe how to edit the hero section...",
    );
  });
});

// ---------------------------------------------------------------------------
// Edit submission
// ---------------------------------------------------------------------------

describe("LeftSidebar edit submission", () => {
  it("sends a modify request and applies the edited props", async () => {
    seedSelection();
    const fetchMock = stubEditFetch();
    render(<LeftSidebar />);

    const textarea = screen.getByTestId("prompt-input");
    fireEvent.change(textarea, { target: { value: "make it playful" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(heroProps().headline).toBe("Edited By AI");
    });

    const body = lastRequestBody(fetchMock);
    expect(body.mode).toBe("modify");
    const target = body.target as Record<string, unknown>;
    expect(target.kind).toBe("section");
    expect(target.sectionId).toBe("s-hero");
    expect(target.type).toBe("hero");
    expect(target.context).toEqual({ brandName: "SaaS Landing Page" });

    // A user + assistant message pair was added to the chat
    const messages = useChatStore.getState().messages;
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toContain("Hero section");
  });

  it("regenerate sends a modify request with the default instruction", async () => {
    seedSelection();
    const fetchMock = stubEditFetch();
    render(<LeftSidebar />);

    fireEvent.click(screen.getByTestId("regenerate-section"));

    await waitFor(() => {
      expect(heroProps().headline).toBe("Edited By AI");
    });

    const body = lastRequestBody(fetchMock);
    expect(body.mode).toBe("modify");
    expect(String(body.prompt)).toContain("Rewrite this section");
  });

  it("routes to create mode when no section is selected", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        source: "rule-based",
        project: MOCK_PROJECT,
        warnings: [],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LeftSidebar />);

    const textarea = screen.getByTestId("prompt-input");
    fireEvent.change(textarea, { target: { value: "Build a website" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(
      () => {
        expect(fetchMock).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );

    const body = lastRequestBody(fetchMock);
    expect(body.mode).toBe("create");
  });
});
