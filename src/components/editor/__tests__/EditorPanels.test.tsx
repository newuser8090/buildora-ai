// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Editor panels (Phase P22-K) — collapse/resize shell behavior
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useEditorUiStore } from "@/features/editor/ui/editor-ui-store";
import { clearEditorUIPrefs } from "@/features/editor/ui/editor-ui-prefs";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";
import { ResizeHandle } from "../ResizeHandle";
import { LeftSidebar } from "../LeftSidebar";
import { RightSidebar } from "../RightSidebar";

beforeEach(() => {
  vi.unstubAllGlobals();
  clearEditorUIPrefs();
  useEditorStore.getState().initProject(MOCK_PROJECT);
  useEditorUiStore.setState({
    ...useEditorUiStore.getState(),
    leftPanelCollapsed: false,
    rightPanelCollapsed: false,
    leftPanelWidth: 320,
    rightPanelWidth: 300,
    rightSidebarTab: "design",
  });
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  clearEditorUIPrefs();
});

// ---------------------------------------------------------------------------
// ResizeHandle
// ---------------------------------------------------------------------------

describe("ResizeHandle", () => {
  it("exposes the accessible separator contract", () => {
    render(
      <ResizeHandle
        testId="resize-left-handle"
        label="Resize AI assistant panel"
        value={320}
        min={240}
        max={480}
        multiplier={1}
        onChange={vi.fn()}
      />,
    );
    const handle = screen.getByTestId("resize-left-handle");
    expect(handle.getAttribute("role")).toBe("separator");
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.getAttribute("aria-valuenow")).toBe("320");
    expect(handle.getAttribute("aria-valuemin")).toBe("240");
    expect(handle.getAttribute("aria-valuemax")).toBe("480");
    expect(handle.tabIndex).toBe(0);
  });

  it("resizes by 8px steps with arrow keys (left panel multiplier +1)", () => {
    const onChange = vi.fn();
    render(
      <ResizeHandle
        testId="resize-left-handle"
        label="Resize"
        value={320}
        min={240}
        max={480}
        multiplier={1}
        onChange={onChange}
      />,
    );
    const handle = screen.getByTestId("resize-left-handle");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(328);
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(312);
  });

  it("reverses arrow direction for the right panel (multiplier -1)", () => {
    const onChange = vi.fn();
    render(
      <ResizeHandle
        testId="resize-right-handle"
        label="Resize"
        value={300}
        min={240}
        max={480}
        multiplier={-1}
        onChange={onChange}
      />,
    );
    const handle = screen.getByTestId("resize-right-handle");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(308);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(292);
  });

  it("supports Home/End jump-to-bounds", () => {
    const onChange = vi.fn();
    render(
      <ResizeHandle
        testId="resize-left-handle"
        label="Resize"
        value={320}
        min={240}
        max={480}
        multiplier={1}
        onChange={onChange}
      />,
    );
    const handle = screen.getByTestId("resize-left-handle");
    fireEvent.keyDown(handle, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(240);
    fireEvent.keyDown(handle, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(480);
  });

  it("prevents default for handled resize keys", () => {
    const onChange = vi.fn();
    render(
      <ResizeHandle
        testId="resize-left-handle"
        label="Resize"
        value={320}
        min={240}
        max={480}
        multiplier={1}
        onChange={onChange}
      />,
    );
    const handle = screen.getByTestId("resize-left-handle");
    // fireEvent returns false when the event was canceled (preventDefault).
    expect(fireEvent.keyDown(handle, { key: "ArrowRight" })).toBe(false);
  });

  it("drags with pointer events from the down position", () => {
    const onChange = vi.fn();
    render(
      <ResizeHandle
        testId="resize-left-handle"
        label="Resize"
        value={320}
        min={240}
        max={480}
        multiplier={1}
        onChange={onChange}
      />,
    );
    const handle = screen.getByTestId("resize-left-handle");
    fireEvent.pointerDown(handle, { clientX: 100 });
    fireEvent.pointerMove(handle, { clientX: 150 });
    expect(onChange).toHaveBeenLastCalledWith(370);
    fireEvent.pointerMove(handle, { clientX: 60 });
    expect(onChange).toHaveBeenLastCalledWith(280);
  });
});

// ---------------------------------------------------------------------------
// LeftSidebar collapse
// ---------------------------------------------------------------------------

describe("LeftSidebar collapse", () => {
  it("collapses to a rail and reopens via the rail button", () => {
    render(<LeftSidebar />);
    expect(screen.getByTestId("ai-sidebar")).toBeTruthy();

    const collapse = screen.getByTestId("collapse-left-panel");
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    expect(collapse.getAttribute("aria-controls")).toBe("ai-sidebar");
    fireEvent.click(collapse);

    // Rail replaces the full sidebar; the button flips to expand.
    expect(screen.queryByTestId("ai-sidebar")).toBeNull();
    expect(screen.getByTestId("ai-sidebar-rail")).toBeTruthy();
    const expand = screen.getByTestId("collapse-left-panel");
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(expand);
    expect(screen.getByTestId("ai-sidebar")).toBeTruthy();
    expect(screen.queryByTestId("ai-sidebar-rail")).toBeNull();
  });

  it("persists the left collapse preference", () => {
    render(<LeftSidebar />);
    fireEvent.click(screen.getByTestId("collapse-left-panel"));
    expect(useEditorUiStore.getState().leftPanelCollapsed).toBe(true);
  });

  it("applies the panel width to the aside", () => {
    useEditorUiStore.getState().setLeftPanelWidth(400);
    render(<LeftSidebar />);
    const aside = screen.getByTestId("ai-sidebar");
    expect(aside.style.width).toBe("400px");
  });
});

// ---------------------------------------------------------------------------
// RightSidebar collapse + tabs
// ---------------------------------------------------------------------------

describe("RightSidebar collapse + tabs", () => {
  it("collapses to a rail and reopens without losing the selected tab", () => {
    useEditorUiStore.getState().setRightSidebarTab("blocks");
    render(<RightSidebar />);

    const collapse = screen.getByTestId("collapse-right-panel");
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(collapse);

    expect(screen.getByTestId("right-sidebar-rail")).toBeTruthy();
    expect(useEditorUiStore.getState().rightSidebarTab).toBe("blocks");

    fireEvent.click(screen.getByTestId("collapse-right-panel"));
    expect(screen.getByTestId("blocks-panel")).toBeTruthy();
  });

  it("keeps the tab system functional after shell changes", () => {
    render(<RightSidebar />);
    // Default tab is design — the tab list still switches panels.
    fireEvent.click(screen.getByTestId("right-tab-structure"));
    expect(screen.getByTestId("structure-panel")).toBeTruthy();
    fireEvent.click(screen.getByTestId("right-tab-design"));
    expect(screen.getByTestId("design-panel")).toBeTruthy();
  });

  it("applies the right panel width to the aside", () => {
    useEditorUiStore.getState().setRightPanelWidth(380);
    render(<RightSidebar />);
    const aside = screen.getByLabelText("Editor sidebar");
    expect(aside.style.width).toBe("380px");
  });
});
