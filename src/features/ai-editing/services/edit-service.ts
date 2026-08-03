// ---------------------------------------------------------------------------
// AI editing client service
// ---------------------------------------------------------------------------

import type { EditTarget, EditedSection } from "../types";

export interface AiEditResult {
  edits: EditedSection[];
  source: "gemini" | "rule-based";
  warnings: string[];
}

/**
 * Send an edit instruction for a section to POST /api/generate (mode "modify")
 * and return the revised sections.
 */
export async function runAiEdit(
  prompt: string,
  target: EditTarget,
): Promise<AiEditResult> {
  if (!prompt.trim()) {
    throw new Error("Prompt cannot be empty");
  }

  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, mode: "modify", target }),
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error?.message || "Edit failed");
  }

  return {
    edits: data.edits as EditedSection[],
    source: data.source as "gemini" | "rule-based",
    warnings: data.warnings as string[],
  };
}

/**
 * Build the final assistant summary for an applied edit.
 *
 * @param changedCount Number of edits that actually changed content. When
 *                     zero, the summary says the content was left unchanged
 *                     (e.g. the AI output was invalid and the original kept).
 */
export function buildEditSummary(
  target: EditTarget,
  result: AiEditResult,
  changedCount: number,
): string {
  const label = target.label ?? "section";

  if (changedCount === 0) {
    return `I reviewed the ${label} — the current content already fits, so I left it unchanged.`;
  }

  const noun = changedCount === 1 ? "change" : "changes";
  if (result.source === "gemini") {
    return `I updated the ${label} — ${changedCount} ${noun} applied. Select it in the preview to fine-tune further.`;
  }

  return `I updated the ${label} using Buildora's local editor because Gemini was unavailable — ${changedCount} ${noun} applied.`;
}
