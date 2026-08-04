// ---------------------------------------------------------------------------
// AI editing — client plan service
//
// Sends a plan-edit instruction to POST /api/generate (mode "plan-edit") and
// returns the validated plan. Also builds the rich chat summaries shown in
// the AI Assistant timeline (spec §21).
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import type {
  AiEditPlan,
  AiEditPlanError,
  AiEditScope,
} from "../plan-types";
import { scopeLabel } from "../plan-types";

export interface PlanEditRequest {
  instruction: string;
  scope: AiEditScope;
  project: Project;
  selectedPageId?: string;
  selectedSectionId?: string;
  baseRevision: number;
}

export interface PlanEditClientResult {
  source: "gemini" | "rule-based";
  plan: AiEditPlan;
  warnings: string[];
}

export class PlanEditClientError extends Error {
  readonly code: string;
  constructor(error: AiEditPlanError) {
    super(error.message);
    this.name = "PlanEditClientError";
    this.code = error.code;
  }
}

/**
 * Request a validated edit plan for a page or project scope.
 */
export async function runPlanEdit(
  input: PlanEditRequest,
): Promise<PlanEditClientResult> {
  if (!input.instruction.trim()) {
    throw new Error("Instruction cannot be empty");
  }

  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "plan-edit", ...input }),
  });

  let data: {
    ok?: boolean;
    plan?: AiEditPlan;
    source?: "gemini" | "rule-based";
    warnings?: string[];
    error?: AiEditPlanError;
  };
  try {
    data = await response.json();
  } catch {
    throw new Error("The AI planner returned an unreadable response.");
  }

  if (!data.ok || !data.plan) {
    throw new PlanEditClientError(
      data.error ?? {
        code: "PLAN_REQUEST_INVALID",
        message: "The AI planner could not prepare a plan. Please try again.",
      },
    );
  }

  return {
    source: data.source ?? data.plan.provider,
    plan: data.plan,
    warnings: data.warnings ?? [],
  };
}

// ---------------------------------------------------------------------------
// Chat summary builders
// ---------------------------------------------------------------------------

/** Chat message when a plan is ready for review (never auto-applied). */
export function buildPlanPreparedSummary(
  plan: AiEditPlan,
  source: "gemini" | "rule-based",
): string {
  const count = plan.operations.length;
  const target = scopeLabel(plan.scope);
  const providerNote =
    source === "rule-based"
      ? " I used Buildora's local planner because Gemini was unavailable."
      : "";
  const destructiveCount = plan.operations.filter((o) => o.risk === "high").length;
  const destructiveNote =
    destructiveCount > 0
      ? ` ${destructiveCount} destructive change${destructiveCount === 1 ? "" : "s"} need your confirmation.`
      : "";

  return `I prepared ${count} proposed change${count === 1 ? "" : "s"} for the ${target} — review them before applying.${destructiveNote}${providerNote}`;
}

/** Chat message after a plan is applied. */
export function buildPlanAppliedSummary(
  plan: AiEditPlan,
  applied: number,
  skipped: number,
  source: "gemini" | "rule-based",
  warnings: string[],
): string {
  const lines: string[] = [];

  if (applied === 0) {
    lines.push("No changes were applied — the selected plan had nothing to apply.");
  } else {
    const appliedOps = plan.operations.slice(0, applied);
    lines.push(`Applied ${applied} change${applied === 1 ? "" : "s"}:`);
    for (const op of appliedOps) {
      lines.push(`- ${op.label}`);
    }
    if (skipped > 0) {
      lines.push(`Skipped ${skipped} change${skipped === 1 ? "" : "s"}.`);
    }
  }

  if (source === "rule-based") {
    lines.push("Used Buildora's local planner because Gemini was unavailable.");
  }
  const fallbackWarnings = warnings.filter(
    (w) => /local|fallback|gemini unavailable/i.test(w),
  );
  if (fallbackWarnings.length > 0) {
    lines.push(`Note: ${fallbackWarnings[0]}`);
  }

  return lines.join("\n");
}

/** Chat message when the plan is stale (project changed since creation). */
export function buildStalePlanSummary(plan: AiEditPlan): string {
  return `This project changed since the plan was created, so I didn't apply the ${plan.operations.length} proposed change(s). Regenerate the plan against the current state, or discard it.`;
}
