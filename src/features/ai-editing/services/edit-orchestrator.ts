// ---------------------------------------------------------------------------
// Edit orchestrator — server-side AI-editing flow
//
// Extracted from the API route so the modify flow (provider selection,
// Gemini fallback, per-type validation) is unit-testable without an HTTP
// server. The route calls orchestrateEdit with the real providers.
// ---------------------------------------------------------------------------

import { AnySectionSchema } from "@/features/editor/schemas/section-schemas";
import type { ValidatedEditTarget } from "@/features/ai-editing/schemas/edit-schemas";
import type { EditedSection, EditProvider } from "@/features/ai-editing/types";

export interface EditOrchestratorDeps {
  /** Optional Gemini provider — when absent or forceLocal, rule-based is used. */
  gemini?: EditProvider;
  ruleBased: EditProvider;
  forceLocal?: boolean;
  /** Logger hook for observability (defaults to no-op). */
  log?: (level: "info" | "warn", msg: string) => void;
}

export interface EditOrchestrationResult {
  source: "gemini" | "rule-based";
  edits: EditedSection[];
  warnings: string[];
}

/**
 * Run an edit: try the Gemini provider (unless force-local), fall back to the
 * rule-based editor on failure, and validate every edit against the per-type
 * section schema. Invalid edits fall back to the original props so a bad
 * model response never corrupts the project.
 */
export async function orchestrateEdit(
  target: ValidatedEditTarget,
  prompt: string,
  deps: EditOrchestratorDeps,
): Promise<EditOrchestrationResult> {
  const log = deps.log ?? (() => {});
  let source: "gemini" | "rule-based";
  const warnings: string[] = [];
  let edits: EditedSection[];

  if (deps.forceLocal || !deps.gemini) {
    log("info", "Modify — using rule-based editor");
    source = "rule-based";
    const localResult = await deps.ruleBased.editContent({ prompt, target });
    edits = localResult.edits;
    warnings.push(...localResult.warnings);
  } else {
    try {
      log("info", "Attempting Gemini edit...");
      const geminiResult = await deps.gemini.editContent({ prompt, target });
      source = "gemini";
      edits = geminiResult.edits;
      warnings.push(...geminiResult.warnings);
    } catch (geminiError) {
      log("warn", `Gemini edit failed, falling back to rule-based: ${(geminiError as Error)?.message}`);
      source = "rule-based";
      const fallbackResult = await deps.ruleBased.editContent({ prompt, target });
      edits = fallbackResult.edits;
      warnings.push(...fallbackResult.warnings);
    }
  }

  // Validate every edit against the per-type section schema. Wrong-type or
  // schema-invalid edits fall back to the original props (unchanged content)
  // with a warning, so a bad model response never corrupts the project.
  const validatedEdits = edits.map((edit) => {
    if (edit.type !== target.type) {
      warnings.push(
        `Edited section type "${edit.type}" does not match target "${target.type}" — keeping original content`,
      );
      return { type: target.type, props: { ...target.props } };
    }

    const sectionLike = {
      id: target.sectionId,
      type: edit.type,
      order: 1,
      visible: true,
      props: edit.props,
      styles: {},
    };
    const result = AnySectionSchema.safeParse(sectionLike);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => i.path.slice(2).join(".") + ": " + i.message)
        .join("; ");
      warnings.push(`Edited section validation: ${issues}`);
      return { type: target.type, props: { ...target.props } };
    }
    return { type: edit.type, props: result.data.props };
  });

  return { source, edits: validatedEdits, warnings };
}
