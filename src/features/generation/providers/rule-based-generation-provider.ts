import { analyzePrompt, analyzeSitePrompt } from "../analyzers/prompt-analyzer";
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
    // Phase P22-I — site mode routes through the deterministic site analyzer.
    const plan =
      input.mode === "site"
        ? analyzeSitePrompt(input.prompt)
        : analyzePrompt(input.prompt);
    const warnings: string[] = [];

    const normalize = (s: { type: string; props: Record<string, unknown>; order: number }) => {
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
    };

    const normalizedSections = plan.sections.map(normalize);

    return {
      plan: {
        ...plan,
        sections: normalizedSections,
        // Phase P22-I — normalize every page's sections too, preserving the
        // canonical page/slug structure from the site analyzer.
        pages: plan.pages
          ? plan.pages.map((p) => ({
              title: p.title,
              slug: p.slug,
              sections: p.sections.map(normalize),
            }))
          : undefined,
      },
      source: "rule-based",
      warnings,
    };
  },
};
