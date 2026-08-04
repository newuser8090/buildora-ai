// ---------------------------------------------------------------------------
// Rule-based inline provider tests (Phase M spec §28)
//   - shorter / longer / playful / premium / professional / concise
//   - regenerate / unsupported intent / deterministic / max-length / no mutation
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  applyRuleBasedInlineSuggestion,
  RuleBasedInlineProvider,
} from "../rule-based-inline-provider";
import type { InlineSuggestionInput } from "../../types";

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
    currentValue: "This is a fairly long headline that says a lot of words about a thing",
    ...overrides,
  };
}

describe("rule-based inline provider — intents", () => {
  it("shorter reduces the word count", () => {
    const input = makeInput();
    const result = applyRuleBasedInlineSuggestion(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shorter = input.currentValue.split(/\s+/).length;
    const output = result.suggestedValue.split(/\s+/).length;
    expect(output).toBeLessThanOrEqual(shorter);
    expect(result.suggestedValue.length).toBeGreaterThan(0);
  });

  it("longer expands the text", () => {
    const result = applyRuleBasedInlineSuggestion(
      makeInput({ instruction: "Make this longer", currentValue: "Short." }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.suggestedValue.length).toBeGreaterThan("Short.".length);
  });

  it("playful produces a playful opening", () => {
    const result = applyRuleBasedInlineSuggestion(
      makeInput({ instruction: "Make this playful", currentValue: "Hello there" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(/Hey!|Oh hi!|Guess what\?/.test(result.suggestedValue)).toBe(true);
  });

  it("premium appends a premium flourish", () => {
    const result = applyRuleBasedInlineSuggestion(
      makeInput({ instruction: "Make this more premium", currentValue: "quality service" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.suggestedValue).toContain("—");
  });

  it("professional capitalizes and normalizes punctuation", () => {
    const result = applyRuleBasedInlineSuggestion(
      makeInput({ instruction: "Make this professional", currentValue: "just do it!!" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.suggestedValue.charAt(0)).toBe(result.suggestedValue.charAt(0).toUpperCase());
    expect(/!{2,}/.test(result.suggestedValue)).toBe(false);
  });

  it("concise strips filler words", () => {
    const result = applyRuleBasedInlineSuggestion(
      makeInput({ instruction: "Make it concise", currentValue: "really very quite good stuff" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.suggestedValue).not.toMatch(/\b(very|quite)\b/);
  });

  it("regenerate produces a variant different from the input", () => {
    const result = applyRuleBasedInlineSuggestion(
      makeInput({ instruction: "Try another version", currentValue: "Acme Cloud" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.suggestedValue).not.toBe("Acme Cloud");
  });

  it("CTA intent only applies to button/link fields", () => {
    const button = applyRuleBasedInlineSuggestion(
      makeInput({ fieldKind: "button-text", instruction: "improve CTA", currentValue: "buy now" }),
    );
    expect(button.ok).toBe(true);
    if (button.ok) {
      // Button fields get a CTA-style starter.
      expect(button.suggestedValue).toMatch(/^[A-Z][a-z]+ /);
    }
    const heading = applyRuleBasedInlineSuggestion(
      makeInput({ fieldKind: "heading", instruction: "improve CTA", currentValue: "buy now" }),
    );
    // For non-button fields the CTA branch is skipped → heading title-casing.
    expect(heading.ok).toBe(true);
    if (heading.ok) expect(heading.suggestedValue).toMatch(/^Buy now/);
  });

  it("returns a structured warning for unsupported/generic intents", () => {
    const result = applyRuleBasedInlineSuggestion(
      makeInput({ instruction: "do something magical", currentValue: "Plain text here" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("never returns an empty suggestion", () => {
    const result = applyRuleBasedInlineSuggestion(
      makeInput({
        instruction: "Make this more premium",
        currentValue: "Non-empty text",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.suggestedValue.trim().length).toBeGreaterThan(0);
  });

  it("returns INLINE_NO_CHANGE for an empty current value", () => {
    const result = applyRuleBasedInlineSuggestion(
      makeInput({ currentValue: "" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INLINE_NO_CHANGE");
  });
});

describe("rule-based inline provider — determinism & safety", () => {
  it("is deterministic for a given input", () => {
    const input = makeInput();
    const a = applyRuleBasedInlineSuggestion(input);
    const b = applyRuleBasedInlineSuggestion(input);
    expect(a).toEqual(b);
  });

  it("preserves Unicode", () => {
    const result = applyRuleBasedInlineSuggestion(
      makeInput({ currentValue: "Über café — naïvely délicieux" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.suggestedValue).toContain("Über");
  });

  it("respects max length by not overflowing the provider cap", () => {
    const result = applyRuleBasedInlineSuggestion(
      makeInput({ currentValue: "x".repeat(1000), instruction: "Make this longer" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.suggestedValue.length).toBeLessThanOrEqual(2001);
  });

  it("does not mutate the input", () => {
    const input = makeInput();
    const before = input.currentValue;
    applyRuleBasedInlineSuggestion(input);
    expect(input.currentValue).toBe(before);
  });

  it("provider wrapper returns ProviderResult shape", async () => {
    const provider = new RuleBasedInlineProvider();
    const result = await provider.suggest(makeInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.suggestion.suggestedValue).toBe("string");
      expect(result.suggestion.suggestedValue.length).toBeGreaterThan(0);
    }
  });
});
