// ---------------------------------------------------------------------------
// Inline orchestrator tests (Phase M)
//   - Gemini first, rule-based fallback
//   - forceLocal uses rule-based directly
//   - path validation rejects unregistered fields
//   - suggestion validated + clamped to field max length
//   - executable content rejected
//   - never returns raw provider output
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { orchestrateInlineSuggestion } from "../inline-orchestrator";
import type {
  InlineSuggestionInput,
  InlineSuggestionProvider,
} from "../../types";

function makeInput(overrides: Partial<InlineSuggestionInput> = {}): InlineSuggestionInput {
  return {
    instruction: "Make this shorter",
    projectId: "p1",
    baseRevision: 1,
    pageId: "page-1",
    sectionId: "s1",
    sectionType: "hero",
    fieldPath: ["headline"],
    fieldKind: "heading",
    currentValue: "A fairly long headline that could be shorter and more punchy",
    ...overrides,
  };
}

function makeGemini(suggest: (i: InlineSuggestionInput) => Promise<unknown>) {
  return {
    id: "gemini",
    suggest: vi.fn(suggest) as unknown as InlineSuggestionProvider["suggest"],
  };
}

function makeRuleBased(suggest: (i: InlineSuggestionInput) => Promise<unknown>) {
  return {
    id: "rule-based",
    suggest: vi.fn(suggest) as unknown as InlineSuggestionProvider["suggest"],
  };
}

describe("orchestrateInlineSuggestion", () => {
  it("uses Gemini when available", async () => {
    const gemini = makeGemini(async () => ({
      ok: true,
      suggestion: { suggestedValue: "Punchy headline", explanation: "Tightened." },
      warnings: [],
    }));
    const ruleBased = makeRuleBased(async () => ({
      ok: true,
      suggestion: { suggestedValue: "fallback" },
      warnings: [],
    }));

    const result = await orchestrateInlineSuggestion(makeInput(), {
      gemini,
      ruleBased,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe("gemini");
      expect(result.suggestion.suggestedValue).toBe("Punchy headline");
    }
    expect(ruleBased.suggest).not.toHaveBeenCalled();
  });

  it("falls back to rule-based when Gemini fails", async () => {
    const gemini = makeGemini(async () => ({
      ok: false,
      error: { code: "INLINE_SUGGESTION_FAILED", message: "nope" },
    }));
    const ruleBased = makeRuleBased(async () => ({
      ok: true,
      suggestion: { suggestedValue: "fallback text" },
      warnings: [],
    }));

    const result = await orchestrateInlineSuggestion(makeInput(), { gemini, ruleBased });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe("rule-based");
      expect(result.suggestion.suggestedValue).toBe("fallback text");
    }
    expect((result.warnings ?? []).some((w) => w.includes("Gemini"))).toBe(true);
  });

  it("uses rule-based directly under forceLocal", async () => {
    const gemini = makeGemini(async () => ({
      ok: true,
      suggestion: { suggestedValue: "gemini text" },
      warnings: [],
    }));
    const ruleBased = makeRuleBased(async () => ({
      ok: true,
      suggestion: { suggestedValue: "local text" },
      warnings: [],
    }));

    const result = await orchestrateInlineSuggestion(makeInput(), {
      gemini,
      ruleBased,
      forceLocal: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.source).toBe("rule-based");
    expect(gemini.suggest).not.toHaveBeenCalled();
  });

  it("rejects an unregistered field path before calling any provider", async () => {
    const gemini = makeGemini(async () => ({
      ok: true,
      suggestion: { suggestedValue: "x" },
      warnings: [],
    }));
    const result = await orchestrateInlineSuggestion(
      makeInput({ fieldPath: ["primaryCta", "href"] }),
      { gemini, ruleBased: makeRuleBased(async () => ({ ok: true, suggestion: { suggestedValue: "y" }, warnings: [] })) },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INLINE_FIELD_PATH_INVALID");
    expect(gemini.suggest).not.toHaveBeenCalled();
  });

  it("clamps the suggestion to the field's registered max length", async () => {
    const gemini = makeGemini(async () => ({
      ok: true,
      suggestion: { suggestedValue: "x".repeat(500), explanation: "" },
      warnings: [],
    }));
    const result = await orchestrateInlineSuggestion(makeInput(), {
      gemini,
      ruleBased: makeRuleBased(async () => ({ ok: true, suggestion: { suggestedValue: "y" }, warnings: [] })),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.suggestion.suggestedValue.length).toBeLessThanOrEqual(300);
    }
  });

  it("rejects executable content in suggestions", async () => {
    const gemini = makeGemini(async () => ({
      ok: true,
      suggestion: { suggestedValue: "<script>alert(1)</script>" },
      warnings: [],
    }));
    const ruleBased = makeRuleBased(async () => ({
      ok: true,
      suggestion: { suggestedValue: "clean fallback" },
      warnings: [],
    }));
    const result = await orchestrateInlineSuggestion(makeInput(), { gemini, ruleBased });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.suggestion.suggestedValue).not.toMatch(/script/i);
      expect(result.source).toBe("rule-based");
    }
    expect((result.warnings ?? []).some((w) => w.includes("executable content"))).toBe(true);
  });

  it("returns INLINE_SUGGESTION_FAILED when all providers fail", async () => {
    const gemini = makeGemini(async () => ({
      ok: false,
      error: { code: "INLINE_SUGGESTION_FAILED", message: "bad" },
    }));
    const ruleBased = makeRuleBased(async () => ({
      ok: false,
      error: { code: "INLINE_NO_CHANGE", message: "no change" },
    }));
    const result = await orchestrateInlineSuggestion(makeInput(), { gemini, ruleBased });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INLINE_SUGGESTION_FAILED");
  });

  it("never leaks raw provider output into the response", async () => {
    const gemini = makeGemini(async () => ({
      ok: true,
      suggestion: { suggestedValue: "good value", explanation: "why" },
      warnings: [],
    }));
    const result = await orchestrateInlineSuggestion(makeInput(), {
      gemini,
      ruleBased: makeRuleBased(async () => ({ ok: true, suggestion: { suggestedValue: "y" }, warnings: [] })),
    });
    if (result.ok) {
      expect(Object.keys(result.suggestion)).not.toContain("raw");
      expect(result.suggestion).toHaveProperty("suggestedValue");
      expect(result.suggestion).toHaveProperty("id");
      expect(result.suggestion).toHaveProperty("baseRevision");
    }
  });
});
