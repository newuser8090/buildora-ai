// ---------------------------------------------------------------------------
// Phase P22-G — pure presentation layer tests
// Covers: animation resolution (presets, timing, reduced-motion), interaction
// resolution (navigate / scroll-to / hover / focus), and NavTarget
// integration through the existing safe boundaries. The layer is pure and
// framework-independent — no React, no DOM.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { Page } from "@/types/project";
import type { ElementTree, ElementNode } from "../types";
import {
  resolveAnimationPresentation,
  resolveInteractionPresentation,
  presentTree,
  effectiveAnimationForNode,
  keyframeStopsForType,
  keyframesName,
  keyframesCssForType,
  isInertAnimationType,
  animationCssValues,
  treeHasDynamicPresentation,
} from "../interactions/present";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PAGES: Page[] = [
  { id: "home", title: "Home", slug: "/", sections: [] },
  { id: "about", title: "About", slug: "/about", sections: [] },
];

function node(overrides: Partial<ElementNode> = {}): ElementNode {
  return {
    id: "n1",
    type: "heading",
    parentId: null,
    children: [],
    props: {},
    style: {},
    responsive: {},
    visible: true,
    locked: false,
    hidden: false,
    ...overrides,
  };
}

function treeWith(...nodes: ElementNode[]): ElementTree {
  const map: Record<string, ElementNode> = {};
  for (const n of nodes) map[n.id] = n;
  return { rootIds: nodes.map((n) => n.id), nodes: map };
}

// ---------------------------------------------------------------------------
// Animation resolution
// ---------------------------------------------------------------------------

describe("keyframes — presets", () => {
  it.each(["fade", "slide", "scale", "bounce", "reveal", "blur", "rotate"] as const)(
    "produces deterministic keyframes for %s",
    (type) => {
      const stops = keyframeStopsForType(type);
      expect(stops.length).toBeGreaterThanOrEqual(2);
      expect(keyframesName(type)).toBe(`ba-${type}`);
      const css = keyframesCssForType(type);
      expect(css).toContain(`@keyframes ba-${type}`);
      expect(css).toContain("100%");
    },
  );

  it("treats custom as inert (no safe representation)", () => {
    expect(keyframeStopsForType("custom")).toEqual([]);
    expect(keyframesCssForType("custom")).toBe("");
    expect(isInertAnimationType("custom")).toBe(true);
  });
});

describe("animationCssValues — bounded timing", () => {
  it("applies defaults when fields are absent", () => {
    const v = animationCssValues({ trigger: "load", type: "fade" });
    expect(v.duration).toBe("500ms");
    expect(v.delay).toBe("0ms");
    expect(v.timing).toBe("ease");
    expect(v.iteration).toBe("1");
    expect(v.direction).toBe("normal");
  });

  it("uses provided duration/delay/easing/repeat/direction", () => {
    const v = animationCssValues({
      trigger: "load",
      type: "fade",
      durationMs: 800,
      delayMs: 150,
      easing: "ease-in-out",
      repeat: "infinite",
      direction: "alternate",
    });
    expect(v.duration).toBe("800ms");
    expect(v.delay).toBe("150ms");
    expect(v.timing).toBe("ease-in-out");
    expect(v.iteration).toBe("infinite");
    expect(v.direction).toBe("alternate");
  });

  it("clamps out-of-bounds values to the schema bounds", () => {
    const v = animationCssValues({
      trigger: "load",
      type: "fade",
      durationMs: 999_999,
      delayMs: -50,
      repeat: 7.9,
    });
    expect(v.duration).toBe("60000ms");
    expect(v.delay).toBe("0ms");
    expect(v.iteration).toBe("8");
  });

  it("falls back on malformed numeric input", () => {
    const v = animationCssValues({
      trigger: "load",
      type: "fade",
      durationMs: Number.NaN,
      repeat: -3,
    });
    expect(v.duration).toBe("500ms");
    expect(v.iteration).toBe("1");
  });
});

describe("resolveAnimationPresentation — entrance triggers", () => {
  it("resolves a load entrance to inline animation properties", () => {
    const pres = resolveAnimationPresentation(node({ animation: { trigger: "load", type: "fade", durationMs: 400 } }));
    expect(pres.reveal).toBe("load");
    expect(pres.inlineStyle.animationName).toBe("ba-fade");
    expect(pres.inlineStyle.animationDuration).toBe("400ms");
    expect(pres.inlineStyle.animationFillMode).toBe("both");
    expect(pres.keyframesCss).toContain("@keyframes ba-fade");
    expect(pres.attributes["data-ba-anim"]).toBe("load");
  });

  it("resolves a scroll entrance to base style + reveal attributes", () => {
    const pres = resolveAnimationPresentation(
      node({ animation: { trigger: "scroll", type: "slide", durationMs: 600 } }),
    );
    expect(pres.reveal).toBe("scroll");
    expect(pres.baseStyle.opacity).toBe(0);
    expect(pres.baseStyle.transform).toBe("translateY(24px)");
    expect(pres.attributes["data-ba-anim"]).toBe("scroll");
    expect(pres.attributes["data-ba-reveal"]).toBe("n1");
    expect(pres.triggerCss).toContain('data-ba-reveal="n1"');
    expect(pres.triggerCss).toContain("animation:");
  });

  it("treats viewport trigger like scroll (P22-G maps viewport→scroll)", () => {
    const pres = resolveAnimationPresentation(
      node({ animation: { trigger: "viewport", type: "fade" } }),
    );
    expect(pres.reveal).toBe("scroll");
  });

  it("resolves hover/click triggers to pure CSS pseudo rules", () => {
    const hover = resolveAnimationPresentation(
      node({ animation: { trigger: "hover", type: "scale" } }),
    );
    expect(hover.reveal).toBeNull();
    expect(hover.triggerCss).toContain('[data-block-id="n1"]:hover');
    expect(hover.triggerCss).toContain("@keyframes ba-scale".replace("@keyframes ", "")); // rule references the animation
    expect(hover.attributes["data-ba-anim"]).toBe("hover");

    const click = resolveAnimationPresentation(
      node({ animation: { trigger: "click", type: "bounce" } }),
    );
    expect(click.triggerCss).toContain('[data-block-id="n1"]:active');
    expect(click.attributes["data-ba-anim"]).toBe("click");
  });

  it("is empty for inert types and absent animations", () => {
    const custom = resolveAnimationPresentation(node({ animation: { trigger: "load", type: "custom" } }));
    expect(custom.animation).toBeNull();
    expect(custom.inlineStyle).toEqual({});
    const none = resolveAnimationPresentation(node());
    expect(none.animation).toBeNull();
    expect(none.keyframesCss).toBe("");
  });

  it("prefers explicit animation over interaction scroll/load shortcuts", () => {
    const pres = resolveAnimationPresentation(
      node({
        animation: { trigger: "load", type: "fade" },
        interaction: {
          scroll: { kind: "reveal", animation: { trigger: "scroll", type: "blur" } },
          load: { trigger: "load", type: "rotate" },
        },
      }),
    );
    expect(pres.animation?.type).toBe("fade");
  });
});

describe("effectiveAnimationForNode — interaction shortcuts", () => {
  it("uses the scroll reveal animation when no explicit animation exists", () => {
    const effective = effectiveAnimationForNode(
      node({
        interaction: { scroll: { kind: "reveal", animation: { trigger: "scroll", type: "blur" } } },
      }),
    );
    expect(effective?.trigger).toBe("scroll");
    expect(effective?.animation.type).toBe("blur");
  });

  it("uses the load shortcut when present", () => {
    const effective = effectiveAnimationForNode(
      node({ interaction: { load: { trigger: "load", type: "rotate" } } }),
    );
    expect(effective?.trigger).toBe("load");
    expect(effective?.animation.type).toBe("rotate");
  });

  it("returns null for nothing, deferred scroll kinds, and inert types", () => {
    expect(effectiveAnimationForNode(node())).toBeNull();
    expect(
      effectiveAnimationForNode(node({ interaction: { scroll: { kind: "sticky" } } })),
    ).toBeNull();
    expect(
      effectiveAnimationForNode(node({ animation: { trigger: "load", type: "custom" } })),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Interaction resolution
// ---------------------------------------------------------------------------

describe("resolveInteractionPresentation — click navigation", () => {
  it("resolves page targets to safe internal hrefs", () => {
    const pres = resolveInteractionPresentation(
      node({ interaction: { click: { kind: "navigate", target: { kind: "page", pageId: "about" } } } }),
      treeWith(node()),
      PAGES,
    );
    expect(pres.click?.kind).toBe("navigate");
    expect(pres.click?.href).toBe("/about");
    expect(pres.click?.resolvedKind).toBe("internal");
    expect(pres.click?.safe).toBe(true);
  });

  it("resolves external / email / phone / back targets", () => {
    const ext = resolveInteractionPresentation(
      node({ interaction: { click: { kind: "navigate", target: { kind: "external", url: "https://example.com" } } } }),
      treeWith(node()),
      PAGES,
    ).click;
    expect(ext?.resolvedKind).toBe("external");
    expect(ext?.href).toBe("https://example.com");

    const email = resolveInteractionPresentation(
      node({ interaction: { click: { kind: "navigate", target: { kind: "email", to: "a@b.co" } } } }),
      treeWith(node()),
      PAGES,
    ).click;
    expect(email?.href).toBe("mailto:a@b.co");

    const phone = resolveInteractionPresentation(
      node({ interaction: { click: { kind: "navigate", target: { kind: "phone", number: "+1555" } } } }),
      treeWith(node()),
      PAGES,
    ).click;
    expect(phone?.href).toBe("tel:+1555");

    const back = resolveInteractionPresentation(
      node({ interaction: { click: { kind: "navigate", target: { kind: "back" } } } }),
      treeWith(node()),
      PAGES,
    ).click;
    expect(back?.resolvedKind).toBe("back");
  });

  it("never resolves unsafe external URLs (defense in depth)", () => {
    const pres = resolveInteractionPresentation(
      node({ interaction: { click: { kind: "navigate", target: { kind: "external", url: "javascript:alert(1)" } } } }),
      treeWith(node()),
      PAGES,
    );
    expect(pres.click?.safe).toBe(false);
    expect(pres.click?.href).toBe("#");
  });

  it("marks unknown page targets unresolved (no dead navigation)", () => {
    const pres = resolveInteractionPresentation(
      node({ interaction: { click: { kind: "navigate", target: { kind: "page", pageId: "nope" } } } }),
      treeWith(node()),
      PAGES,
    );
    expect(pres.click?.safe).toBe(false);
  });
});

describe("resolveInteractionPresentation — scroll-to", () => {
  it("resolves scroll-to within the same tree", () => {
    const target = node({ id: "target" });
    const pres = resolveInteractionPresentation(
      node({ id: "btn", interaction: { click: { kind: "scroll-to", elementId: "target" } } }),
      treeWith(node({ id: "btn" }), target),
      PAGES,
    );
    expect(pres.click?.kind).toBe("scroll-to");
    expect(pres.click?.scrollElementId).toBe("target");
    expect(pres.click?.safe).toBe(true);
  });

  it("marks scroll-to unresolved when the target is not in the tree", () => {
    const pres = resolveInteractionPresentation(
      node({ id: "btn", interaction: { click: { kind: "scroll-to", elementId: "ghost" } } }),
      treeWith(node({ id: "btn" })),
      PAGES,
    );
    expect(pres.click?.safe).toBe(false);
  });

  it("deferred click kinds never produce behavior", () => {
    for (const kind of ["toggle", "open-modal", "submit-form", "custom", "start-animation"] as const) {
      const click =
        kind === "toggle" || kind === "open-modal" || kind === "start-animation"
          ? { kind, elementId: "x" }
          : kind === "submit-form"
            ? { kind, formId: "f" }
            : { kind, handlerId: "h" };
      const pres = resolveInteractionPresentation(
        node({ id: "btn", interaction: { click: click as never } }),
        treeWith(node({ id: "btn" })),
        PAGES,
      );
      expect(pres.click).toBeNull();
    }
  });

  it("absent interaction yields null click", () => {
    const pres = resolveInteractionPresentation(node(), treeWith(node()), PAGES);
    expect(pres.click).toBeNull();
    expect(pres.hoverCss).toBe("");
    expect(pres.focusCss).toBe("");
  });
});

describe("resolveInteractionPresentation — hover/focus effects", () => {
  it("builds allow-listed hover CSS", () => {
    const pres = resolveInteractionPresentation(
      node({ interaction: { hover: { color: "#ff0000", scale: 1.05, shadow: "md" } } }),
      treeWith(node()),
      PAGES,
    );
    expect(pres.hoverCss).toContain('[data-block-id="n1"]:hover');
    expect(pres.hoverCss).toContain("color: #ff0000;");
    expect(pres.hoverCss).toContain("transform: var(--ba-ht, scale(1.05));");
    expect(pres.hoverCss).toContain("box-shadow:");
  });

  it("builds focus-visible CSS and marks focusable", () => {
    const pres = resolveInteractionPresentation(
      node({ interaction: { focus: { backgroundColor: "var(--accent)" } } }),
      treeWith(node()),
      PAGES,
    );
    expect(pres.focusable).toBe(true);
    expect(pres.focusCss).toContain('[data-block-id="n1"]:focus-visible');
    expect(pres.focusCss).toContain("background-color: var(--accent);");
  });

  it("drops unsafe/unknown hover values entirely", () => {
    const pres = resolveInteractionPresentation(
      node({ interaction: { hover: { color: "javascript:alert(1)", scale: Number.NaN, shadow: "huge" as never } } }),
      treeWith(node()),
      PAGES,
    );
    expect(pres.hoverCss).toBe("");
  });

  it("adds a transition to the base style when effects exist", () => {
    const pres = resolveInteractionPresentation(
      node({ interaction: { hover: { scale: 1.1 } } }),
      treeWith(node()),
      PAGES,
    );
    expect(pres.baseStyle.transition).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Tree-level presentation + reduced motion
// ---------------------------------------------------------------------------

describe("presentTree", () => {
  it("collects keyframes, rules, and reveal needs across the tree", () => {
    const pres = presentTree(
      treeWith(
        node({ id: "a", animation: { trigger: "load", type: "fade" } }),
        node({ id: "b", interaction: { scroll: { kind: "reveal", animation: { trigger: "scroll", type: "slide" } } } }),
        node({ id: "c", interaction: { hover: { scale: 1.1 } } }),
      ),
      PAGES,
    );
    expect(pres.cssText).toContain("@keyframes ba-fade");
    expect(pres.cssText).toContain("@keyframes ba-slide");
    expect(pres.cssText).toContain('[data-block-id="c"]:hover');
    expect(pres.needsRevealObserver).toBe(true);
  });

  it("emits the reduced-motion guard only when entrance animations exist", () => {
    const withEntrance = presentTree(
      treeWith(node({ animation: { trigger: "load", type: "fade" } })),
      PAGES,
    );
    expect(withEntrance.cssText).toContain("prefers-reduced-motion");

    const hoverOnly = presentTree(
      treeWith(node({ interaction: { hover: { scale: 1.1 } } })),
      PAGES,
    );
    expect(hoverOnly.cssText).not.toContain("prefers-reduced-motion");
    expect(hoverOnly.cssText).toContain(":hover");
  });

  it("produces empty CSS for trees without dynamic data", () => {
    const pres = presentTree(treeWith(node()), PAGES);
    expect(pres.cssText).toBe("");
    expect(pres.needsRevealObserver).toBe(false);
  });

  it("orders output deterministically by node id", () => {
    const a = presentTree(
      treeWith(
        node({ id: "z", animation: { trigger: "load", type: "fade" } }),
        node({ id: "a", animation: { trigger: "load", type: "fade" } }),
      ),
      PAGES,
    );
    const b = presentTree(
      treeWith(
        node({ id: "a", animation: { trigger: "load", type: "fade" } }),
        node({ id: "z", animation: { trigger: "load", type: "fade" } }),
      ),
      PAGES,
    );
    expect(a.cssText).toBe(b.cssText);
  });
});

describe("treeHasDynamicPresentation", () => {
  it("detects any animation or interaction data", () => {
    expect(treeHasDynamicPresentation(treeWith(node()))).toBe(false);
    expect(
      treeHasDynamicPresentation(treeWith(node({ interaction: { hover: { scale: 1.1 } } }))),
    ).toBe(true);
    expect(
      treeHasDynamicPresentation(treeWith(node({ animation: { trigger: "load", type: "fade" } }))),
    ).toBe(true);
  });
});
