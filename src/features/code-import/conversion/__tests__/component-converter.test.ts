// ---------------------------------------------------------------------------
// Component converter tests (Phase P2)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";

import { createConversionContext } from "../conversion-report";
import { createConversionIdFactory } from "../conversion-errors";
import { collectElementText, detectComponentType, extractCompositeProps } from "../component-converter";
import { analyseImportSource } from "../../analysis/analyse-import-source";
import { el, txt } from "./test-utils";

function contextFor(source: string) {
  return createConversionContext(
    analyseImportSource(source),
    createConversionIdFactory("b"),
  );
}

function detect(classNameOrTag: string, tag = "div", source = "<div class=\"x\"></div>") {
  const ctx = contextFor(source);
  return detectComponentType(el(tag, { classes: [classNameOrTag] }), ctx);
}

describe("detectComponentType — composite blocks", () => {
  it("detects cards", () => {
    expect(detect("card")).toEqual({ type: "card", name: "Card" });
    expect(detect("feature-card")).toEqual({ type: "feature-card", name: "Feature card" });
    expect(detect("pricing-card")).toEqual({ type: "pricing-card", name: "Pricing card" });
    expect(detect("review-card")).toEqual({ type: "review-card", name: "Review card" });
  });

  it("detects faq, team, tabs, accordion and badges", () => {
    expect(detect("faq-item")).toEqual({ type: "faq-item", name: "Question" });
    expect(detect("team-member")).toEqual({ type: "team-member", name: "Team member" });
    expect(detect("tab")).toEqual({ type: "tabs", name: "Tabs" });
    expect(detect("accordion-item")).toEqual({ type: "accordion", name: "Accordion" });
    expect(detect("badge")).toEqual({ type: "badge", name: "Badge" });
    expect(detect("chip")).toEqual({ type: "badge", name: "Badge" });
  });

  it("does not treat item containers as cards", () => {
    expect(detect("pricing-grid").type).toBeNull();
    expect(detect("features-list").type).toBeNull();
    expect(detect("card-list").type).toBeNull();
    expect(detect("faq-section").type).toBeNull();
    expect(detect("team-row").type).toBeNull();
  });

  it("detects navigation patterns", () => {
    const ctx = contextFor("<nav></nav>");
    expect(detectComponentType(el("nav"), ctx)).toEqual({ type: "menu", name: "Menu" });
    expect(detect("navbar")).toEqual({ type: "navbar", name: "Navigation" });
    expect(detect("menu")).toEqual({ type: "menu", name: "Menu" });
    const footerCtx = contextFor("<footer></footer>");
    expect(detectComponentType(el("footer"), footerCtx)).toEqual({ type: "footer", name: "Footer" });
    expect(detect("page-footer")).toEqual({ type: "footer", name: "Footer" });
  });

  it("detects section names without forcing a block type", () => {
    expect(detect("hero")).toEqual({ type: null, name: "Hero" });
    expect(detect("cta")).toEqual({ type: null, name: "CTA" });
  });

  it("detects avatars and logos on image tags", () => {
    const ctx = contextFor("<img />");
    expect(detectComponentType(el("img", { classes: ["avatar"] }), ctx)).toEqual({
      type: "image",
      name: "Avatar",
    });
    expect(detectComponentType(el("img", { classes: ["logo"] }), ctx)).toEqual({
      type: "image",
      name: "Logo",
    });
  });

  it("leaves generic divs undetected", () => {
    expect(detect("content")).toEqual({ type: null });
  });
});

describe("extractCompositeProps", () => {
  it("extracts pricing card props from text", () => {
    const props = extractCompositeProps("pricing-card", [
      "Pro",
      "$29",
      "per month",
      "Everything you need",
    ]);
    expect(props.price).toBe("$29");
    expect(props.period).toBe("per month");
    expect(props.name).toBe("Pro");
  });

  it("extracts team member and review props", () => {
    const team = extractCompositeProps("team-member", ["Ada Lovelace", "CTO"]);
    expect(team).toMatchObject({ name: "Ada Lovelace", role: "CTO" });

    const review = extractCompositeProps("review-card", ["★★★★★", "Amazing!"]);
    expect(review.rating).toBe(5);
  });

  it("returns no props for unknown text shapes", () => {
    expect(extractCompositeProps("card", ["just some text"])).toEqual({});
  });
});

describe("text collection", () => {
  it("collects descendant text deterministically", () => {
    const element = el("div", {
      children: [
        txt("Hello "),
        el("h3", { children: [txt("World")] }),
        el("p", { children: [txt("Body")] }),
      ],
    });
    expect(collectElementText(element)).toEqual(["Hello", "World", "Body"]);
  });
});
