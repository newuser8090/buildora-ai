// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// StyleNotesSection — Phase P11 component tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StyleNotesSection } from "../StyleNotesSection";
import { COPILOT_MEMORY_LIMITS } from "../../constants";

function renderSection(overrides: {
  notes?: string[];
  onAdd?: (n: string) => void;
  onRemove?: (n: string) => void;
  onClearAll?: () => void;
} = {}) {
  const handlers = {
    onAdd: overrides.onAdd ?? vi.fn(),
    onRemove: overrides.onRemove ?? vi.fn(),
    onClearAll: overrides.onClearAll ?? vi.fn(),
  };
  render(
    <StyleNotesSection
      notes={overrides.notes ?? []}
      onAdd={handlers.onAdd}
      onRemove={handlers.onRemove}
      onClearAll={handlers.onClearAll}
    />,
  );
  return handlers;
}

describe("StyleNotesSection", () => {
  it("renders the input with a label and helper copy in the empty state", () => {
    renderSection();
    expect(screen.getByLabelText("Add a style note")).toBeTruthy();
    expect(screen.getByText(/Remember my style/i)).toBeTruthy();
    expect(screen.getByText(/Saved on your device only/i)).toBeTruthy();
  });

  it("adds a note on submit", async () => {
    const onAdd = vi.fn();
    renderSection({ onAdd });
    const input = screen.getByLabelText("Add a style note");
    await userEvent.type(input, "keep it friendly");
    fireEvent.click(screen.getByTestId("style-note-add"));
    expect(onAdd).toHaveBeenCalledWith("keep it friendly");
  });

  it("adds a note on Enter", async () => {
    const onAdd = vi.fn();
    renderSection({ onAdd });
    const input = screen.getByLabelText("Add a style note");
    await userEvent.type(input, "keep it friendly{enter}");
    expect(onAdd).toHaveBeenCalledWith("keep it friendly");
  });

  it("does not add an empty note", async () => {
    const onAdd = vi.fn();
    renderSection({ onAdd });
    const input = screen.getByLabelText("Add a style note");
    await userEvent.type(input, "   {enter}");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("renders chips with remove buttons in the populated state", () => {
    const onRemove = vi.fn();
    renderSection({ notes: ["keep it friendly", "use British spelling"], onRemove });
    const chips = screen.getAllByTestId("style-note-chip");
    expect(chips).toHaveLength(2);
    fireEvent.click(screen.getAllByTestId("style-note-remove")[0]);
    expect(onRemove).toHaveBeenCalledWith("keep it friendly");
  });

  it("clears all notes", () => {
    const onClearAll = vi.fn();
    renderSection({ notes: ["a", "b"], onClearAll });
    fireEvent.click(screen.getByTestId("style-note-clear-all"));
    expect(onClearAll).toHaveBeenCalled();
  });

  it("shows the count and hides the input at the cap", () => {
    const notes = Array.from(
      { length: COPILOT_MEMORY_LIMITS.maxStyleNotes },
      (_, i) => `note ${i}`,
    );
    renderSection({ notes });
    expect(screen.getByText(new RegExp(`${notes.length}/${COPILOT_MEMORY_LIMITS.maxStyleNotes}`))).toBeTruthy();
    expect(screen.queryByLabelText("Add a style note")).toBeNull();
  });

  it("caps the input length attribute to the note bound", () => {
    renderSection();
    const input = screen.getByLabelText("Add a style note");
    expect(input.getAttribute("maxlength")).toBe(
      String(COPILOT_MEMORY_LIMITS.maxStyleNoteLength),
    );
  });
});
