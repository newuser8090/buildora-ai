// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Phase P22-G — NavTargetPicker (full typed NavTarget authoring)
//   - authors page / section / external / email / phone / back targets
//   - resolves destinations safely through the shared NavTarget model
//   - unsafe external URLs are flagged and never trusted
//   - clear emits the caller's clear path
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NavTargetPicker } from "../NavigateToPicker";
import type { Page } from "@/types/project";

function makePages(): Page[] {
  return [
    {
      id: "page-1",
      title: "Home",
      slug: "/",
      sections: [{ id: "hero-1", type: "hero", order: 1, visible: true, props: {}, styles: {} }],
    },
    {
      id: "page-2",
      title: "About",
      slug: "/about",
      sections: [{ id: "team-1", type: "features", order: 1, visible: true, props: {}, styles: {} }],
    },
  ];
}

function renderPicker(props?: Partial<React.ComponentProps<typeof NavTargetPicker>>) {
  const onChange = vi.fn();
  const onClear = vi.fn();
  const utils = render(
    <NavTargetPicker
      pages={makePages()}
      value={null}
      onChange={onChange}
      onClear={onClear}
      {...props}
    />,
  );
  return { ...utils, onChange, onClear };
}

describe("NavTargetPicker — target kinds", () => {
  it("defaults to the page kind and lists project pages", () => {
    renderPicker({ value: { kind: "page", pageId: "page-1" } });
    expect(screen.getByTestId("nav-target-picker")).toBeTruthy();
    expect(screen.getByTestId("nav-target-kind")).toBeTruthy();
    const pageSelect = screen.getByTestId("nav-target-page") as HTMLSelectElement;
    expect(pageSelect.options.length).toBe(2);
  });

  it("switching kinds emits a complete typed target", () => {
    const { onChange } = renderPicker();
    fireEvent.change(screen.getByTestId("nav-target-kind"), { target: { value: "back" } });
    expect(onChange).toHaveBeenCalledWith({ kind: "back" });

    fireEvent.change(screen.getByTestId("nav-target-kind"), { target: { value: "email" } });
    expect(onChange).toHaveBeenCalledWith({ kind: "email", to: "" });
  });

  it("authors page targets with pageId", () => {
    const { onChange } = renderPicker({ value: { kind: "page", pageId: "page-1" } });
    fireEvent.change(screen.getByTestId("nav-target-page"), { target: { value: "page-2" } });
    expect(onChange).toHaveBeenCalledWith({ kind: "page", pageId: "page-2" });
  });

  it("authors section targets with page + section id", () => {
    const { onChange } = renderPicker({ value: { kind: "section", pageId: "page-2", sectionId: "team-1" } });
    fireEvent.change(screen.getByTestId("nav-target-section"), { target: { value: "hero-1" } });
    expect(onChange).toHaveBeenCalledWith({
      kind: "section",
      pageId: "page-1",
      sectionId: "hero-1",
    });
  });

  it("authors external / email / phone targets", () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    const { rerender } = render(
      <NavTargetPicker pages={makePages()} value={null} onChange={onChange} onClear={onClear} />,
    );

    // Switch to external; the emitted default keeps the config visible.
    fireEvent.change(screen.getByTestId("nav-target-kind"), { target: { value: "external" } });
    expect(onChange).toHaveBeenCalledWith({ kind: "external", url: "https://" });

    rerender(
      <NavTargetPicker
        pages={makePages()}
        value={{ kind: "external", url: "https://" }}
        onChange={onChange}
      />,
    );
    const url = screen.getByTestId("nav-target-url");
    fireEvent.change(url, { target: { value: "https://example.com" } });
    expect(onChange).toHaveBeenCalledWith({ kind: "external", url: "https://example.com" });

    // Switch to phone.
    rerender(
      <NavTargetPicker
        pages={makePages()}
        value={{ kind: "external", url: "https://example.com" }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("nav-target-kind"), { target: { value: "phone" } });
    expect(onChange).toHaveBeenCalledWith({ kind: "phone", number: "" });

    rerender(
      <NavTargetPicker
        pages={makePages()}
        value={{ kind: "phone", number: "" }}
        onChange={onChange}
      />,
    );
    const phone = screen.getByTestId("nav-target-phone");
    fireEvent.change(phone, { target: { value: "+1 555 0100" } });
    expect(onChange).toHaveBeenCalledWith({ kind: "phone", number: "+1 555 0100" });
  });
});

describe("NavTargetPicker — safe resolution", () => {
  it("shows the resolved href for a page target", () => {
    renderPicker({ value: { kind: "page", pageId: "page-2" } });
    expect(screen.getByTestId("nav-target-href").textContent).toContain("/about");
  });

  it("flags unsafe external URLs", () => {
    renderPicker({ value: { kind: "external", url: "javascript:alert(1)" } });
    expect(screen.getByTestId("nav-target-href").textContent).toContain("unsafe URL");
  });

  it("does not flag safe external URLs", () => {
    renderPicker({ value: { kind: "external", url: "https://example.com" } });
    expect(screen.getByTestId("nav-target-href").textContent).not.toContain("unsafe");
  });

  it("clear calls the caller's clear path", () => {
    const { onClear } = renderPicker({ value: { kind: "page", pageId: "page-1" } });
    fireEvent.click(screen.getByTestId("nav-target-clear"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
