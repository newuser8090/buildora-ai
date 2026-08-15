// ---------------------------------------------------------------------------
// Editor UI store (Phase P22-K) — panel shell state
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useEditorUiStore } from "../editor-ui-store";
import {
  DEFAULT_EDITOR_UI_PREFS,
  MIN_PANEL_WIDTH,
  MAX_PANEL_WIDTH,
  loadEditorUIPrefs,
  clearEditorUIPrefs,
} from "../editor-ui-prefs";

function defaultPanelState() {
  return {
    leftPanelCollapsed: DEFAULT_EDITOR_UI_PREFS.leftPanelCollapsed,
    rightPanelCollapsed: DEFAULT_EDITOR_UI_PREFS.rightPanelCollapsed,
    leftPanelWidth: DEFAULT_EDITOR_UI_PREFS.leftPanelWidth,
    rightPanelWidth: DEFAULT_EDITOR_UI_PREFS.rightPanelWidth,
  };
}

beforeEach(() => {
  clearEditorUIPrefs();
  useEditorUiStore.setState({
    ...useEditorUiStore.getState(),
    ...defaultPanelState(),
    rightSidebarTab: "design",
  });
});

afterEach(() => {
  clearEditorUIPrefs();
});

describe("EditorUiStore — panel defaults", () => {
  it("defaults to the current fixed widths, expanded", () => {
    const state = useEditorUiStore.getState();
    expect(state.leftPanelWidth).toBe(320);
    expect(state.rightPanelWidth).toBe(300);
    expect(state.leftPanelCollapsed).toBe(false);
    expect(state.rightPanelCollapsed).toBe(false);
  });
});

describe("EditorUiStore — collapse setters", () => {
  it("sets left and right collapse independently", () => {
    useEditorUiStore.getState().setLeftPanelCollapsed(true);
    expect(useEditorUiStore.getState().leftPanelCollapsed).toBe(true);
    expect(useEditorUiStore.getState().rightPanelCollapsed).toBe(false);
    useEditorUiStore.getState().setRightPanelCollapsed(true);
    expect(useEditorUiStore.getState().rightPanelCollapsed).toBe(true);
    expect(useEditorUiStore.getState().leftPanelCollapsed).toBe(true);
    useEditorUiStore.getState().setLeftPanelCollapsed(false);
    expect(useEditorUiStore.getState().leftPanelCollapsed).toBe(false);
    expect(useEditorUiStore.getState().rightPanelCollapsed).toBe(true);
  });

  it("persists collapse state to localStorage prefs", () => {
    useEditorUiStore.getState().setRightPanelCollapsed(true);
    expect(loadEditorUIPrefs().rightPanelCollapsed).toBe(true);
    expect(loadEditorUIPrefs().leftPanelCollapsed).toBe(false);
  });
});

describe("EditorUiStore — width setters", () => {
  it("sets widths and persists them", () => {
    useEditorUiStore.getState().setLeftPanelWidth(400);
    useEditorUiStore.getState().setRightPanelWidth(260);
    expect(useEditorUiStore.getState().leftPanelWidth).toBe(400);
    expect(useEditorUiStore.getState().rightPanelWidth).toBe(260);
    expect(loadEditorUIPrefs().leftPanelWidth).toBe(400);
    expect(loadEditorUIPrefs().rightPanelWidth).toBe(260);
  });

  it("clamps widths into the panel bounds", () => {
    useEditorUiStore.getState().setLeftPanelWidth(10);
    expect(useEditorUiStore.getState().leftPanelWidth).toBe(MIN_PANEL_WIDTH);
    useEditorUiStore.getState().setRightPanelWidth(5000);
    expect(useEditorUiStore.getState().rightPanelWidth).toBe(MAX_PANEL_WIDTH);
  });

  it("ignores non-finite widths", () => {
    useEditorUiStore.getState().setLeftPanelWidth(Number.NaN);
    expect(useEditorUiStore.getState().leftPanelWidth).toBe(320);
  });

  it("keeps left and right widths independent", () => {
    useEditorUiStore.getState().setLeftPanelWidth(360);
    expect(useEditorUiStore.getState().rightPanelWidth).toBe(300);
    useEditorUiStore.getState().setRightPanelWidth(280);
    expect(useEditorUiStore.getState().leftPanelWidth).toBe(360);
  });
});

describe("EditorUiStore — hydration", () => {
  it("hydratePanelPrefs re-reads persisted prefs into state", () => {
    // Simulate a persisted custom layout (as if another tab wrote it).
    useEditorUiStore.getState().setLeftPanelWidth(420);
    useEditorUiStore.getState().setRightPanelCollapsed(true);
    // Reset state to defaults, then hydrate from the persisted blob.
    useEditorUiStore.setState({ ...useEditorUiStore.getState(), ...defaultPanelState() });
    expect(useEditorUiStore.getState().leftPanelWidth).toBe(320);
    useEditorUiStore.getState().hydratePanelPrefs();
    expect(useEditorUiStore.getState().leftPanelWidth).toBe(420);
    expect(useEditorUiStore.getState().rightPanelCollapsed).toBe(true);
  });

  it("hydrating with no stored prefs keeps defaults", () => {
    clearEditorUIPrefs();
    useEditorUiStore.getState().hydratePanelPrefs();
    expect(useEditorUiStore.getState().leftPanelWidth).toBe(320);
    expect(useEditorUiStore.getState().rightPanelCollapsed).toBe(false);
  });
});
