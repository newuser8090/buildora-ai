import { NextResponse } from "next/server";
import { generateProject } from "@/features/generation/generators/project-generator";
import { geminiProvider } from "@/features/generation/providers/gemini-generation-provider";
import { ruleBasedProvider } from "@/features/generation/providers/rule-based-generation-provider";
import { geminiEditProvider } from "@/features/generation/providers/gemini-edit-provider";
import { ruleBasedEditProvider } from "@/features/generation/providers/rule-based-edit-provider";
import { logger } from "@/lib/logger";
import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import { AnySectionSchema } from "@/features/editor/schemas/section-schemas";
import {
  EditTargetSchema,
  type ValidatedEditTarget,
} from "@/features/ai-editing/schemas/edit-schemas";
import { orchestrateEdit } from "@/features/ai-editing/services/edit-orchestrator";
import type { Project } from "@/types/project";

// ---------------------------------------------------------------------------
// Request validation schema
// ---------------------------------------------------------------------------

interface GenerateRequest {
  prompt: string;
  mode: "create" | "modify";
  target?: ValidatedEditTarget;
}

const MAX_PROMPT_LENGTH = 4000;

function validateRequest(body: unknown): GenerateRequest | string {
  if (!body || typeof body !== "object") {
    return "Invalid request body";
  }

  const { prompt, mode, target } = body as Record<string, unknown>;

  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return "Prompt is required";
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return `Prompt must be ${MAX_PROMPT_LENGTH} characters or less`;
  }

  if (mode !== undefined && mode !== "create" && mode !== "modify") {
    return 'Mode must be "create" or "modify"';
  }

  if (mode === "modify") {
    const targetResult = EditTargetSchema.safeParse(target);
    if (!targetResult.success) {
      const issues = targetResult.error.issues
        .map((i) => i.path.join(".") + ": " + i.message)
        .join("; ");
      return `Invalid edit target: ${issues}`;
    }
    return { prompt: prompt.trim(), mode: "modify", target: targetResult.data };
  }

  return { prompt: prompt.trim(), mode: "create" };
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
    // 1. Parse and validate request
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON in request body" } },
        { status: 400 },
      );
    }

    const validated = validateRequest(body);
    if (typeof validated === "string") {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: validated } },
        { status: 400 },
      );
    }

    const { prompt, mode, target } = validated;

    // ---- Modify mode (AI editing): revise a section's content ----
    if (mode === "modify" && target) {
      return handleModify(target, prompt, request, startTime);
    }

    // 2. Check force-local flag (server-only env var, never exposed to client)
    // Test header x-buildora-force-local accepted for integration testing
    const forceLocal =
      process.env.BUILDORA_FORCE_LOCAL_GENERATION === "true" ||
      request.headers.get("x-buildora-force-local") === "true";

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
// Modify mode — AI editing of a section's content
// ---------------------------------------------------------------------------

async function handleModify(
  target: ValidatedEditTarget,
  prompt: string,
  request: Request,
  startTime: number,
) {
  const forceLocal =
    process.env.BUILDORA_FORCE_LOCAL_GENERATION === "true" ||
    request.headers.get("x-buildora-force-local") === "true";

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
// Unsupported methods
// ---------------------------------------------------------------------------

export async function GET() {
  return NextResponse.json(
    { success: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST" } },
    { status: 405 },
  );
}
