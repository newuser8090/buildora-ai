// ---------------------------------------------------------------------------
// Private Shared Libraries (Phase P6) — CreateSharedLibraryDialog tests
//
// Beginner language ("Share a private box of saved pieces."), name
// validation, and a safe, structured message when cloud backup is not
// configured (local-only mode stays fully functional).
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CreateSharedLibraryDialog } from "../components/CreateSharedLibraryDialog";
import { useSharedLibrariesUiStore } from "../store/shared-libraries-ui-store";

function openDialog() {
  useSharedLibrariesUiStore.setState({ createOpen: true });
}

describe("CreateSharedLibraryDialog", () => {
  beforeEach(() => {
    useSharedLibrariesUiStore.setState({ createOpen: false, panelOpen: false });
  });

  it("renders nothing when closed", () => {
    const { container } = render(<CreateSharedLibraryDialog onCreated={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("uses beginner language for private shared libraries", () => {
    openDialog();
    render(<CreateSharedLibraryDialog onCreated={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "New shared library" })).toBeTruthy();
    expect(screen.getByText("Share a private box of saved pieces. Only people you invite can see it.")).toBeTruthy();
  });

  it("requires a name before creating", () => {
    openDialog();
    render(<CreateSharedLibraryDialog onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Create library" }));
    expect(screen.getByText("Give your shared library a name.")).toBeTruthy();
  });

  it("explains clearly when cloud backup isn't configured (local-only mode)", () => {
    openDialog();
    render(<CreateSharedLibraryDialog onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Hero sections" } });
    fireEvent.click(screen.getByRole("button", { name: "Create library" }));
    // Environment unavailable → safe, structured message (no crash, no fake success).
    expect(
      screen.getByText("Cloud backup isn't configured for this app yet."),
    ).toBeTruthy();
  });

  it("does not close or report success when the provider is unavailable", () => {
    const onCreated = vi.fn();
    openDialog();
    render(<CreateSharedLibraryDialog onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Hero sections" } });
    fireEvent.click(screen.getByRole("button", { name: "Create library" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
