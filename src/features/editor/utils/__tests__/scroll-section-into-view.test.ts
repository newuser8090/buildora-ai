// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// scroll-section-into-view — tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  findSectionElement,
  scrollSectionIntoView,
  scrollStructureRowIntoView,
} from "../scroll-section-into-view";

function makeElement(id: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-section-id", id);
  return el;
}

describe("findSectionElement", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("finds a section element by data attribute", () => {
    const el = makeElement("hero-1");
    document.body.appendChild(el);
    expect(findSectionElement("hero-1")).toBe(el);
  });

  it("searches within a provided container", () => {
    const container = document.createElement("div");
    const el = makeElement("hero-1");
    container.appendChild(el);
    document.body.appendChild(container);
    const outside = makeElement("hero-2");
    document.body.appendChild(outside);
    expect(findSectionElement("hero-1", container)).toBe(el);
    expect(findSectionElement("hero-2", container)).toBeNull();
  });

  it("returns null when missing", () => {
    expect(findSectionElement("nope")).toBeNull();
  });
});

describe("scrollSectionIntoView", () => {
  let scrollCalls: { behavior: ScrollBehavior; block: ScrollLogicalPosition }[];

  beforeEach(() => {
    document.body.innerHTML = "";
    scrollCalls = [];
    Element.prototype.scrollIntoView = vi.fn(function (
      this: Element,
      options?: ScrollIntoViewOptions,
    ) {
      scrollCalls.push({
        behavior: (options?.behavior as ScrollBehavior) ?? "auto",
        block: (options?.block as ScrollLogicalPosition) ?? "start",
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scrolls the element into view with smooth behavior by default", () => {
    const el = makeElement("hero-1");
    document.body.appendChild(el);
    const result = scrollSectionIntoView("hero-1", { reducedMotion: false });
    expect(result).toBe(true);
    expect(scrollCalls).toHaveLength(1);
    expect(scrollCalls[0].behavior).toBe("smooth");
  });

  it("uses auto behavior when reduced motion is preferred", () => {
    const el = makeElement("hero-1");
    document.body.appendChild(el);
    scrollSectionIntoView("hero-1", { reducedMotion: true });
    expect(scrollCalls[0].behavior).toBe("auto");
  });

  it("returns false and does not throw when the element is missing", () => {
    expect(() => scrollSectionIntoView("nope")).not.toThrow();
    expect(scrollSectionIntoView("nope")).toBe(false);
    expect(scrollCalls).toHaveLength(0);
  });

  it("respects an explicit block option", () => {
    const el = makeElement("hero-1");
    document.body.appendChild(el);
    scrollSectionIntoView("hero-1", { block: "center", reducedMotion: false });
    expect(scrollCalls[0].block).toBe("center");
  });
});

describe("scrollStructureRowIntoView", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scrolls a row within the container", () => {
    const container = document.createElement("div");
    const row = document.createElement("div");
    row.setAttribute("data-structure-row-id", "hero-1");
    container.appendChild(row);
    document.body.appendChild(container);
    expect(scrollStructureRowIntoView("hero-1", container)).toBe(true);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("returns false when the container is null", () => {
    expect(scrollStructureRowIntoView("hero-1", null)).toBe(false);
  });

  it("returns false when the row is missing", () => {
    const container = document.createElement("div");
    expect(scrollStructureRowIntoView("nope", container)).toBe(false);
  });
});
