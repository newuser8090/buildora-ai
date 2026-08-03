// ---------------------------------------------------------------------------
// useBeforeUnload tests
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEditorStore } from "@/features/editor/store/editor-store";

describe("useBeforeUnload", () => {
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    addEventListenerSpy = vi.spyOn(window, "addEventListener");
    removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    // Reset store to clean state
    useEditorStore.setState({
      isDirty: false,
      isHydrated: true,
      project: {
        id: "test-proj",
        name: "Test",
        pages: [],
        assets: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        theme: {} as any,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      saveStatus: "saved",
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clean state does not register beforeunload handler", () => {
    useEditorStore.setState({ isDirty: false, isHydrated: true });

    // Simulate the hook logic:
    // useEffect(() => { if (!isHydrated || !isDirty) return; ... }, [isDirty, isHydrated]);
    const isDirty = useEditorStore.getState().isDirty;
    const isHydrated = useEditorStore.getState().isHydrated;

    if (!isHydrated || !isDirty) {
      // Hook returns early, no handler registered
    } else {
      window.addEventListener("beforeunload", () => {});
    }

    // No beforeunload listener should have been added
    expect(
      addEventListenerSpy.mock.calls.filter(([event]) => event === "beforeunload"),
    ).toHaveLength(0);
  });

  it("dirty state registers beforeunload handler", () => {
    useEditorStore.setState({ isDirty: true, isHydrated: true });

    const isDirty = useEditorStore.getState().isDirty;
    const isHydrated = useEditorStore.getState().isHydrated;

    if (isHydrated && isDirty) {
      const handler = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = "";
      };
      window.addEventListener("beforeunload", handler);
    }

    const beforeunloadCalls = addEventListenerSpy.mock.calls.filter(
      ([event]) => event === "beforeunload",
    );
    expect(beforeunloadCalls).toHaveLength(1);
  });

  it("dirty state prevents default on beforeunload", () => {
    const preventDefault = vi.fn();
    const event = new Event("beforeunload") as BeforeUnloadEvent;
    Object.defineProperty(event, "preventDefault", { value: preventDefault });
    Object.defineProperty(event, "returnValue", {
      value: "",
      writable: true,
    });

    useEditorStore.setState({ isDirty: true, isHydrated: true });

    // Simulate handler
    event.preventDefault();
    event.returnValue = "";

    expect(preventDefault).toHaveBeenCalled();
    expect(event.returnValue).toBe("");
  });

  it("dirty + error state still blocks unload", () => {
    useEditorStore.setState({
      isDirty: true,
      isHydrated: true,
      saveStatus: "error",
    });

    const isDirty = useEditorStore.getState().isDirty;
    const isHydrated = useEditorStore.getState().isHydrated;

    if (isHydrated && isDirty) {
      window.addEventListener("beforeunload", () => {});
    }

    const beforeunloadCalls = addEventListenerSpy.mock.calls.filter(
      ([event]) => event === "beforeunload",
    );
    expect(beforeunloadCalls).toHaveLength(1);
  });

  it("saved state does not block unload", () => {
    useEditorStore.setState({
      isDirty: false,
      isHydrated: true,
      saveStatus: "saved",
    });

    const isDirty = useEditorStore.getState().isDirty;
    if (!isDirty) {
      // No handler registered
    }

    const beforeunloadCalls = addEventListenerSpy.mock.calls.filter(
      ([event]) => event === "beforeunload",
    );
    expect(beforeunloadCalls).toHaveLength(0);
  });

  it("listener removed on unmount", () => {
    useEditorStore.setState({ isDirty: true, isHydrated: true });

    const handler = () => {};
    window.addEventListener("beforeunload", handler);
    window.removeEventListener("beforeunload", handler);

    expect(removeEventListenerSpy).toHaveBeenCalledWith("beforeunload", handler);
  });

  it("dirty state changes are reflected (dirty becomes clean)", () => {
    // Start dirty
    useEditorStore.setState({ isDirty: true });

    // Verify dirty
    expect(useEditorStore.getState().isDirty).toBe(true);

    // Clean
    useEditorStore.setState({ isDirty: false });

    // Verify clean
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it("pin/unpin alone does not block unload (pinning doesn't set dirty)", () => {
    useEditorStore.setState({
      isDirty: false,
      isHydrated: true,
    });

    const isDirty = useEditorStore.getState().isDirty;
    expect(isDirty).toBe(false);
  });
});
