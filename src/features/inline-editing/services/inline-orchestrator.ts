// ---------------------------------------------------------------------------
// Inline suggestion orchestrator — server-side inline-edit flow
//
// Mirrors the Phase K/L orchestrators: try Gemini first (unless forced local),
// fall back to the deterministic rule-based provider on any failure, then
// validate + clamp the resulting suggestion. The client only ever receives a
// fully validated suggestion. The orchestrator NEVER mutates any project.
// ---------------------------------------------------------------------------

import type {
  InlineOrchestrationResult,
  InlineSuggestionInput,
  InlineSuggestionProvider,
} from "../types";
import { INLINE_LIMITS, InlineSuggestionPayloadSchema } from "../schemas/inline-schemas";
import {
  getFieldDefinitions,
  isSupportedFieldPath,
} from "../registry/editable-field-registry";
import type { SectionType } from "@/features/editor/section-library/types";

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface InlineOrchestratorDeps {
  /** Optional Gemini provider — when absent or forceLocal, rule-based is used. */
  gemini?: InlineSuggestionProvider;
  ruleBased: InlineSuggestionProvider;
  forceLocal?: boolean;
  /** Logger hook for observability (defaults to no-op). */
  log?: (level: "info" | "warn", msg: string) => void;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Reject HTML/script-bearing suggestions outright. */
function containsExecutableContent(value: string): boolean {
  return /<\s*(script|iframe|object|embed|style|link|img|svg)\b/i.test(value);
}

function clampSuggestion(
  value: string,
  maxLength?: number,
): string {
  const cap = maxLength ?? INLINE_LIMITS.maxSuggestionLength;
  if (value.length <= cap) return value;
  let cut = value.slice(0, Math.max(1, cap - 1));
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > cap * 0.5) cut = cut.slice(0, lastSpace);
  return `${cut.trim()}…`;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function orchestrateInlineSuggestion(
  input: InlineSuggestionInput,
  deps: InlineOrchestratorDeps,
): Promise<InlineOrchestrationResult> {
  const log = deps.log ?? (() => {});
  const warnings: string[] = [];

  // 1. Reject unregistered field paths server-side (defense in depth).
  if (!isSupportedFieldPath(input.sectionType, input.fieldPath)) {
    return {
      ok: false,
      error: {
        code: "INLINE_FIELD_PATH_INVALID",
        message: `Field path "${input.fieldPath.join(".")}" is not a registered editable field on "${input.sectionType}" sections.`,
      },
      warnings,
    };
  }

  const providers: InlineSuggestionProvider[] =
    deps.forceLocal || !deps.gemini ? [deps.ruleBased] : [deps.gemini, deps.ruleBased];

  for (const provider of providers) {
    const isGemini = provider.id === "gemini";
    let result;
    try {
      if (isGemini) log("info", "Inline suggestion — attempting Gemini...");
      result = await provider.suggest(input);
    } catch (err) {
      warnings.push(
        `${isGemini ? "Gemini" : "Planner"} failed: ${(err as Error)?.message ?? "unknown error"}`,
      );
      log("warn", `Inline provider "${provider.id}" threw: ${(err as Error)?.message}`);
      continue;
    }

    if (!result.ok) {
      warnings.push(...(result.warnings ?? []));
      warnings.push(
        `${isGemini ? "Gemini" : "Planner"} returned no suggestion: ${result.error.message}`,
      );
      log("warn", `Inline provider "${provider.id}" returned no suggestion: ${result.error.message}`);
      continue;
    }

    // 2. Validate the payload shape.
    const payload = InlineSuggestionPayloadSchema.safeParse(result.suggestion);
    if (!payload.success) {
      warnings.push(
        `${isGemini ? "Gemini" : "Planner"} suggestion is invalid — falling back.`,
      );
      log("warn", `Inline provider "${provider.id}" produced an invalid suggestion payload`);
      continue;
    }

    // 3. Clamp to the field's registered max length and reject executable content.
    const fieldDef = getFieldDefinitions(input.sectionType).find((def) => {
      if (def.path.length !== input.fieldPath.length) return false;
      return def.path.every((segment, i) => {
        if (segment === "*") return typeof input.fieldPath[i] === "number";
        return input.fieldPath[i] === segment;
      });
    });
    const suggestedValue = clampSuggestion(payload.data.suggestedValue, fieldDef?.maxLength);
    if (containsExecutableContent(suggestedValue)) {
      warnings.push(
        `${isGemini ? "Gemini" : "Planner"} suggestion contained executable content — rejected.`,
      );
      log("warn", `Inline provider "${provider.id}" produced executable content`);
      continue;
    }

    if (suggestedValue.trim().length === 0) {
      warnings.push("Suggestion was empty after validation.");
      continue;
    }

    log("info", `Inline suggestion success via "${provider.id}"`);
    return {
      ok: true,
      source: isGemini ? "gemini" : "rule-based",
      suggestion: {
        id: `sug-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        projectId: input.projectId,
        baseRevision: input.baseRevision,
        pageId: input.pageId,
        sectionId: input.sectionId,
        // sectionType validated against the registry above (line ~30).
        // sectionType validated against the registry above (line ~30).
        sectionType: input.sectionType as SectionType,
        
        fieldPath: input.fieldPath,
        originalValue: input.currentValue,
        suggestedValue,
        instruction: input.instruction,
        explanation: payload.data.explanation,
        provider: isGemini ? "gemini" : "rule-based",
        createdAt: new Date().toISOString(),
      },
      warnings,
    };
  }

  log("warn", "All inline providers failed");
  return {
    ok: false,
    error: {
      code: "INLINE_SUGGESTION_FAILED",
      message: "I couldn't produce a suggestion. Please try a different instruction.",
    },
    warnings,
  };
}
