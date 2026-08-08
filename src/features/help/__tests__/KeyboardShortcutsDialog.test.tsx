// ---------------------------------------------------------------------------
// Help (Phase P9) — KeyboardShortcutsDialog tests
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { KeyboardShortcutsDialog } from "../components/KeyboardShortcutsDialog";
import { SHORTCUT_GROUPS } from "../keyboard-shortcuts";

describe("KeyboardShortcutsDialog", () => {
  beforeEach(() => cleanup());

  it("renders every real shortcut group", () => {
    render(<KeyboardShortcutsDialog open onClose={() => {}} />);
    for (const group of SHORTCUT_GROUPS) {
      expect(screen.getByText(group.title)).toBeTruthy();
    }
    expect(screen.getByText("Ctrl/⌘ + Z")).toBeTruthy();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsDialog open onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing when closed", () => {
    render(<KeyboardShortcutsDialog open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
