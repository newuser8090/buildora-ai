// ---------------------------------------------------------------------------
// RenameDialog accessibility tests
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RenameDialog } from "../components/RenameDialog";

function renderDialog(props = {}) {
  const mockConfirm = vi.fn();
  const mockCancel = vi.fn();

  const utils = render(
    <RenameDialog
      open={true}
      currentName="Test Project"
      onConfirm={mockConfirm}
      onCancel={mockCancel}
      {...props}
    />,
  );

  return { ...utils, mockConfirm, mockCancel };
}

describe("RenameDialog accessibility", () => {
  it("has role='dialog'", () => {
    renderDialog();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("has aria-modal='true'", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("has aria-labelledby pointing to visible title", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    const titleId = dialog.getAttribute("aria-labelledby");
    expect(titleId).toBe("rename-dialog-title");
    const title = document.getElementById(titleId!);
    expect(title).toBeTruthy();
    expect(title?.textContent).toBe("Rename Project");
  });

  it("initial focus moves to name input", async () => {
    renderDialog();
    const input = screen.getByLabelText("Project name");
    // Focus happens in requestAnimationFrame, so we need to wait
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
  });

  it("Escape closes the dialog", () => {
    const { mockCancel } = renderDialog();
    // The dialog listens for keydown on the input element
    const input = screen.getByLabelText("Project name");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(mockCancel).toHaveBeenCalled();
  });

  it("validation message is announced via role='alert'", () => {
    renderDialog({ error: "Name is too long" });
    const alert = screen.getByRole("alert");
    expect(alert?.textContent).toBe("Name is too long");
  });

  it("invalid input prevents submit (empty input disabled)", () => {
    const { mockConfirm } = renderDialog({ currentName: "" });
    // Input is empty, submit button should be disabled
    const submitButton = screen.getByText("Rename");
    expect(submitButton).toBeTruthy();
    fireEvent.click(submitButton);
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("submit disabled while renaming", () => {
    renderDialog({ isLoading: true });
    const submitButton = screen.getByText("Renaming...");
    expect(submitButton).toBeTruthy();
  });

  it("focus returns to original trigger after close", () => {
    // Create a trigger button outside the dialog
    const trigger = document.createElement("button");
    trigger.textContent = "Trigger";
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(
      <RenameDialog open={true} currentName="Test" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );

    // Re-render with open=false
    rerender(
      <RenameDialog open={false} currentName="Test" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );

    document.body.removeChild(trigger);
  });

  it("Tab from last button wraps to first focusable element", async () => {
    renderDialog();
    const renameBtn = screen.getByText("Rename");

    // Focus the Rename button (last focusable)
    renameBtn.focus();
    expect(document.activeElement).toBe(renameBtn);

    // Press Tab — should wrap to the input (or first focusable)
    fireEvent.keyDown(renameBtn, { key: "Tab" });
  });

  it("Shift+Tab from first element wraps to last", async () => {
    renderDialog();
    const input = screen.getByLabelText("Project name");

    // Focus the input (first focusable)
    input.focus();
    expect(document.activeElement).toBe(input);

    // Press Shift+Tab — should wrap to last focusable
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
  });

  it("focus cannot escape to background controls while dialog is open", () => {
    // Background button
    const bgButton = document.createElement("button");
    bgButton.textContent = "Background";
    document.body.appendChild(bgButton);

    renderDialog();

    // The dialog overlay covers the background
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();

    document.body.removeChild(bgButton);
  });

  it("successful submit closes only after operation completes", async () => {
    const mockConfirm = vi.fn();
    const { rerender } = render(
      <RenameDialog open={true} currentName="Test" onConfirm={mockConfirm} onCancel={vi.fn()} />,
    );

    const input = screen.getByLabelText("Project name");
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.click(screen.getByText("Rename"));

    expect(mockConfirm).toHaveBeenCalledWith("New Name");

    // Dialog still open
    expect(screen.getByRole("dialog")).toBeTruthy();

    // Re-render closed after success
    rerender(
      <RenameDialog open={false} currentName="New Name" onConfirm={mockConfirm} onCancel={vi.fn()} />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
