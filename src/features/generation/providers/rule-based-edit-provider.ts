// ---------------------------------------------------------------------------
// Rule-based edit provider — deterministic AI-editing fallback
//
// Wraps the pure rule-based editor so the API route can treat both edit
// providers uniformly (Gemini with fallback, mirroring create mode).
// ---------------------------------------------------------------------------

import { applyRuleBasedEdit } from "@/features/ai-editing/rules/rule-based-editor";
import type {
  EditProvider,
  EditProviderInput,
  EditProviderResult,
} from "@/features/ai-editing/types";

export const ruleBasedEditProvider: EditProvider = {
  id: "rule-based",

  async editContent(input: EditProviderInput): Promise<EditProviderResult> {
    const edits = [applyRuleBasedEdit(input.target, input.prompt)];
    return { edits, source: "rule-based", warnings: [] };
  },
};
