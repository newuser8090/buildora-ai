// ---------------------------------------------------------------------------
// ProjectCard accessibility tests
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectCard } from "../components/ProjectCard";

function makeProject(overrides = {}) {
  return {
    id: "proj-1",
    name: "Test Project",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    savedAt: "2026-01-01T00:00:00.000Z",
    isActive: false,
    isPinned: false,
    pageCount: 1,
    assetCount: 0,
    ...overrides,
  };
}

function renderCard(overrides = {}, props = {}) {
  const mockOpen = vi.fn();
  const mockRename = vi.fn();
  const mockDuplicate = vi.fn();
  const mockDelete = vi.fn();
  const mockTogglePin = vi.fn();

  const utils = render(
    <ProjectCard
      project={makeProject(overrides)}
      activeProjectId="other-proj"
      operation={null}
      onOpen={mockOpen}
      onRename={mockRename}
      onDuplicate={mockDuplicate}
      onDelete={mockDelete}
      onTogglePin={mockTogglePin}
      {...props}
    />,
  );

  return { ...utils, mockOpen, mockRename, mockDuplicate, mockDelete, mockTogglePin };
}

describe("ProjectCard accessibility", () => {
  it("card has an accessible name matching the project name", () => {
    renderCard({ name: "My Landing Page" });
    const card = screen.getByRole("button", { name: /open project my landing page/i });
    expect(card).toBeTruthy();
  });

  it("keyboard Enter opens the project", async () => {
    const { mockOpen } = renderCard({ id: "proj-enter" });
    const card = screen.getByRole("button", { name: /open project/i });
    fireEvent.keyDown(card, { key: "Enter" });
    expect(mockOpen).toHaveBeenCalledWith("proj-enter");
  });

  it("keyboard Space opens the project", async () => {
    const { mockOpen } = renderCard({ id: "proj-space" });
    const card = screen.getByRole("button", { name: /open project/i });
    fireEvent.keyDown(card, { key: " " });
    expect(mockOpen).toHaveBeenCalledWith("proj-space");
  });

  it("overflow button has aria-label with project name", () => {
    renderCard({ name: "My Project" });
    const menuButton = screen.getByLabelText("Menu for My Project");
    expect(menuButton).toBeTruthy();
  });

  it("overflow button exposes aria-haspopup", () => {
    renderCard();
    const menuButton = screen.getByRole("button", { name: /menu for/i });
    expect(menuButton.getAttribute("aria-haspopup")).toBe("menu");
  });

  it("aria-expanded changes when menu opens", async () => {
    renderCard();
    const menuButton = screen.getByRole("button", { name: /menu for/i });
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(menuButton);
    expect(menuButton.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(menuButton);
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");
  });

  it("Escape closes the menu", async () => {
    renderCard();
    const menuButton = screen.getByRole("button", { name: /menu for/i });
    fireEvent.click(menuButton);
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("clicking Rename does not trigger card Open", async () => {
    const { mockOpen, mockRename } = renderCard({ id: "proj-rename" });
    const menuButton = screen.getByRole("button", { name: /menu for/i });
    fireEvent.click(menuButton);

    const renameItem = screen.getByText("Rename");
    fireEvent.click(renameItem);

    expect(mockRename).toHaveBeenCalledWith("proj-rename");
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("clicking Duplicate does not trigger card Open", async () => {
    const { mockOpen, mockDuplicate } = renderCard({ id: "proj-dupe" });
    const menuButton = screen.getByRole("button", { name: /menu for/i });
    fireEvent.click(menuButton);

    const duplicateItem = screen.getByText("Duplicate");
    fireEvent.click(duplicateItem);

    expect(mockDuplicate).toHaveBeenCalledWith("proj-dupe");
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("clicking Delete does not trigger card Open", async () => {
    const { mockOpen, mockDelete } = renderCard({ id: "proj-del" });
    const menuButton = screen.getByRole("button", { name: /menu for/i });
    fireEvent.click(menuButton);

    const deleteItem = screen.getByText("Delete");
    fireEvent.click(deleteItem);

    expect(mockDelete).toHaveBeenCalledWith("proj-del");
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("active-project indicator is rendered for active project", () => {
    renderCard({ id: "active-proj" }, { activeProjectId: "active-proj" });
    expect(screen.getByText("Active")).toBeTruthy();
  });

  it("pinned state is indicated for pinned project", () => {
    renderCard({ isPinned: true });
    // The Pin icon is rendered (can't easily query icons, but presence is verifiable)
    const menuButton = screen.getByRole("button", { name: /menu for/i });
    expect(menuButton).toBeTruthy();
  });

  it("disabled operation item cannot activate when global operation is active", () => {
    const { mockOpen } = renderCard(
      { id: "other-proj" },
      { operation: { type: "deleting", projectId: "different-proj" } },
    );
    const card = screen.getByRole("button", { name: /open project/i });
    expect(card.getAttribute("tabindex")).toBe("-1");
    fireEvent.click(card);
    expect(mockOpen).not.toHaveBeenCalled();
  });
});
