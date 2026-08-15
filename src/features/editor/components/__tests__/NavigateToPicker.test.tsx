// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// NavigateToPicker — component tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NavigateToPicker } from "../NavigateToPicker";
import type { Page } from "@/types/project";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    id: "page-1",
    title: "Home",
    slug: "/",
    sections: [
      { id: "hero-1", type: "hero", order: 1, visible: true, props: {}, styles: {} },
    ],
    ...overrides,
  };
}

function makePages(): Page[] {
  return [
    makePage(),
    makePage({ id: "page-2", title: "About", slug: "/about" }),
    makePage({ id: "page-3", title: "Contact", slug: "/contact" }),
  ];
}

function renderPicker(props?: Partial<React.ComponentProps<typeof NavigateToPicker>>) {
  const onChange = vi.fn();
  const utils = render(
    <NavigateToPicker
      pages={makePages()}
      value="/"
      onChange={onChange}
      {...props}
    />,
  );
  return { ...utils, onChange };
}

function openMenu() {
  fireEvent.click(screen.getByTestId("navigate-to-picker"));
}

// ---------------------------------------------------------------------------
// Rendering / menu
// ---------------------------------------------------------------------------

describe("NavigateToPicker", () => {
  it("renders a trigger button that opens a page menu", () => {
    const { onChange } = renderPicker();
    expect(screen.getByTestId("navigate-to-picker")).toBeTruthy();
    expect(screen.queryByTestId("navigate-to-menu")).toBeNull();

    openMenu();
    expect(screen.getByTestId("navigate-to-menu")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("lists every project page with its route", () => {
    renderPicker();
    openMenu();
    expect(screen.getByText("Home")).toBeTruthy();
    expect(screen.getByText("/")).toBeTruthy();
    expect(screen.getByText("About")).toBeTruthy();
    expect(screen.getByText("/about")).toBeTruthy();
    expect(screen.getByText("Contact")).toBeTruthy();
    expect(screen.getByText("/contact")).toBeTruthy();
  });

  it("highlights the page matching the current href", () => {
    renderPicker({ value: "/about" });
    openMenu();
    const aboutItem = screen.getByTestId("navigate-to-page-page-2");
    expect(aboutItem.getAttribute("aria-current")).toBe("true");
    const homeItem = screen.getByTestId("navigate-to-page-page-1");
    expect(homeItem.getAttribute("aria-current")).toBeNull();
  });

  it("highlights the homepage when the value is the root route", () => {
    renderPicker({ value: "/" });
    openMenu();
    const homeItem = screen.getByTestId("navigate-to-page-page-1");
    expect(homeItem.getAttribute("aria-current")).toBe("true");
  });

  it("does not highlight anything for unknown/external hrefs", () => {
    renderPicker({ value: "https://example.com" });
    openMenu();
    for (const id of ["page-1", "page-2", "page-3"]) {
      expect(
        screen.getByTestId(`navigate-to-page-${id}`).getAttribute("aria-current"),
      ).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

describe("NavigateToPicker selection", () => {
  it("writes the resolved href for the chosen page", () => {
    const { onChange } = renderPicker();
    openMenu();
    fireEvent.click(screen.getByTestId("navigate-to-page-page-2"));
    expect(onChange).toHaveBeenCalledWith("/about");
    // The menu closes after selection.
    expect(screen.queryByTestId("navigate-to-menu")).toBeNull();
  });

  it("writes the root href for the homepage", () => {
    const { onChange } = renderPicker();
    openMenu();
    fireEvent.click(screen.getByTestId("navigate-to-page-page-1"));
    expect(onChange).toHaveBeenCalledWith("/");
  });

  it("resolves the homepage route even when the page slug differs", () => {
    const { onChange } = renderPicker({
      pages: [
        makePage({ id: "home", slug: "/landing" }),
        makePage({ id: "page-2", title: "About", slug: "/about" }),
      ],
    });
    openMenu();
    fireEvent.click(screen.getByTestId("navigate-to-page-home"));
    // computePageRoutes maps pages[0] to the root route regardless of slug.
    expect(onChange).toHaveBeenCalledWith("/");
  });

  it("handles nested route targets", () => {
    const { onChange } = renderPicker({
      pages: [
        makePage(),
        makePage({ id: "blog", title: "Blog", slug: "/blog/post" }),
      ],
    });
    openMenu();
    fireEvent.click(screen.getByTestId("navigate-to-page-blog"));
    expect(onChange).toHaveBeenCalledWith("/blog/post");
  });
});

// ---------------------------------------------------------------------------
// Keyboard / dismissal
// ---------------------------------------------------------------------------

describe("NavigateToPicker dismissal", () => {
  it("closes on Escape", () => {
    renderPicker();
    openMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("navigate-to-menu")).toBeNull();
  });

  it("closes on outside click", () => {
    renderPicker();
    openMenu();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("navigate-to-menu")).toBeNull();
  });

  it("respects the disabled prop", () => {
    renderPicker({ disabled: true });
    openMenu();
    expect(screen.queryByTestId("navigate-to-menu")).toBeNull();
  });
});
