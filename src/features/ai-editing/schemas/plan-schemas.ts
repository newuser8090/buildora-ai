// ---------------------------------------------------------------------------
// AI editing — Phase L plan schemas (Zod)
//
// Server-side authority for plan validation. Every requirement in the spec is
// enforced here or in the plan simulator:
//   - reject unknown operation types (discriminated union)
//   - reject missing identifiers
//   - reject malformed section objects / invalid section props / bad links
//   - reject invalid page titles and slugs
//   - reject unsupported section types and invalid indexes
//   - strip unknown fields (zod default)
//   - cap instruction length, operation count, plan size, inserted counts
//   - structured validation errors
// ---------------------------------------------------------------------------

import { z } from "zod";
import { SUPPORTED_SECTION_TYPES } from "@/features/generation/providers/generation-provider";
import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import {
  CtaSectionPropsSchema,
  FaqSectionPropsSchema,
  FeaturesSectionPropsSchema,
  FooterSectionPropsSchema,
  HeaderSectionPropsSchema,
  HeroSectionPropsSchema,
  PricingSectionPropsSchema,
} from "@/features/editor/schemas/section-schemas";
import { validatePageTitle } from "@/features/editor/store/page-structure";
import { validateSlug } from "@/features/routing/routes";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const PLAN_LIMITS = {
  maxInstructionLength: 5000,
  maxOperations: 30,
  maxInsertedPages: 5,
  maxInsertedSections: 20,
  maxPlanJsonBytes: 100_000,
  maxExplanationLength: 400,
  maxLabelLength: 120,
  maxIdLength: 64,
  maxWarnings: 20,
  maxDependsOn: 10,
} as const;

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

export const AiEditWarningSchema = z.object({
  code: z.string().min(1).max(64),
  message: z.string().min(1).max(400),
  operationId: z.string().min(1).max(64).optional(),
});

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

export const AiEditScopeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("section"),
    pageId: z.string().min(1, "pageId is required"),
    sectionId: z.string().min(1, "sectionId is required"),
  }),
  z.object({
    type: z.literal("page"),
    pageId: z.string().min(1, "pageId is required"),
  }),
  z.object({
    type: z.literal("project"),
  }),
]);

export const AiEditTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("current-section") }),
  z.object({ type: z.literal("current-page") }),
  z.object({ type: z.literal("specific-page"), pageId: z.string().min(1) }),
  z.object({ type: z.literal("entire-project") }),
]);

// ---------------------------------------------------------------------------
// Per-type props schemas — used to reject invalid section props up front
// ---------------------------------------------------------------------------

export const SECTION_PROPS_SCHEMAS = {
  header: HeaderSectionPropsSchema,
  hero: HeroSectionPropsSchema,
  features: FeaturesSectionPropsSchema,
  pricing: PricingSectionPropsSchema,
  faq: FaqSectionPropsSchema,
  cta: CtaSectionPropsSchema,
  footer: FooterSectionPropsSchema,
} as const;

export function isSupportedSectionType(value: string): boolean {
  return (SUPPORTED_SECTION_TYPES as readonly string[]).includes(value);
}

export function propsSchemaForType(type: string) {
  return SECTION_PROPS_SCHEMAS[type as keyof typeof SECTION_PROPS_SCHEMAS] as
    | z.ZodType
    | undefined;
}

/** Format a zod error into a compact, user-safe string. */
export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => {
      const path = i.path.length ? i.path.join(".") + ": " : "";
      return path + i.message;
    })
    .join("; ");
}

// ---------------------------------------------------------------------------
// Operation base
// ---------------------------------------------------------------------------

const operationIdSchema = z.string().min(1).max(PLAN_LIMITS.maxIdLength);

const AiEditOperationBaseSchema = z.object({
  id: operationIdSchema,
  type: z.string(),
  pageId: z.string().min(1).max(PLAN_LIMITS.maxIdLength).optional(),
  sectionId: z.string().min(1).max(PLAN_LIMITS.maxIdLength).optional(),
  label: z.string().min(1).max(PLAN_LIMITS.maxLabelLength),
  explanation: z.string().min(1).max(PLAN_LIMITS.maxExplanationLength),
  risk: z.enum(["low", "medium", "high"]),
  dependsOn: z
    .array(operationIdSchema)
    .max(PLAN_LIMITS.maxDependsOn)
    .optional(),
});

export const SectionInsertPositionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("end") }),
  z.object({
    type: z.literal("before"),
    sectionId: z.string().min(1).max(PLAN_LIMITS.maxIdLength),
  }),
  z.object({
    type: z.literal("after"),
    sectionId: z.string().min(1).max(PLAN_LIMITS.maxIdLength),
  }),
]);

/** Full section payload inside insert operations (loose base, validated per type). */
export const PlanSectionSchema = z.object({
  id: z.string().min(1).max(PLAN_LIMITS.maxIdLength),
  type: z.string().min(1),
  order: z.number().int().min(0),
  visible: z.boolean().default(true),
  props: z.record(z.string(), z.unknown()),
  styles: z.record(z.string(), z.unknown()).default({}),
});

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export const UpdateSectionPropsOperationSchema = z
  .object({
    ...AiEditOperationBaseSchema.shape,
    type: z.literal("update-section-props"),
    pageId: z.string().min(1).max(PLAN_LIMITS.maxIdLength),
    sectionId: z.string().min(1).max(PLAN_LIMITS.maxIdLength),
    sectionType: z
      .string()
      .refine(isSupportedSectionType, {
        message: `Unsupported section type (supported: ${SUPPORTED_SECTION_TYPES.join(", ")})`,
      }),
    nextProps: z.record(z.string(), z.unknown()),
  })
  .superRefine((op, ctx) => {
    // Reject invalid props for the target section type up front.
    const propsSchema = propsSchemaForType(op.sectionType);
    if (propsSchema) {
      const result = propsSchema.safeParse(op.nextProps);
      if (!result.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nextProps"],
          message: `Invalid props for "${op.sectionType}" section: ${formatZodIssues(result.error)}`,
        });
      }
    }
  });

export const UpdateSectionStylesOperationSchema = z.object({
  ...AiEditOperationBaseSchema.shape,
  type: z.literal("update-section-styles"),
  pageId: z.string().min(1).max(PLAN_LIMITS.maxIdLength),
  sectionId: z.string().min(1).max(PLAN_LIMITS.maxIdLength),
  nextStyles: z.record(z.string(), z.unknown()),
});

export const InsertSectionOperationSchema = z
  .object({
    ...AiEditOperationBaseSchema.shape,
    type: z.literal("insert-section"),
    pageId: z.string().min(1).max(PLAN_LIMITS.maxIdLength),
    sectionType: z
      .string()
      .refine(isSupportedSectionType, {
        message: `Unsupported section type (supported: ${SUPPORTED_SECTION_TYPES.join(", ")})`,
      }),
    section: PlanSectionSchema,
    position: SectionInsertPositionSchema,
  })
  .superRefine((op, ctx) => {
    if (op.section.type !== op.sectionType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["section", "type"],
        message: `Inserted section type "${op.section.type}" does not match sectionType "${op.sectionType}".`,
      });
    }
  });

export const DeleteSectionOperationSchema = z.object({
  ...AiEditOperationBaseSchema.shape,
  type: z.literal("delete-section"),
  pageId: z.string().min(1).max(PLAN_LIMITS.maxIdLength),
  sectionId: z.string().min(1).max(PLAN_LIMITS.maxIdLength),
});

export const DuplicateSectionOperationSchema = z.object({
  ...AiEditOperationBaseSchema.shape,
  type: z.literal("duplicate-section"),
  pageId: z.string().min(1).max(PLAN_LIMITS.maxIdLength),
  sectionId: z.string().min(1).max(PLAN_LIMITS.maxIdLength),
  newSectionId: z.string().min(1).max(PLAN_LIMITS.maxIdLength),
});

export const MoveSectionOperationSchema = z.object({
  ...AiEditOperationBaseSchema.shape,
  type: z.literal("move-section"),
  pageId: z.string().min(1).max(PLAN_LIMITS.maxIdLength),
  sectionId: z.string().min(1).max(PLAN_LIMITS.maxIdLength),
  targetIndex: z.number().int().min(0),
});

export const SetSectionVisibilityOperationSchema = z.object({
  ...AiEditOperationBaseSchema.shape,
  type: z.literal("set-section-visibility"),
  pageId: z.string().min(1).max(PLAN_LIMITS.maxIdLength),
  sectionId: z.string().min(1).max(PLAN_LIMITS.maxIdLength),
  visible: z.boolean(),
});

export const PageTitleSchema = z.string().min(1).max(120);

export const AddPageOperationSchema = z
  .object({
    ...AiEditOperationBaseSchema.shape,
    type: z.literal("add-page"),
    page: ProjectSchema.shape.pages.element,
    position: z.number().int().min(0).optional(),
  })
  .superRefine((op, ctx) => {
    const titleValidation = validatePageTitle(op.page.title);
    if (!titleValidation.valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["page", "title"],
        message: titleValidation.error ?? "Invalid page title.",
      });
    }
    const slugValidation = validateSlug(op.page.slug);
    if (!slugValidation.valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["page", "slug"],
        message: slugValidation.error ?? "Invalid page slug.",
      });
    }
  });

export const RenamePageOperationSchema = z
  .object({
    ...AiEditOperationBaseSchema.shape,
    type: z.literal("rename-page"),
    pageId: z.string().min(1).max(PLAN_LIMITS.maxIdLength),
    title: PageTitleSchema,
  })
  .superRefine((op, ctx) => {
    const titleValidation = validatePageTitle(op.title);
    if (!titleValidation.valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["title"],
        message: titleValidation.error ?? "Invalid page title.",
      });
    }
  });

export const DeletePageOperationSchema = z.object({
  ...AiEditOperationBaseSchema.shape,
  type: z.literal("delete-page"),
  pageId: z.string().min(1).max(PLAN_LIMITS.maxIdLength),
});

export const MovePageOperationSchema = z.object({
  ...AiEditOperationBaseSchema.shape,
  type: z.literal("move-page"),
  pageId: z.string().min(1).max(PLAN_LIMITS.maxIdLength),
  targetIndex: z.number().int().min(0),
});

export const UpdatePageMetaOperationSchema = z.object({
  ...AiEditOperationBaseSchema.shape,
  type: z.literal("update-page-meta"),
  pageId: z.string().min(1).max(PLAN_LIMITS.maxIdLength),
  meta: ProjectSchema.shape.pages.element.shape.meta.unwrap(),
});

// ---------------------------------------------------------------------------
// Discriminated union — canonical operation validation
// ---------------------------------------------------------------------------

export const AiEditOperationSchema = z.discriminatedUnion("type", [
  UpdateSectionPropsOperationSchema,
  UpdateSectionStylesOperationSchema,
  InsertSectionOperationSchema,
  DeleteSectionOperationSchema,
  DuplicateSectionOperationSchema,
  MoveSectionOperationSchema,
  SetSectionVisibilityOperationSchema,
  AddPageOperationSchema,
  RenamePageOperationSchema,
  DeletePageOperationSchema,
  MovePageOperationSchema,
  UpdatePageMetaOperationSchema,
]);

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export const AiEditPlanSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1).max(PLAN_LIMITS.maxIdLength),
    projectId: z.string().min(1),
    baseRevision: z.number().int().min(0),
    scope: AiEditScopeSchema,
    instruction: z.string().min(1).max(PLAN_LIMITS.maxInstructionLength),
    summary: z.string().min(1).max(400),
    operations: z
      .array(AiEditOperationSchema)
      .max(PLAN_LIMITS.maxOperations, `Plans are limited to ${PLAN_LIMITS.maxOperations} operations`),
    warnings: z.array(AiEditWarningSchema).max(PLAN_LIMITS.maxWarnings).default([]),
    createdAt: z.string().min(1),
    provider: z.enum(["gemini", "rule-based"]),
  })
  .superRefine((plan, ctx) => {
    // ---- Dependency integrity: known ids, appear earlier, no cycles ----
    const byId = new Map<string, number>();
    plan.operations.forEach((op, index) => byId.set(op.id, index));

    plan.operations.forEach((op, index) => {
      for (const dep of op.dependsOn ?? []) {
        const depIndex = byId.get(dep);
        if (depIndex === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["operations", index, "dependsOn"],
            message: `Operation "${op.id}" depends on unknown operation "${dep}".`,
          });
        } else if (depIndex >= index) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["operations", index, "dependsOn"],
            message: `Operation "${op.id}" depends on "${dep}", which must appear earlier in the plan.`,
          });
        }
      }
    });

    // ---- Insertion caps ----
    const insertedPages = plan.operations.filter((o) => o.type === "add-page").length;
    if (insertedPages > PLAN_LIMITS.maxInsertedPages) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["operations"],
        message: `Plans may insert at most ${PLAN_LIMITS.maxInsertedPages} pages (requested ${insertedPages}).`,
      });
    }
    const insertedSections = plan.operations.filter(
      (o) => o.type === "insert-section" || o.type === "duplicate-section",
    ).length;
    if (insertedSections > PLAN_LIMITS.maxInsertedSections) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["operations"],
        message: `Plans may insert at most ${PLAN_LIMITS.maxInsertedSections} sections (requested ${insertedSections}).`,
      });
    }
  });

// ---------------------------------------------------------------------------
// Planner request / response / apply-selection payloads
// ---------------------------------------------------------------------------

export const PlanEditRequestSchema = z.object({
  mode: z.literal("plan-edit"),
  instruction: z.string().min(1).max(PLAN_LIMITS.maxInstructionLength),
  scope: AiEditScopeSchema,
  project: ProjectSchema,
  selectedPageId: z.string().optional(),
  selectedSectionId: z.string().optional(),
  baseRevision: z.number().int().min(0),
});

export const PlanEditResponseSchema = z.object({
  ok: z.literal(true),
  source: z.enum(["gemini", "rule-based"]),
  plan: AiEditPlanSchema,
  warnings: z.array(z.string()).default([]),
});

export const ApplySelectionPayloadSchema = z.object({
  plan: AiEditPlanSchema,
  selectedOperationIds: z.array(z.string().min(1)).optional(),
  allowDestructive: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type ValidatedAiEditScope = z.infer<typeof AiEditScopeSchema>;
export type ValidatedAiEditTarget = z.infer<typeof AiEditTargetSchema>;
export type ValidatedAiEditOperation = z.infer<typeof AiEditOperationSchema>;
export type ValidatedAiEditPlan = z.infer<typeof AiEditPlanSchema>;
export type ValidatedPlanEditRequest = z.infer<typeof PlanEditRequestSchema>;
export type ValidatedPlanEditResponse = z.infer<typeof PlanEditResponseSchema>;
export type ValidatedApplySelectionPayload = z.infer<typeof ApplySelectionPayloadSchema>;
