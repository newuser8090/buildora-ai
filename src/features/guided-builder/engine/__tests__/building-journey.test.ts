// ---------------------------------------------------------------------------
// Building journey — engine tests (Phase N, spec §27)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { getBuildingJourney, journeyStepSectionType } from "../building-journey";
import type { JourneyContext, JourneySection } from "../building-journey";

function ctx(overrides: Partial<JourneyContext>): JourneyContext {
  return {
    pageTitle: "Home",
    sections: [],
    hasPreviewedMobile: false,
    hasExported: false,
    ...overrides,
  };
}

function s(type: string, props: Record<string, unknown> = {}): JourneySection {
  return { type, props };
}

describe("building journey", () => {
  it("reports zero progress on a blank project", () => {
    const journey = getBuildingJourney(ctx({}));
    expect(journey.completedCount).toBe(0);
    expect(journey.total).toBeGreaterThan(0);
  });

  it("marks steps complete from real section state", () => {
    const journey = getBuildingJourney(
      ctx({
        sections: [
          s("hero", { headline: "Message", primaryCta: { text: "Go" } }),
          s("features", {
            features: [{ title: "A", description: "d", icon: "Zap" }],
          }),
          s("cta", { headline: "H", ctaText: "Contact" }),
          s("faq", { title: "FAQ", items: [] }),
          s("footer", { text: "©" }),
        ],
        hasPreviewedMobile: true,
        hasExported: true,
      }),
    );
    const byId = Object.fromEntries(journey.steps.map((st) => [st.id, st.complete]));
    expect(byId["main-message"]).toBe(true);
    expect(byId["offer"]).toBe(true);
    expect(byId["next-step"]).toBe(true);
    expect(byId["trust"]).toBe(true);
    expect(byId["contact"]).toBe(true);
    expect(byId["preview-mobile"]).toBe(true);
    expect(byId["export"]).toBe(true);
    expect(journey.completedCount).toBe(journey.total);
  });

  it("treats an empty hero headline as incomplete main message", () => {
    const journey = getBuildingJourney(
      ctx({ sections: [s("hero", { headline: "" })] }),
    );
    const step = journey.steps.find((st) => st.id === "main-message");
    expect(step?.complete).toBe(false);
  });

  it("accepts a hero button as a clear next step", () => {
    const journey = getBuildingJourney(
      ctx({
        sections: [s("hero", { headline: "H", primaryCta: { text: "Buy" } })],
      }),
    );
    const step = journey.steps.find((st) => st.id === "next-step");
    expect(step?.complete).toBe(true);
  });

  it("tracks preview/export as session flags, not project state", () => {
    const journey = getBuildingJourney(
      ctx({
        sections: [
          s("hero", { headline: "H", primaryCta: { text: "Go" } }),
          s("features", { features: [{ title: "A", description: "d", icon: "Zap" }] }),
          s("cta", { headline: "H", ctaText: "Contact" }),
          s("footer", { text: "©" }),
        ],
      }),
    );
    const mobile = journey.steps.find((st) => st.id === "preview-mobile");
    const exportStep = journey.steps.find((st) => st.id === "export");
    expect(mobile?.complete).toBe(false);
    expect(exportStep?.complete).toBe(false);
  });

  it("is deterministic and does not mutate input", () => {
    const sections = [s("hero", { headline: "H" })];
    const before = JSON.stringify(sections);
    const a = getBuildingJourney(ctx({ sections }));
    const b = getBuildingJourney(ctx({ sections }));
    expect(a).toEqual(b);
    expect(JSON.stringify(sections)).toBe(before);
  });

  it("maps steps to section types for navigation", () => {
    expect(journeyStepSectionType("main-message")).toBe("hero");
    expect(journeyStepSectionType("offer")).toBe("features");
    expect(journeyStepSectionType("next-step")).toBe("cta");
    expect(journeyStepSectionType("contact")).toBe("footer");
    expect(journeyStepSectionType("preview-mobile")).toBeNull();
  });
});
