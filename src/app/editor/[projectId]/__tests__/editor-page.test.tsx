// ---------------------------------------------------------------------------
// EditorPage — /editor/[projectId] load-state machine tests
//
// Focus: the StrictMode-safe openProject() branch. React dev double-invokes
// effects (setup → cleanup → setup). The simulated cleanup cancels the first
// run's continuation, so the second setup must REUSE the in-flight transition
// (no duplicate openProject() call / duplicate controller transition) and the
// guard must be reset so the second setup is not swallowed. Otherwise the
// (single) openProject() result is discarded and the editor stays on
// "Opening project..." forever.
//
// The environment (React 19 + RTL in vitest) does not double-invoke effects
// under <StrictMode> (verified empirically in use-thumbnail-object-url tests),
// so the double-invoke is simulated deterministically by changing a dependency
// while the transition is in flight — this runs the exact cleanup → setup
// cycle StrictMode performs.
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import EditorPage from "../page";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { ProjectTransitionResult } from "@/features/persistence/types";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ projectId: "proj-1" }),
}));

const mockOpenProject = vi.fn();
const mockController = { openProject: mockOpenProject };
// Explicitly typed so tests can also return null (controller not yet ready).
const mockGetController = vi.fn<() => typeof mockController | null>(() => mockController);

vi.mock("@/features/persistence/services/project-controller", () => ({
  getProjectController: () => mockGetController(),
}));

// The editor chrome only renders once the page reaches "loaded" — stub it so
// these tests exercise only the load-state machine, not the full editor.
vi.mock("@/components/editor/EditorProvider", () => ({
  EditorProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="editor-provider">{children}</div>
  ),
}));
vi.mock("@/components/editor/TopNav", () => ({
  TopNav: () => <div />,
}));
vi.mock("@/components/editor/LeftSidebar", () => ({
  LeftSidebar: () => <div />,
}));
vi.mock("@/components/editor/Canvas", () => ({
  Canvas: () => <div />,
}));
vi.mock("@/components/editor/RightSidebar", () => ({
  RightSidebar: () => <div />,
}));
vi.mock("@/components/editor/StatusBar", () => ({
  StatusBar: () => <div />,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function resetStore(): void {
  useEditorStore.setState({
    activeProjectId: "",
    isHydrated: true,
  });
}

describe("EditorPage — load-state machine", () => {
  beforeEach(() => {
    mockGetController.mockReturnValue(mockController);
    mockOpenProject.mockReset();
    mockPush.mockClear();
    resetStore();
  });

  afterEach(() => {
    cleanup();
  });

  it("opens a non-active project and renders the editor", async () => {
    const d = deferred<ProjectTransitionResult>();
    mockOpenProject.mockReturnValue(d.promise);

    render(<EditorPage />);
    expect(screen.getByText("Opening project...")).toBeTruthy();
    expect(mockOpenProject).toHaveBeenCalledTimes(1);
    expect(mockOpenProject).toHaveBeenCalledWith("proj-1");

    await act(async () => {
      d.resolve({ success: true });
    });

    await waitFor(() =>
      expect(screen.getByTestId("editor-provider")).toBeTruthy(),
    );
    expect(mockOpenProject).toHaveBeenCalledTimes(1);
  });

  it("reuses the in-flight openProject transition when the effect re-runs (StrictMode-safe)", async () => {
    const d = deferred<ProjectTransitionResult>();
    mockOpenProject.mockReturnValue(d.promise);

    render(<EditorPage />);
    expect(mockOpenProject).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Opening project...")).toBeTruthy();

    // Simulate StrictMode's cleanup → setup cycle: a dependency change while
    // the transition is in flight runs the cleanup (cancelling the first
    // run's continuation) then a fresh setup.
    act(() => {
      useEditorStore.setState({ activeProjectId: "other-proj" });
    });

    // The second setup must REUSE the in-flight promise — never a second
    // openProject() call (which would be a duplicate controller transition).
    expect(mockOpenProject).toHaveBeenCalledTimes(1);

    await act(async () => {
      d.resolve({ success: true });
    });

    // The result is applied by the second run's continuation → editor loads.
    await waitFor(() =>
      expect(screen.getByTestId("editor-provider")).toBeTruthy(),
    );
    expect(mockOpenProject).toHaveBeenCalledTimes(1);
  });

  it("mounts under React StrictMode without duplicate transitions or a stuck loader", async () => {
    const d = deferred<ProjectTransitionResult>();
    mockOpenProject.mockReturnValue(d.promise);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    );
    render(<EditorPage />, { wrapper });

    // If this React build double-invokes effects, the guard + promise reuse
    // must keep openProject() to a single call; otherwise this is a smoke
    // test of a normal mount. Either way the editor must reach "loaded".
    expect(mockOpenProject).toHaveBeenCalledTimes(1);

    await act(async () => {
      d.resolve({ success: true });
    });

    await waitFor(() =>
      expect(screen.getByTestId("editor-provider")).toBeTruthy(),
    );
    expect(mockOpenProject).toHaveBeenCalledTimes(1);
  });

  it("does not call openProject when the project is already active", async () => {
    useEditorStore.setState({ activeProjectId: "proj-1", isHydrated: true });

    render(<EditorPage />);

    await waitFor(() =>
      expect(screen.getByTestId("editor-provider")).toBeTruthy(),
    );
    expect(mockOpenProject).not.toHaveBeenCalled();
  });

  it("shows not-found when the project fails to load", async () => {
    mockOpenProject.mockResolvedValue({
      success: false,
      code: "PROJECT_LOAD_FAILED",
      error: { code: "PROJECT_NOT_FOUND", message: "missing" },
    });

    render(<EditorPage />);

    await waitFor(() => expect(screen.getByText("Project Not Found")).toBeTruthy());
    expect(mockOpenProject).toHaveBeenCalledTimes(1);
  });

  it("shows the save-before-transition error", async () => {
    mockOpenProject.mockResolvedValue({
      success: false,
      code: "SAVE_BEFORE_TRANSITION_FAILED",
      error: { code: "TRANSACTION_FAILED", message: "flush failed" },
    });

    render(<EditorPage />);

    await waitFor(() => expect(screen.getByText("Could Not Open Project")).toBeTruthy());
    await waitFor(() =>
      expect(
        screen.getByText(/cannot switch projects/i),
      ).toBeTruthy(),
    );
  });

  it("shows the controller error message on generic failure", async () => {
    mockOpenProject.mockResolvedValue({
      success: false,
      code: "TRANSITION_IN_PROGRESS",
      error: { code: "UNKNOWN_PERSISTENCE_ERROR", message: "busy" },
    });

    render(<EditorPage />);

    await waitFor(() => expect(screen.getByText("Could Not Open Project")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("busy")).toBeTruthy());
  });

  it("shows an error when openProject rejects", async () => {
    mockOpenProject.mockRejectedValue(new Error("boom"));

    render(<EditorPage />);

    await waitFor(() => expect(screen.getByText("Could Not Open Project")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("boom")).toBeTruthy());
  });

  it("discards the openProject result when unmounted before resolution", async () => {
    const d = deferred<ProjectTransitionResult>();
    mockOpenProject.mockReturnValue(d.promise);

    const { unmount } = render(<EditorPage />);
    expect(screen.getByText("Opening project...")).toBeTruthy();

    unmount();

    await act(async () => {
      d.resolve({ success: true });
    });

    // No crash and no editor rendered after unmount.
    expect(screen.queryByTestId("editor-provider")).toBeNull();
  });

  it("re-schedules the retry when the controller is unavailable (guard reset on cleanup)", async () => {
    // This simulates the cleanup → setup cycle StrictMode performs for the
    // retry branch: the simulated unmount must not permanently swallow the
    // re-run (which would leave the retry timer dead and the editor stuck on
    // "Opening project..." forever).
    vi.useFakeTimers();
    try {
      mockGetController.mockReturnValue(null);
      mockOpenProject.mockResolvedValue({ success: true });

      const { unmount } = render(<EditorPage />);
      expect(screen.getByText("Opening project...")).toBeTruthy();

      // Retry timer fires → the guard is re-armed so a later effect re-run
      // (when the controller appears and a dependency changes) can proceed.
      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      // Controller becomes available; a dependency change re-runs the effect.
      mockGetController.mockReturnValue(mockController);
      act(() => {
        useEditorStore.setState({ activeProjectId: "other-proj" });
      });

      expect(mockOpenProject).toHaveBeenCalledTimes(1);

      // Flush the resolved openProject promise. Direct assertion instead of
      // waitFor: with fake timers active, RTL's waitFor can hang on a
      // non-immediate check (it relies on real setInterval).
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByTestId("editor-provider")).toBeTruthy();
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
