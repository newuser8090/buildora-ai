// ---------------------------------------------------------------------------
// Planner orchestrator — server-side plan-edit flow
//
// Mirrors the Phase K edit orchestrator: try Gemini first (unless forced
// local), fall back to the deterministic rule-based planner on any failure,
// then validate the resulting plan through the canonical schemas and the
// pure simulator. The client only ever receives a fully validated plan.
//
// The orchestrator NEVER mutates the input project and NEVER persists.
// ---------------------------------------------------------------------------

import type {
  AiEditPlan,
  AiEditPlanError,
  AiEditPlanner,
  AiEditPlannerInput,
  AiEditPlannerResult,
} from "../plan-types";
import { AiEditPlanSchema, PLAN_LIMITS } from "../schemas/plan-schemas";
import { simulatePlan } from "./plan-simulator";

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface PlannerOrchestratorDeps {
  /** Optional Gemini planner — when absent or forceLocal, rule-based is used. */
  gemini?: AiEditPlanner;
  ruleBased: AiEditPlanner;
  forceLocal?: boolean;
  /** Logger hook for observability (defaults to no-op). */
  log?: (level: "info" | "warn", msg: string) => void;
}

export type PlanOrchestrationResult =
  | {
      ok: true;
      source: "gemini" | "rule-based";
      plan: AiEditPlan;
      warnings: string[];
    }
  | { ok: false; error: AiEditPlanError; warnings?: string[] };

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Cap the serialized plan payload (documented safe size). */
function planTooLarge(plan: AiEditPlan): boolean {
  try {
    return JSON.stringify(plan).length > PLAN_LIMITS.maxPlanJsonBytes;
  } catch {
    return true;
  }
}

interface PlanValidation {
  ok: boolean;
  plan?: AiEditPlan;
  message?: string;
}

/**
 * Validate a candidate plan against the schema plus the request invariants:
 * project id match, base revision match, scope match. Unknown fields are
 * stripped by zod.
 */
function validatePlan(plan: AiEditPlan, input: AiEditPlannerInput): PlanValidation {
  const parsed = AiEditPlanSchema.safeParse(plan);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues
        .map((i) => i.path.join(".") + ": " + i.message)
        .join("; "),
    };
  }
  const validated = parsed.data as AiEditPlan;

  if (validated.projectId !== input.project.id) {
    return { ok: false, message: `Plan projectId "${validated.projectId}" does not match "${input.project.id}".` };
  }
  if (validated.baseRevision !== input.baseRevision) {
    return {
      ok: false,
      message: `Plan baseRevision ${validated.baseRevision} does not match the requested revision ${input.baseRevision}.`,
    };
  }
  if (JSON.stringify(validated.scope) !== JSON.stringify(input.scope)) {
    return { ok: false, message: "Plan scope does not match the requested scope." };
  }
  if (planTooLarge(validated)) {
    return { ok: false, message: `Plan exceeds the ${PLAN_LIMITS.maxPlanJsonBytes}-byte size limit.` };
  }

  return { ok: true, plan: validated };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function orchestratePlan(
  input: AiEditPlannerInput,
  deps: PlannerOrchestratorDeps,
): Promise<PlanOrchestrationResult> {
  const log = deps.log ?? (() => {});
  const allWarnings: string[] = [];

  const providers: AiEditPlanner[] =
    deps.forceLocal || !deps.gemini ? [deps.ruleBased] : [deps.gemini, deps.ruleBased];

  for (const provider of providers) {
    const isGemini = provider.id === "gemini";

    let result: AiEditPlannerResult;
    try {
      if (isGemini) log("info", "Plan-edit — attempting Gemini planner...");
      result = await provider.createPlan(input);
    } catch (err) {
      allWarnings.push(
        `${isGemini ? "Gemini" : "Planner"} failed: ${(err as Error)?.message ?? "unknown error"}`,
      );
      log("warn", `Plan provider "${provider.id}" threw: ${(err as Error)?.message}`);
      continue;
    }

    if (!result.ok) {
      allWarnings.push(...(result.warnings ?? []));
      allWarnings.push(
        `${isGemini ? "Gemini" : "Planner"} returned no plan: ${result.error.message}`,
      );
      log("warn", `Plan provider "${provider.id}" returned no plan: ${result.error.message}`);
      continue;
    }

    const validation = validatePlan(result.plan, input);
    if (!validation.ok) {
      allWarnings.push(
        `${isGemini ? "Gemini" : "Planner"} plan is invalid: ${validation.message}`,
      );
      log("warn", `Plan provider "${provider.id}" produced an invalid plan: ${validation.message}`);
      continue;
    }
    if (!validation.plan) continue;

    // Simulate the whole plan against the provided project snapshot — the
    // server never presents an un-simulatable plan.
    const simulation = simulatePlan(input.project, validation.plan.operations, {
      captureSnapshots: false,
    });
    if (!simulation.ok) {
      allWarnings.push(
        `${isGemini ? "Gemini" : "Planner"} plan failed simulation: ${simulation.error.message}`,
      );
      log("warn", `Plan provider "${provider.id}" plan failed simulation: ${simulation.error.message}`);
      continue;
    }

    if (validation.plan.operations.length === 0) {
      allWarnings.push("The plan contains no operations — no changes to apply.");
      return {
        ok: false,
        error: { code: "PLAN_NO_CHANGES", message: "The AI could not determine any changes from that instruction." },
        warnings: allWarnings,
      };
    }

    // Merge simulation warnings (e.g. dropped asset refs) into the plan.
    const finalPlan: AiEditPlan = {
      ...validation.plan,
      warnings: [...validation.plan.warnings, ...simulation.warnings],
    };

    log(
      "info",
      `Plan-edit success via "${provider.id}" — ${finalPlan.operations.length} operation(s)`,
    );
    return {
      ok: true,
      source: isGemini ? "gemini" : "rule-based",
      plan: finalPlan,
      warnings: allWarnings,
    };
  }

  log("warn", "All plan providers failed");
  return {
    ok: false,
    error: {
      code: "PLAN_PROVIDER_FAILED",
      message: "The AI planner could not produce a valid plan. Please try a different instruction.",
    },
    warnings: allWarnings,
  };
}
