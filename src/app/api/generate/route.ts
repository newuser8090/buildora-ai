import { NextResponse } from "next/server";
import { generateProject } from "@/features/generation/generators/project-generator";
import { geminiProvider } from "@/features/generation/providers/gemini-generation-provider";
import { ruleBasedProvider } from "@/features/generation/providers/rule-based-generation-provider";
import { geminiEditProvider } from "@/features/generation/providers/gemini-edit-provider";
import { ruleBasedEditProvider } from "@/features/generation/providers/rule-based-edit-provider";
import { geminiPlanProvider } from "@/features/ai-editing/planner/gemini-plan-provider";
import { ruleBasedPlanner } from "@/features/ai-editing/planner/rule-based-planner";
import { orchestratePlan } from "@/features/ai-editing/services/planner-orchestrator";
import { logger } from "@/lib/logger";
import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import { AnySectionSchema } from "@/features/editor/schemas/section-schemas";
import {
  EditTargetSchema,
  type ValidatedEditTarget,
} from "@/features/ai-editing/schemas/edit-schemas";
import { orchestrateEdit } from "@/features/ai-editing/services/edit-orchestrator";
import {
  PlanEditRequestSchema,
  type ValidatedPlanEditRequest,
} from "@/features/ai-editing/schemas/plan-schemas";
import {
  InlineEditRequestSchema,
  type ValidatedInlineEditRequest,
} from "@/features/inline-editing/schemas/inline-schemas";
import { orchestrateInlineSuggestion } from "@/features/inline-editing/services/inline-orchestrator";
import { geminiInlineProvider } from "@/features/inline-editing/providers/gemini-inline-provider";
import { ruleBasedInlineProvider } from "@/features/inline-editing/providers/rule-based-inline-provider";
import type { Project } from "@/types/project";
import {
  generateRateLimited,
  clientKeyForRequest,
  generateRateLimitEnabled,
  isTestForceLocalHeader,
} from "@/features/generation/server/generate-rate-limit";

// ---------------------------------------------------------------------------
// Request validation schema
// ---------------------------------------------------------------------------

type GenerateRequest =
  | { kind: "create"; prompt: string }
  | { kind: "modify"; prompt: string; target: ValidatedEditTarget }
  | { kind: "plan-edit"; request: ValidatedPlanEditRequest }
  | { kind: "inline-edit"; request: ValidatedInlineEditRequest };

const MAX_PROMPT_LENGTH = 4000;
/** Raw request body cap — protects the plan-edit path (projects can be large). */
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

type ValidationResult = GenerateRequest | { kind: "invalid"; message: string };

/**
 * Test-only escape hatch: honors `x-buildora-force-local` in development /
 * test only (Phase P20 — release hardening). Implementation lives in
 * generate-rate-limit.ts (exported for unit-testing the production path).
 */
const forceLocalHeader = isTestForceLocalHeader;

function validateRequest(body: unknown): ValidationResult {
  if (!body || typeof body !== "object") {
    return { kind: "invalid", message: "Invalid request body" };
  }

  const { prompt, mode, target } = body as Record<string, unknown>;

  if (mode === "plan-edit") {
    const planResult = PlanEditRequestSchema.safeParse(body);
    if (!planResult.success) {
      const issues = planResult.error.issues
        .map((i) => i.path.join(".") + ": " + i.message)
        .join("; ");
      return { kind: "invalid", message: `Invalid plan-edit request: ${issues}` };
    }
    return { kind: "plan-edit", request: planResult.data };
  }

  if (mode === "inline-edit") {
    const inlineResult = InlineEditRequestSchema.safeParse(body);
    if (!inlineResult.success) {
      const issues = inlineResult.error.issues
        .map((i) => i.path.join(".") + ": " + i.message)
        .join("; ");
      return { kind: "invalid", message: `Invalid inline-edit request: ${issues}` };
    }
    return { kind: "inline-edit", request: inlineResult.data };
  }

  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return { kind: "invalid", message: "Prompt is required" };
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return { kind: "invalid", message: `Prompt must be ${MAX_PROMPT_LENGTH} characters or less` };
  }

  if (mode !== undefined && mode !== "create" && mode !== "modify") {
    return { kind: "invalid", message: 'Mode must be "create", "modify", "plan-edit" or "inline-edit"' };
  }

  if (mode === "modify") {
    const targetResult = EditTargetSchema.safeParse(target);
    if (!targetResult.success) {
      const issues = targetResult.error.issues
        .map((i) => i.path.join(".") + ": " + i.message)
        .join("; ");
      return { kind: "invalid", message: `Invalid edit target: ${issues}` };
    }
    return { kind: "modify", prompt: prompt.trim(), target: targetResult.data };
  }

  return { kind: "create", prompt: prompt.trim() };
}

// ---------------------------------------------------------------------------
// Validate all sections in a project against section-specific schemas
// ---------------------------------------------------------------------------

function validateProjectSections(project: Project): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  for (const page of project.pages) {
    for (const section of page.sections) {
      const result = AnySectionSchema.safeParse(section);
      if (!result.success) {
        issues.push(
          `Section "${section.id}" (${section.type}): ${result.error.issues.map(
            (i) => i.path.slice(2).join(".") + ": " + i.message
          ).join("; ")}`
        );
      }
    }
  }
  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// POST /api/generate
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    // 0. Production rate limit (Phase P20 — release hardening). The generate
    // route is the one production API surface that calls a PAID provider
    // (Gemini) with a server-side key, and it is unauthenticated by design.
    // Enforced in production only (dev/E2E is a local/testing surface and
    // the matrix suite issues many requests); the ceiling is generous enough
    // to never trip a human and tight enough to bound a flood.
    if (generateRateLimitEnabled() && generateRateLimited(clientKeyForRequest(request))) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "RATE_LIMITED", message: "Too many requests. Try again shortly." },
        },
        { status: 429 },
      );
    }

    // 1. Parse and validate request (raw-text read so we can enforce a body cap)
    let body: unknown;
    try {
      const rawBody = await request.text();
      if (rawBody.length > MAX_REQUEST_BYTES) {
        return NextResponse.json(
          {
            success: false,
            error: { code: "REQUEST_TOO_LARGE", message: "Request body is too large." },
          },
          { status: 413 },
        );
      }
      body = rawBody.length > 0 ? JSON.parse(rawBody) : {};
    } catch {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON in request body" } },
        { status: 400 },
      );
    }

    const validated = validateRequest(body);
    if (validated.kind === "invalid") {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: validated.message } },
        { status: 400 },
      );
    }

    // ---- Plan-edit mode (Phase L): produce a validated, previewable plan ----
    if (validated.kind === "plan-edit") {
      return handlePlanEdit(validated.request, request, startTime);
    }

    // ---- Inline-edit mode (Phase M): one-field quick suggestion ----
    if (validated.kind === "inline-edit") {
      return handleInlineEdit(validated.request, request, startTime);
    }

    // ---- Modify mode (Phase K): revise a section's content ----
    if (validated.kind === "modify") {
      return handleModify(validated.target, validated.prompt, request, startTime);
    }

    const prompt = validated.prompt;

    const forceLocal =
      process.env.BUILDORA_FORCE_LOCAL_GENERATION === "true" ||
      forceLocalHeader(request);

    // 3. Select provider
    let source: "gemini" | "rule-based" = "gemini";
    const warnings: string[] = [];
    let project: Project;

    if (forceLocal) {
      logger.info("API", "BUILDORA_FORCE_LOCAL_GENERATION=true — skipping Gemini");
      source = "rule-based";
      const localResult = await ruleBasedProvider.generatePlan({ prompt });
      warnings.push(...localResult.warnings);
      project = generateProject(localResult.plan);
      logger.info(
        "API",
        `Rule-based (forced) success (${Date.now() - startTime}ms) — ${localResult.plan.sections.length} sections`,
      );
    } else {
      // 3a. Try Gemini provider
      try {
        logger.info("API", "Attempting Gemini generation...");
        const geminiResult = await geminiProvider.generatePlan({ prompt });
        source = "gemini";
        warnings.push(...geminiResult.warnings);

        // Generate project from plan
        project = generateProject(geminiResult.plan);

        logger.info(
          "API",
          `Gemini success (${Date.now() - startTime}ms) — ${geminiResult.plan.sections.length} sections`,
        );
      } catch (geminiError) {
        // 3b. Fallback to rule-based
        logger.warn(
          "API",
          `Gemini failed, falling back to rule-based: ${(geminiError as Error)?.message}`,
        );
        source = "rule-based";

        const fallbackResult = await ruleBasedProvider.generatePlan({ prompt });
        warnings.push(...fallbackResult.warnings);

        // Generate project from plan
        project = generateProject(fallbackResult.plan);

        logger.info(
          "API",
          `Rule-based fallback success (${Date.now() - startTime}ms)`,
        );
      }
    }

    // 4. Validate generated project (structural)
    const projectValidation = ProjectSchema.safeParse(project);
    if (!projectValidation.success) {
      logger.error("API", "Project validation failed", {
        issues: projectValidation.error.issues.map(
          (i) => i.path.join(".") + ": " + i.message,
        ),
      });
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "PROJECT_VALIDATION_FAILED",
            message: "Generated project failed validation",
          },
        },
        { status: 500 },
      );
    }

    // 5. Validate all sections against section-specific schemas
    const sectionValidation = validateProjectSections(project);
    if (!sectionValidation.valid) {
      logger.warn("API", "Section validation issues found", sectionValidation.issues);
      warnings.push(...sectionValidation.issues.map(i => `Section validation: ${i}`));
    }

    // 6. Return success
    return NextResponse.json({
      success: true,
      source,
      project: projectValidation.data,
      warnings,
    });
  } catch (err) {
    logger.error("API", "Unexpected error", (err as Error)?.message);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Generation failed",
        },
      },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Modify mode — AI editing of a section's content (Phase K, unchanged)
// ---------------------------------------------------------------------------

async function handleModify(
  target: ValidatedEditTarget,
  prompt: string,
  request: Request,
  startTime: number,
) {
  const forceLocal =
    process.env.BUILDORA_FORCE_LOCAL_GENERATION === "true" ||
    forceLocalHeader(request);

  const { source, edits, warnings } = await orchestrateEdit(target, prompt, {
    gemini: geminiEditProvider,
    ruleBased: ruleBasedEditProvider,
    forceLocal,
    log: (level, msg) => logger[level]("API", msg),
  });

  logger.info(
    "API",
    `Modify success (${Date.now() - startTime}ms) — ${edits.length} edit(s)`,
  );

  return NextResponse.json({
    success: true,
    source,
    edits,
    warnings,
  });
}

// ---------------------------------------------------------------------------
// Plan-edit mode — validated, previewable AI edit plan (Phase L)
// ---------------------------------------------------------------------------

async function handlePlanEdit(
  request: ValidatedPlanEditRequest,
  httpRequest: Request,
  startTime: number,
) {
  const forceLocal =
    process.env.BUILDORA_FORCE_LOCAL_GENERATION === "true" ||
    forceLocalHeader(httpRequest);

  const result = await orchestratePlan(
    {
      instruction: request.instruction,
      scope: request.scope,
      project: request.project,
      selectedPageId: request.selectedPageId,
      selectedSectionId: request.selectedSectionId,
      baseRevision: request.baseRevision,
    },
    {
      gemini: geminiPlanProvider,
      ruleBased: ruleBasedPlanner,
      forceLocal,
      log: (level, msg) => logger[level]("API", msg),
    },
  );

  if (!result.ok) {
    logger.info(
      "API",
      `Plan-edit declined (${Date.now() - startTime}ms) — ${result.error.code}: ${result.error.message}`,
    );
    return NextResponse.json({
      ok: false,
      error: result.error,
      warnings: result.warnings ?? [],
    });
  }

  logger.info(
    "API",
    `Plan-edit success (${Date.now() - startTime}ms) via ${result.source} — ${result.plan.operations.length} operation(s)`,
  );

  return NextResponse.json({
    ok: true,
    source: result.source,
    plan: result.plan,
    warnings: result.warnings,
  });
}

// ---------------------------------------------------------------------------
// Inline-edit mode — one-field quick suggestion (Phase M)
// ---------------------------------------------------------------------------

async function handleInlineEdit(
  request: ValidatedInlineEditRequest,
  httpRequest: Request,
  startTime: number,
) {
  const forceLocal =
    process.env.BUILDORA_FORCE_LOCAL_GENERATION === "true" ||
    forceLocalHeader(httpRequest);

  const result = await orchestrateInlineSuggestion(
    {
      instruction: request.instruction,
      projectId: request.projectId,
      baseRevision: request.baseRevision,
      pageId: request.pageId,
      sectionId: request.sectionId,
      sectionType: request.sectionType,
      fieldPath: request.fieldPath,
      fieldKind: request.fieldKind,
      currentValue: request.currentValue,
      surroundingContext: request.surroundingContext,
      variant: request.variant,
    },
    {
      gemini: geminiInlineProvider,
      ruleBased: ruleBasedInlineProvider,
      forceLocal,
      log: (level, msg) => logger[level]("API", msg),
    },
  );

  if (!result.ok) {
    logger.info(
      "API",
      `Inline-edit declined (${Date.now() - startTime}ms) — ${result.error.code}: ${result.error.message}`,
    );
    return NextResponse.json({
      ok: false,
      error: result.error,
      warnings: result.warnings ?? [],
    });
  }

  logger.info(
    "API",
    `Inline-edit success (${Date.now() - startTime}ms) via ${result.source}`,
  );

  return NextResponse.json({
    ok: true,
    source: result.source,
    suggestion: result.suggestion,
    warnings: result.warnings,
  });
}

// ---------------------------------------------------------------------------
// Unsupported methods
// ---------------------------------------------------------------------------

export async function GET() {
  return NextResponse.json(
    { success: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST" } },
    { status: 405 },
  );
}
