import { z } from "zod";
import { SUPPORTED_SECTION_TYPES } from "@/features/generation/providers/generation-provider";

// ---------------------------------------------------------------------------
// Edit target schema — validated server-side on mode: "modify"
// ---------------------------------------------------------------------------

export const EditTargetSchema = z.object({
  kind: z.literal("section"),
  sectionId: z.string().min(1, "sectionId is required"),
  type: z
    .string()
    .refine(
      (v) => (SUPPORTED_SECTION_TYPES as readonly string[]).includes(v),
      { message: "Unsupported section type" },
    ),
  label: z.string().optional(),
  props: z.record(z.string(), z.unknown()).default({}),
  context: z
    .object({
      brandName: z.string().max(200).optional(),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Edited section + result schemas — validated server-side
// ---------------------------------------------------------------------------

export const EditedSectionSchema = z.object({
  type: z.string().min(1),
  props: z.record(z.string(), z.unknown()).default({}),
});

export const EditResultSchema = z.object({
  edits: z.array(EditedSectionSchema).min(1, "At least one edited section required"),
});

// ---------------------------------------------------------------------------
// Infer types
// ---------------------------------------------------------------------------

export type ValidatedEditTarget = z.infer<typeof EditTargetSchema>;
export type ValidatedEditedSection = z.infer<typeof EditedSectionSchema>;
export type ValidatedEditResult = z.infer<typeof EditResultSchema>;
