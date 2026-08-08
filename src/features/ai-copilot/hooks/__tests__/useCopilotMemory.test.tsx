// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// useCopilotMemory — Phase P11 hook tests
//
// Focus: cross-project isolation on FRESH MOUNT. EditorShell mounts AFTER
// openProject() already set activeProjectId (dashboard → editor SPA
// navigation), so useCopilot's activeProjectId-change reset never fires.
// The hook must therefore reset the module-singleton Copilot store once per
// real mount so a previous editor session's conversation can never hydrate
// into — or later persist under — a different project.
// ---------------------------------------------------------------------------

import "fake-indexeddb/auto";
import { StrictMode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useCopilotStore } from "../../store/copilot-store";
import { useCopilotMemory } from "../useCopilotMemory";
import {
  getCopilotMemoryService,
  setCopilotMemoryServiceForTests,
} from "../../memory/services/copilot-memory-service";
import {
  getCopilotMemoryStorage,
  setCopilotMemoryStorageForTests,
} from "../../memory/storage/copilot-memory-storage";

const PROJ_A = "proj-a";
const PROJ_B = "proj-b";

function message(id: string, content: string) {
  return { id, role: "user" as const, content, createdAt: 1 };
}

async function seedMemory(projectId: string, content: string, note: string) {
  await getCopilotMemoryService().save({
    projectId,
    messages: [message(`${projectId}-m1`, content)],
    styleNotes: [note],
  });
}

beforeEach(async () => {
  // Isolate every test: drop the adapter singleton so a fresh DB connection
  // is used, then wipe the database and restore both stores to defaults.
  try {
    getCopilotMemoryStorage().close();
  } catch {
    // never opened — fine
  }
  setCopilotMemoryStorageForTests(null);
  setCopilotMemoryServiceForTests(null);
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("buildora");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  useEditorStore.setState({ activeProjectId: "", isHydrated: false });
  useCopilotStore.setState({
    messages: [],
    styleNotes: [],
    memoryRestored: false,
    open: false,
    status: "idle",
    planState: null,
    elementSuggestion: null,
    error: null,
    appliedSummary: null,
    lastRequest: null,
  });
});

describe("useCopilotMemory — cross-project isolation (Phase P11)", () => {
  it("a fresh mount for project B never shows or persists project A's conversation", async () => {
    // Previous editor session on project A: its memory was loaded into the
    // module-singleton store, then the user left via SPA navigation (back to
    // dashboard), which does NOT reset the Copilot store.
    useCopilotStore.setState({
      messages: [message("a-1", "A conversation message")],
      styleNotes: ["A note"],
      memoryRestored: true,
    });
    await seedMemory(PROJ_B, "B saved message", "B note");

    // Simulate openProject(PROJ_B) having ALREADY set activeProjectId before
    // EditorShell mounts (the editor page resolves the transition, THEN
    // renders the shell). No activeProjectId-change fires while the hook is
    // subscribed — this is the gap the fresh-mount reset must cover.
    useEditorStore.setState({ activeProjectId: PROJ_B, isHydrated: true });

    // Fresh mount of the hook (new EditorShell for project B).
    renderHook(() => useCopilotMemory());

    // The stale A conversation must be replaced by B's saved memory.
    await waitFor(() => {
      const s = useCopilotStore.getState();
      expect(s.messages.map((m) => m.content)).toEqual(["B saved message"]);
      expect(s.styleNotes).toEqual(["B note"]);
    });

    // A subsequent message is persisted ONLY under B — A's conversation is
    // never written into B's record, and A's record is never created.
    act(() => {
      useCopilotStore.getState().addUserMessage("B follow-up");
    });
    await waitFor(async () => {
      const b = await getCopilotMemoryService().load(PROJ_B);
      expect(b?.messages.map((m) => m.content)).toEqual([
        "B saved message",
        "B follow-up",
      ]);
      const a = await getCopilotMemoryService().load(PROJ_A);
      expect(a).toBeNull();
    });
  });

  it("StrictMode's double effect hydrates exactly once and never clobbers", async () => {
    await seedMemory(PROJ_B, "B saved message", "B note");
    useEditorStore.setState({ activeProjectId: PROJ_B, isHydrated: true });

    renderHook(() => useCopilotMemory(), {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    });

    await waitFor(() => {
      const s = useCopilotStore.getState();
      expect(s.messages.map((m) => m.content)).toEqual(["B saved message"]);
    });
    // The double load must not duplicate messages or reset style notes.
    expect(useCopilotStore.getState().messages.length).toBe(1);
    expect(useCopilotStore.getState().styleNotes).toEqual(["B note"]);
  });

  it("messages typed after mount but before the load resolves are authoritative", async () => {
    await seedMemory(PROJ_B, "B saved message", "B note");
    useEditorStore.setState({ activeProjectId: PROJ_B, isHydrated: true });

    renderHook(() => useCopilotMemory());

    // The user types before the async IndexedDB load resolves. The in-progress
    // guard must preserve this live conversation over the saved memory — even
    // after the load has resolved.
    act(() => {
      useCopilotStore.getState().addUserMessage("Typed before load");
    });

    // The live message is persisted (microtask write) under the current
    // project…
    await waitFor(async () => {
      const b = await getCopilotMemoryService().load(PROJ_B);
      expect(b?.messages.map((m) => m.content)).toContain("Typed before load");
    });
    // …and the store still shows the live conversation, not the saved memory.
    expect(useCopilotStore.getState().messages.map((m) => m.content)).toEqual([
      "Typed before load",
    ]);
  });
});
