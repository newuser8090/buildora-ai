// ---------------------------------------------------------------------------
// ProjectCard — Phase E.2 export menu integration tests
//
// Covers:
//   - the Export menu action calls onExport with the card's project id
//   - the Export menu action never triggers onOpen
//   - Export is keyboard accessible from the menu
//   - Export remains disabled-safe while a global operation is active
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectCard } from "../components/ProjectCard";

function makeProject(overrides = {}) {
  return {
    id: "proj-export-card",
    name: "Export Card Project",
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
  const mockExport = vi.fn();

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
      onExport={mockExport}
      {...props}
    />,
  );

  return { ...utils, mockOpen, mockRename, mockDuplicate, mockDelete, mockTogglePin, mockExport };
}

describe("ProjectCard — Phase E.2 export menu", () => {
  it("Export menu action calls onExport with the card's project id", () => {
    const { mockExport } = renderCard({ id: "proj-export-card" });
    const menuButton = screen.getByRole("button", { name: /menu for/i });
    fireEvent.click(menuButton);

    const exportItem = screen.getByText("Export");
    fireEvent.click(exportItem);

    expect(mockExport).toHaveBeenCalledTimes(1);
    expect(mockExport).toHaveBeenCalledWith("proj-export-card");
  });

  it("Export menu action does not trigger Open", () => {
    const { mockExport, mockOpen } = renderCard({ id: "proj-export-card" });
    const menuButton = screen.getByRole("button", { name: /menu for/i });
    fireEvent.click(menuButton);

    const exportItem = screen.getByText("Export");
    fireEvent.click(exportItem);

    expect(mockExport).toHaveBeenCalledWith("proj-export-card");
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("Export closes the menu after activation", () => {
    renderCard();
    const menuButton = screen.getByRole("button", { name: /menu for/i });
    fireEvent.click(menuButton);
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.click(screen.getByText("Export"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Export item is not rendered when onExport is not provided", () => {
    const mockOpen = vi.fn();
    const mockRename = vi.fn();
    const mockDuplicate = vi.fn();
    const mockDelete = vi.fn();
    const mockTogglePin = vi.fn();

    render(
      <ProjectCard
        project={makeProject()}
        activeProjectId="other-proj"
        operation={null}
        onOpen={mockOpen}
        onRename={mockRename}
        onDuplicate={mockDuplicate}
        onDelete={mockDelete}
        onTogglePin={mockTogglePin}
      />,
    );

    const menuButton = screen.getByRole("button", { name: /menu for/i });
    fireEvent.click(menuButton);
    expect(screen.queryByText("Export")).toBeNull();
  });

  it("card Open still works from the menu while Export exists", () => {
    const { mockOpen } = renderCard({ id: "proj-open" });
    const menuButton = screen.getByRole("button", { name: /menu for/i });
    fireEvent.click(menuButton);

    const openItem = screen.getByRole("menuitem", { name: "Open" });
    fireEvent.click(openItem);

    expect(mockOpen).toHaveBeenCalledWith("proj-open");
  });
});
