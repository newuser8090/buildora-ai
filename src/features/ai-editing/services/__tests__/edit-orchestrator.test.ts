// ---------------------------------------------------------------------------
// Edit orchestrator — server-side modify flow
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { orchestrateEdit } from "../edit-orchestrator";
import type { EditedSection, EditProvider } from "../../types";
import type { ValidatedEditTarget } from "../../schemas/edit-schemas";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const TARGET: ValidatedEditTarget = {
  kind: "section",
  sectionId: "s-hero",
  type: "hero",
  label: "Hero section",
  props: {
    headline: "Old headline",
    primaryCta: { text: "Go", href: "#start" },
    secondaryCta: { text: "Learn", href: "#learn" },
  },
  context: { brandName: "Acme" },
};

function fakeRuleBased(edits: EditedSection[]): EditProvider {
  return {
    id: "rule-based",
    editContent: vi.fn(async () => ({
      edits,
      source: "rule-based" as const,
      warnings: [],
    })),
  };
}

function fakeGemini(
  edits: EditedSection[],
  options?: { fail?: boolean },
): EditProvider {
  return {
    id: "gemini",
    editContent: vi.fn(async () => {
      if (options?.fail) throw new Error("Gemini boom");
      return { edits, source: "gemini" as const, warnings: [] };
    }),
  };
}

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

describe("orchestrateEdit — provider selection", () => {
  it("uses rule-based when no Gemini provider is available", async () => {
    const ruleBased = fakeRuleBased([
      { type: "hero", props: { headline: "Local edit" } },
    ]);
    const result = await orchestrateEdit(TARGET, "make it playful", {
      ruleBased,
    });
    expect(result.source).toBe("rule-based");
    expect(result.edits[0].props.headline).toBe("Local edit");
  });

  it("uses Gemini when available", async () => {
    const gemini = fakeGemini([{ type: "hero", props: { headline: "AI edit" } }]);
    const result = await orchestrateEdit(TARGET, "make it bold", {
      gemini,
      ruleBased: fakeRuleBased([{ type: "hero", props: { headline: "never" } }]),
    });
    expect(result.source).toBe("gemini");
    expect(result.edits[0].props.headline).toBe("AI edit");
  });

  it("falls back to rule-based when Gemini throws", async () => {
    const ruleBased = fakeRuleBased([
      { type: "hero", props: { headline: "Fallback edit" } },
    ]);
    const result = await orchestrateEdit(TARGET, "rewrite", {
      gemini: fakeGemini([], { fail: true }),
      ruleBased,
    });
    expect(result.source).toBe("rule-based");
    expect(result.edits[0].props.headline).toBe("Fallback edit");
  });

  it("honors forceLocal even when Gemini is available", async () => {
    const ruleBased = fakeRuleBased([
      { type: "hero", props: { headline: "Forced local" } },
    ]);
    const result = await orchestrateEdit(TARGET, "rewrite", {
      gemini: fakeGemini([{ type: "hero", props: { headline: "should not apply" } }]),
      ruleBased,
      forceLocal: true,
    });
    expect(result.source).toBe("rule-based");
    expect(result.edits[0].props.headline).toBe("Forced local");
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("orchestrateEdit — validation", () => {
  it("applies schema defaults to valid edits", async () => {
    const gemini = fakeGemini([{ type: "hero", props: { headline: "Clean" } }]);
    const result = await orchestrateEdit(TARGET, "rewrite", {
      gemini,
      ruleBased: fakeRuleBased([]),
    });
    expect(result.source).toBe("gemini");
    // Hero props schema fills the primaryCta default
    expect(result.edits[0].props.primaryCta).toEqual({
      text: "Get Started",
      href: "#",
    });
  });

  it("falls back to original props and warns when an edit fails validation", async () => {
    // primaryCta: 42 is not a valid link item → schema fails
    const gemini = fakeGemini([{ type: "hero", props: { primaryCta: 42 } }]);
    const result = await orchestrateEdit(TARGET, "rewrite", {
      gemini,
      ruleBased: fakeRuleBased([]),
    });
    expect(result.edits).toEqual([
      { type: "hero", props: { ...TARGET.props } },
    ]);
    expect(
      result.warnings.some((w) => w.includes("validation")),
    ).toBe(true);
  });

  it("rejects wrong-type edits and keeps the original content", async () => {
    // A footer edit for a hero target is dropped before schema validation.
    const gemini = fakeGemini([
      { type: "footer", props: { text: "© new" } },
    ]);
    const result = await orchestrateEdit(TARGET, "rewrite", {
      gemini,
      ruleBased: fakeRuleBased([]),
    });
    expect(result.edits).toEqual([
      { type: "hero", props: { ...TARGET.props } },
    ]);
    expect(
      result.warnings.some((w) => w.includes("does not match target")),
    ).toBe(true);
  });
});
