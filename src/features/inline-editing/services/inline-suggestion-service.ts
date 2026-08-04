// ---------------------------------------------------------------------------
// Inline editing — client suggestion service
//
// Sends a one-field instruction to POST /api/generate (mode "inline-edit")
// and returns the validated suggestion. Never applies anything automatically.
// ---------------------------------------------------------------------------

import type {
  InlineAiError,
  InlineAiSuggestion,
  InlineSuggestionInput,
} from "../types";

export interface InlineSuggestionClientResult {
  source: "gemini" | "rule-based";
  suggestion: InlineAiSuggestion;
  warnings: string[];
}

export class InlineSuggestionClientError extends Error {
  readonly code: InlineAiError["code"];
  constructor(error: InlineAiError) {
    super(error.message);
    this.name = "InlineSuggestionClientError";
    this.code = error.code;
  }
}

/**
 * Request a validated one-field suggestion.
 */
export async function runInlineSuggestion(
  input: InlineSuggestionInput,
): Promise<InlineSuggestionClientResult> {
  if (!input.instruction.trim()) {
    throw new Error("Instruction cannot be empty");
  }

  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "inline-edit", ...input }),
  });

  let data: {
    ok?: boolean;
    source?: "gemini" | "rule-based";
    suggestion?: InlineAiSuggestion;
    warnings?: string[];
    error?: InlineAiError;
  };
  try {
    data = await response.json();
  } catch {
    throw new Error("The AI returned an unreadable response.");
  }

  if (!data.ok || !data.suggestion) {
    throw new InlineSuggestionClientError(
      data.error ?? {
        code: "INLINE_SUGGESTION_FAILED",
        message: "I couldn't produce a suggestion. Please try again.",
      },
    );
  }

  return {
    source: data.source ?? data.suggestion.provider,
    suggestion: data.suggestion,
    warnings: data.warnings ?? [],
  };
}
