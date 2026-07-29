import { analyzePrompt } from "../analyzers/prompt-analyzer";
import { normalizeSectionType } from "./generation-provider";
import {
  normalizeSectionProps as normalizeSectionComprehensively,
  logNormalizationWarning,
} from "../normalizers/link-normalizer";
import type {
  GenerationProvider,
  GenerationProviderInput,
  GenerationProviderResult,
} from "./generation-provider";

// ---------------------------------------------------------------------------
// RuleBasedGenerationProvider
// Wraps the existing deterministic pipeline.
// ---------------------------------------------------------------------------

export const ruleBasedProvider: GenerationProvider = {
  id: "rule-based",

  async generatePlan(input: GenerationProviderInput): Promise<GenerationProviderResult> {
    const plan = analyzePrompt(input.prompt);
    const warnings: string[] = [];

    // Normalize sections using the comprehensive normalizer
    const normalizedSections = plan.sections.map((s) => {
      const normalizedType = normalizeSectionType(s.type);
      if (normalizedType !== s.type) {
        warnings.push(`Normalized section type "${s.type}" → "${normalizedType}"`);
      }

      // Use the comprehensive section normalizer
      const normalized = normalizeSectionComprehensively({
        type: normalizedType,
        props: { ...s.props },
      });

      logNormalizationWarning(s.type, "props", s.props);

      return { ...s, type: normalizedType, props: normalized.props };
    });

    return {
      plan: {
        ...plan,
        sections: normalizedSections,
      },
      source: "rule-based",
      warnings,
    };
  },
};
