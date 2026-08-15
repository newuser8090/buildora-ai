import { NextResponse } from "next/server";
import { generateProject } from "@/features/generation/generators/project-generator";
import { geminiProvider } from "@/features/generation/providers/gemini-generation-provider";
import { ruleBasedProvider } from "@/features/generation/providers/rule-based-generation-provider";
import { detectSiteIntent } from "@/features/generation/analyzers/prompt-analyzer";
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
  RATE_WINDOW_SECONDS,
} from "@/features/generation/server/generate-rate-limit";

// ---------------------------------------------------------------------------
// Bounded diagnostic tokens (Phase P21 F3)
//
// The message channel is logged VERBATIM (even in production), so it must
// never carry raw provider/fetch error text (URLs, request echoes, provider
// internals). Only bounded identifiers are embedded: a ProviderError code
// (MISSING_API_KEY / PROVIDER_TIMEOUT / …) or a JS identifier (constructor
// name / typeof) — matching the P18/P19 "static template + bounded code"
// convention used by every other failure boundary.
// ---------------------------------------------------------------------------

/**
 * Bounded error token for diagnostics — never the raw error message.
 * Prefers an uppercase ProviderError code; falls back to the error's
 * constructor name / typeof (JS identifiers, hence bounded + non-sensitive).
 * Exported so the production path is unit-testable (route-private otherwise).
 */
export function boundedErrorToken(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9_]{1,64}$/.test(code)) {
      return code;
    }
  }
  const name =
    err instanceof Error && err.name
      ? err.name
      : err !== null && typeof err === "object" &&
          (err as { constructor?: { name?: string } }).constructor?.name
        ? (err as { constructor: { name: string } }).constructor.name
        : typeof err;
  return /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(name) ? name : "UNKNOWN";
}

// ---------------------------------------------------------------------------
// Request validation schema
// ---------------------------------------------------------------------------

type GenerateRequest =
  | { kind: "create"; prompt: string }
  | { kind: "site"; prompt: string }
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

  if (mode !== undefined && mode !== "create" && mode !== "modify" && mode !== "site") {
    return { kind: "invalid", message: 'Mode must be "create", "modify", "plan-edit", "inline-edit" or "site"' };
  }

  if (mode === "site") {
    return { kind: "site", prompt: prompt.trim() };
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
        // Phase P21 (F3) — standard operational hint so clients/operators know
        // when the window resets (matches the fixed-window length).
        { status: 429, headers: { "Retry-After": String(RATE_WINDOW_SECONDS) } },
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

    // Phase P22-I — site generation. Explicit mode:"site" or clear server-side
    // multi-page intent on an ordinary create request both route the provider
    // into site mode. Ordinary single-page create behavior is unchanged.
    const siteMode =
      validated.kind === "site" || detectSiteIntent(validated.prompt);
    const providerMode = siteMode ? ("site" as const) : ("create" as const);

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
      const localResult = await ruleBasedProvider.generatePlan({ prompt, mode: providerMode });
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
        const geminiResult = await geminiProvider.generatePlan({ prompt, mode: providerMode });
        source = "gemini";
        warnings.push(...geminiResult.warnings);

        // Generate project from plan
        project = generateProject(geminiResult.plan);

        logger.info(
          "API",
          `Gemini success (${Date.now() - startTime}ms) — ${geminiResult.plan.sections.length} sections`,
        );
      } catch (geminiError) {
        // 3b. Fallback to rule-based. Phase P21 (F3) — this failure is logged
        // at ERROR level (previously warn, which is DEV-ONLY) so a paid-
        // provider outage is visible to operators in production, and only a
        // BOUNDED code is embedded (never the raw provider message, which can
        // carry URLs / request echoes / provider internals).
        logger.error(
          "API",
          `Gemini failed, falling back to rule-based (${boundedErrorToken(geminiError)})`,
        );
        source = "rule-based";

        const fallbackResult = await ruleBasedProvider.generatePlan({ prompt, mode: providerMode });
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
    // Phase P21 (F3) — embed a bounded error-class token in the message so
    // the failure class survives production redaction (the previous raw
    // message string was dropped in production and dev-only otherwise).
    logger.error("API", `unexpected error (${boundedErrorToken(err)})`);

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
