// ---------------------------------------------------------------------------
// Block converter tests (Phase P2)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";

import {
  isButtonLikeClass,
  isFormControlTag,
  isInlineCarrierTag,
  isLeafEmittingTag,
  mapElementToLeafBlock,
} from "../block-converter";
import { el } from "./test-utils";

describe("tag classification", () => {
  it("recognises inline carriers", () => {
    expect(isInlineCarrierTag("span")).toBe(true);
    expect(isInlineCarrierTag("strong")).toBe(true);
    expect(isInlineCarrierTag("div")).toBe(false);
  });

  it("recognises leaf-emitting tags", () => {
    expect(isLeafEmittingTag("button")).toBe(true);
    expect(isLeafEmittingTag("h2")).toBe(true);
    expect(isLeafEmittingTag("div")).toBe(false);
  });

  it("recognises form controls and button-like classes", () => {
    expect(isFormControlTag("input")).toBe(true);
    expect(isFormControlTag("select")).toBe(true);
    expect(isButtonLikeClass(["btn-primary"])).toBe(true);
    expect(isButtonLikeClass(["hero"])).toBe(false);
  });
});

describe("mapElementToLeafBlock", () => {
  it("maps headings with level", () => {
    // Text aggregation is the node converter's job; the mapper uses the text it is given.
    const mapping = mapElementToLeafBlock(el("h2"), "About us");
    expect(mapping).toMatchObject({ type: "heading", props: { text: "About us", level: 2 } });
  });

  it("maps paragraphs", () => {
    const mapping = mapElementToLeafBlock(el("p", { attrs: { align: "center" } }), "Body copy");
    expect(mapping).toMatchObject({ type: "paragraph", props: { text: "Body copy", align: "center" } });
  });

  it("maps buttons with href", () => {
    const mapping = mapElementToLeafBlock(el("button", { attrs: { href: "/pricing" } }), "Get started");
    expect(mapping).toMatchObject({ type: "button", props: { text: "Get started", href: "/pricing" } });
  });

  it("maps button-like links to buttons and plain links to paragraphs", () => {
    const cta = mapElementToLeafBlock(el("a", { classes: ["btn", "btn-primary"], attrs: { href: "/x" } }), "Buy");
    expect(cta).toMatchObject({ type: "button", props: { text: "Buy", href: "/x" } });

    const plain = mapElementToLeafBlock(el("a", { attrs: { href: "/about" } }), "About");
    expect(plain).toMatchObject({ type: "paragraph", props: { text: "About", href: "/about" } });
  });

  it("maps images with src and alt", () => {
    const mapping = mapElementToLeafBlock(
      el("img", { attrs: { src: "https://example.com/a.png", alt: "Hero visual" } }),
      "",
    );
    expect(mapping).toMatchObject({
      type: "image",
      props: { src: "https://example.com/a.png", alt: "Hero visual" },
    });
  });

  it("maps svg to an icon placeholder with an approximation note", () => {
    const mapping = mapElementToLeafBlock(el("svg", { classes: ["w-8", "h-8"] }), "");
    expect(mapping).toMatchObject({ type: "icon", approximated: "svg-paths-not-converted" });
    if (mapping?.type === "icon") {
      expect(mapping.props.size).toBe(32);
    }
  });

  it("maps videos", () => {
    const mapping = mapElementToLeafBlock(
      el("video", { attrs: { src: "https://example.com/v.mp4", title: "Demo" } }),
      "",
    );
    expect(mapping).toMatchObject({ type: "video", props: { src: "https://example.com/v.mp4", title: "Demo" } });
  });

  it("maps text inputs, checkboxes, radios and submit buttons", () => {
    const input = mapElementToLeafBlock(el("input", { attrs: { placeholder: "Your email" } }), "");
    expect(input).toMatchObject({ type: "input", props: { placeholder: "Your email" } });

    const checkbox = mapElementToLeafBlock(el("input", { attrs: { type: "checkbox", checked: true } }), "");
    expect(checkbox).toMatchObject({ type: "checkbox", props: { checked: true } });

    const radio = mapElementToLeafBlock(el("input", { attrs: { type: "radio" } }), "");
    expect(radio).toMatchObject({ type: "checkbox", approximated: "radio-mapped-to-checkbox" });

    const submit = mapElementToLeafBlock(el("input", { attrs: { type: "submit", value: "Send" } }), "");
    expect(submit).toMatchObject({ type: "button", props: { text: "Send" } });
  });

  it("maps textarea and select (with approximation)", () => {
    const textarea = mapElementToLeafBlock(el("textarea", { attrs: { placeholder: "Message" } }), "");
    expect(textarea).toMatchObject({ type: "textarea", props: { placeholder: "Message" } });

    const select = mapElementToLeafBlock(el("select"), "");
    expect(select).toMatchObject({ type: "input", approximated: "select-mapped-to-input" });
  });

  it("maps labels, hr and pre", () => {
    expect(mapElementToLeafBlock(el("label"), "Name")).toMatchObject({ type: "paragraph" });
    expect(mapElementToLeafBlock(el("hr"), "")).toMatchObject({ type: "divider" });
    const pre = mapElementToLeafBlock(el("pre"), "code");
    expect(pre).toMatchObject({ type: "paragraph", style: { fontFamily: "ui-monospace, monospace" } });
  });

  it("returns null for generic elements", () => {
    expect(mapElementToLeafBlock(el("div"), "text")).toBeNull();
    expect(mapElementToLeafBlock(el("section"), "text")).toBeNull();
  });
});
