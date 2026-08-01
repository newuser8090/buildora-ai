// ---------------------------------------------------------------------------
// ProjectCard — thumbnail UI tests
//
// Covers the card preview surface states:
//   - missing/error without URL → deterministic gradient placeholder
//   - loading → subtle skeleton over the gradient
//   - ready/stale/error-with-URL → real thumbnail image with alt text
//   - image decode failure → placeholder fallback
//   - Regenerate Preview menu action + busy state + disabled repeat
//   - thumbnail does not intercept card open or menu actions
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectCard } from "../components/ProjectCard";

function makeProject(overrides: Record<string, unknown> = {}) {
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
    thumbnailUrl: null,
    thumbnailStatus: "missing",
    thumbnailRevision: null,
    ...overrides,
  } as Parameters<typeof ProjectCard>[0]["project"];
}

function renderCard(overrides: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  const mocks = {
    onOpen: vi.fn(),
    onRename: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onTogglePin: vi.fn(),
    onRegeneratePreview: vi.fn(),
  };
  const utils = render(
    <ProjectCard
      project={makeProject(overrides)}
      activeProjectId="other-proj"
      operation={null}
      onOpen={mocks.onOpen}
      onRename={mocks.onRename}
      onDuplicate={mocks.onDuplicate}
      onDelete={mocks.onDelete}
      onTogglePin={mocks.onTogglePin}
      onRegeneratePreview={mocks.onRegeneratePreview}
      {...props}
    />,
  );
  return {
    ...utils,
    ...mocks,
    rerenderWith(overrides2: Record<string, unknown> = {}) {
      return utils.rerender(
        <ProjectCard
          project={makeProject({ ...overrides, ...overrides2 })}
          activeProjectId="other-proj"
          operation={null}
          onOpen={mocks.onOpen}
          onRename={mocks.onRename}
          onDuplicate={mocks.onDuplicate}
          onDelete={mocks.onDelete}
          onTogglePin={mocks.onTogglePin}
          onRegeneratePreview={mocks.onRegeneratePreview}
          {...props}
        />,
      );
    },
  };
}

describe("ProjectCard thumbnail states", () => {
  it("shows the gradient placeholder when missing (no thumbnail)", () => {
    renderCard({ thumbnailStatus: "missing", thumbnailUrl: null });
    expect(screen.queryByTestId("project-thumbnail")).toBeNull();
    expect(screen.queryByTestId("thumbnail-skeleton")).toBeNull();
    // Placeholder icon still rendered (no image shown).
    expect(screen.getByRole("button", { name: /open project/i })).toBeTruthy();
  });

  it("shows a loading skeleton over the gradient while loading", () => {
    renderCard({ thumbnailStatus: "loading", thumbnailUrl: null });
    expect(screen.getByTestId("thumbnail-skeleton")).toBeTruthy();
    expect(screen.queryByTestId("project-thumbnail")).toBeNull();
  });

  it("renders the real thumbnail image with accessible alt text when ready", () => {
    renderCard({ thumbnailStatus: "ready", thumbnailUrl: "blob:mock-1", thumbnailRevision: 2 });
    const img = screen.getByTestId("project-thumbnail");
    expect(img).toBeTruthy();
    expect(img.getAttribute("alt")).toBe("Preview of Test Project");
  });

  it("keeps the real thumbnail visible when stale (regeneration queued)", () => {
    renderCard({ thumbnailStatus: "stale", thumbnailUrl: "blob:mock-1" });
    expect(screen.getByTestId("project-thumbnail")).toBeTruthy();
    expect(screen.queryByTestId("thumbnail-skeleton")).toBeNull();
  });

  it("keeps the existing thumbnail when status is error but a URL exists", () => {
    renderCard({ thumbnailStatus: "error", thumbnailUrl: "blob:mock-1" });
    expect(screen.getByTestId("project-thumbnail")).toBeTruthy();
  });

  it("falls back to the gradient placeholder when status is error with no URL", () => {
    renderCard({ thumbnailStatus: "error", thumbnailUrl: null });
    expect(screen.queryByTestId("project-thumbnail")).toBeNull();
  });

  it("falls back to the placeholder when the image fails to decode", () => {
    renderCard({ thumbnailStatus: "ready", thumbnailUrl: "blob:mock-1" });
    const img = screen.getByTestId("project-thumbnail");
    fireEvent.error(img);
    // After decode failure the image is removed → placeholder shown.
    expect(screen.queryByTestId("project-thumbnail")).toBeNull();
  });

  it("re-shows the thumbnail when the URL changes after a decode failure", () => {
    const { rerenderWith } = renderCard({
      thumbnailStatus: "ready",
      thumbnailUrl: "blob:mock-1",
    });
    fireEvent.error(screen.getByTestId("project-thumbnail"));
    expect(screen.queryByTestId("project-thumbnail")).toBeNull();

    // A new URL (regenerated thumbnail) resets the failed-image flag.
    rerenderWith({ thumbnailUrl: "blob:mock-2" });
    expect(screen.getByTestId("project-thumbnail")).toBeTruthy();
  });

  it("thumbnail image does not intercept card open (pointer-events-none)", () => {
    renderCard({ thumbnailStatus: "ready", thumbnailUrl: "blob:mock-1" });
    const img = screen.getByTestId("project-thumbnail");
    expect(img.className).toContain("pointer-events-none");
  });
});

describe("ProjectCard Regenerate Preview", () => {
  it("menu exposes Regenerate Preview action", () => {
    const { onRegeneratePreview } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /menu for/i }));
    fireEvent.click(screen.getByText("Regenerate Preview"));
    expect(onRegeneratePreview).toHaveBeenCalledWith("proj-1");
  });

  it("Regenerate Preview does not trigger card open", () => {
    const { onOpen, onRegeneratePreview } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /menu for/i }));
    fireEvent.click(screen.getByText("Regenerate Preview"));
    expect(onOpen).not.toHaveBeenCalled();
    expect(onRegeneratePreview).toHaveBeenCalledTimes(1);
  });

  it("shows a busy badge while regenerating and disables the menu item", () => {
    renderCard({}, { isRegeneratingPreview: true });
    fireEvent.click(screen.getByRole("button", { name: /menu for/i }));
    const item = screen.getByRole("menuitem", { name: /regenerating/i });
    expect(item).toBeTruthy();
    expect((item as HTMLButtonElement).disabled).toBe(true);
  });

  it("busy badge is announced via text, not color alone", () => {
    renderCard({}, { isRegeneratingPreview: true });
    // The badge shows literal text "Regenerating" for screen readers.
    expect(screen.getByText("Regenerating")).toBeTruthy();
  });

  it("regenerate menu action does not block other menu actions", () => {
    const { onOpen } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /menu for/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Open$/ }));
    expect(onOpen).toHaveBeenCalledWith("proj-1");
  });
});

describe("ProjectCard menu + thumbnail interplay", () => {
  it("menu button remains usable when a thumbnail is displayed", () => {
    renderCard({ thumbnailStatus: "ready", thumbnailUrl: "blob:mock-1" });
    fireEvent.click(screen.getByRole("button", { name: /menu for/i }));
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("pin and active overlays remain visible over a thumbnail", () => {
    renderCard(
      {
        thumbnailStatus: "ready",
        thumbnailUrl: "blob:mock-1",
        isPinned: true,
        id: "active-proj",
      },
      { activeProjectId: "active-proj" },
    );
    expect(screen.getByText("Active")).toBeTruthy();
  });

  it("ProjectSummary data carries no Blob (thumbnail is runtime-only)", () => {
    const project = makeProject({ thumbnailStatus: "ready", thumbnailUrl: "blob:mock-1" });
    expect("data" in project).toBe(false);
    expect(project.thumbnailUrl).toBe("blob:mock-1");
  });
});
