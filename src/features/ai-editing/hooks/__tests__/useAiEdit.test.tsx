// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// useAiEdit — hook tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAiEdit } from "../useAiEdit";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useChatStore } from "@/features/chat/store/chat-store";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";
import type { EditTarget } from "../../types";

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

const HERO_TARGET: EditTarget = {
  kind: "section",
  sectionId: "s-hero",
  type: "hero",
  label: "Hero section",
  props: { headline: "Build beautiful websites\nwith AI assistance" },
};

const ORIGINAL_HEADLINE = "Build beautiful websites\nwith AI assistance";

function heroProps(): Record<string, unknown> {
  const section = useEditorStore
    .getState()
    .project.pages[0].sections.find((s) => s.id === "s-hero");
  return (section?.props ?? {}) as Record<string, unknown>;
}

function stubFetch(result: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => result,
    })),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
  useChatStore.getState().clearMessages();
  useEditorStore.getState().initProject(MOCK_PROJECT);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useAiEdit", () => {
  it("applies the edited props to the target section", async () => {
    stubFetch({
      success: true,
      source: "rule-based",
      edits: [{ type: "hero", props: { headline: "Playful New Hero", subheadline: "New sub" } }],
      warnings: [],
    });
    const { result } = renderHook(() => useAiEdit());

    await act(async () => {
      await result.current.edit("make it playful", HERO_TARGET);
    });

    expect(heroProps().headline).toBe("Playful New Hero");
    expect(heroProps().subheadline).toBe("New sub");
    // Props the edit did not touch are preserved (merge semantics)
    expect(heroProps().primaryCta).toEqual({ text: "Start Building Free", href: "#" });
  });

  it("adds user and assistant messages to the chat", async () => {
    stubFetch({
      success: true,
      source: "rule-based",
      edits: [{ type: "hero", props: { headline: "New" } }],
      warnings: [],
    });
    const { result } = renderHook(() => useAiEdit());

    await act(async () => {
      await result.current.edit("make it bold", HERO_TARGET);
    });

    const messages = useChatStore.getState().messages;
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("make it bold");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].status).toBe("complete");
    expect(messages[1].content).toContain("Hero section");
  });

  it("records a single undoable history entry", async () => {
    stubFetch({
      success: true,
      source: "gemini",
      edits: [{ type: "hero", props: { headline: "Edited" } }],
      warnings: [],
    });
    const { result } = renderHook(() => useAiEdit());

    await act(async () => {
      await result.current.edit("improve the headline", HERO_TARGET);
    });
    expect(heroProps().headline).toBe("Edited");

    act(() => {
      useEditorStore.getState().undo();
    });
    expect(heroProps().headline).toBe(ORIGINAL_HEADLINE);
  });

  it("reports a failed edit as an error message and leaves the project untouched", async () => {
    stubFetch({ success: false, error: { message: "Edit failed: boom" } });
    const { result } = renderHook(() => useAiEdit());

    await act(async () => {
      await result.current.edit("make it better", HERO_TARGET);
    });

    const messages = useChatStore.getState().messages;
    expect(messages[1].status).toBe("error");
    expect(messages[1].content).toContain("boom");
    expect(result.current.error).toContain("boom");
    expect(heroProps().headline).toContain("Build beautiful websites");
  });

  it("ignores edits that target a different section type", async () => {
    stubFetch({
      success: true,
      source: "rule-based",
      edits: [{ type: "footer", props: { text: "Nope" } }],
      warnings: [],
    });
    const { result } = renderHook(() => useAiEdit());

    await act(async () => {
      await result.current.edit("rewrite", HERO_TARGET);
    });
    expect(heroProps().headline).toContain("Build beautiful websites");
    expect(heroProps().text).toBeUndefined();
  });

  it("clears the error state on a subsequent successful edit", async () => {
    stubFetch({ success: false, error: { message: "first failure" } });
    const { result } = renderHook(() => useAiEdit());
    await act(async () => {
      await result.current.edit("bad", HERO_TARGET);
    });
    expect(result.current.error).toContain("first failure");

    stubFetch({
      success: true,
      source: "rule-based",
      edits: [{ type: "hero", props: { headline: "Fixed" } }],
      warnings: [],
    });
    await act(async () => {
      await result.current.edit("good", HERO_TARGET);
    });
    expect(result.current.error).toBeNull();
    expect(heroProps().headline).toBe("Fixed");
  });
});
