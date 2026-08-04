// ---------------------------------------------------------------------------
// Inline editing — Phase M zod schemas
//
// Server-side authority for inline-edit requests and suggestion validation.
//   - caps instruction, current value, and context sizes
//   - rejects malformed field paths and unknown field kinds
//   - suggestion output validated before it leaves the server
//   - raw provider response never returned
// ---------------------------------------------------------------------------

import { z } from "zod";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const INLINE_LIMITS = {
  maxInstructionLength: 2000,
  maxCurrentValueLength: 2000,
  maxContextLength: 6000,
  maxSuggestionLength: 2000,
  maxExplanationLength: 400,
  maxPathSegments: 8,
} as const;

// ---------------------------------------------------------------------------
// Field kind
// ---------------------------------------------------------------------------

export const EditableFieldKindSchema = z.enum([
  "text",
  "textarea",
  "link-text",
  "button-text",
  "heading",
  "description",
]);

// ---------------------------------------------------------------------------
// Suggestion payload (what providers must return)
// ---------------------------------------------------------------------------

export const InlineSuggestionPayloadSchema = z.object({
  suggestedValue: z
    .string()
    .min(1, "A suggestion must contain text.")
    .max(INLINE_LIMITS.maxSuggestionLength),
  explanation: z.string().max(INLINE_LIMITS.maxExplanationLength).optional(),
});

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export const InlineEditRequestSchema = z.object({
  mode: z.literal("inline-edit"),
  instruction: z
    .string()
    .min(1)
    .max(INLINE_LIMITS.maxInstructionLength, "Instruction is too long."),
  projectId: z.string().min(1),
  baseRevision: z.number().int().min(0),
  pageId: z.string().min(1),
  sectionId: z.string().min(1),
  sectionType: z.string().min(1),
  fieldPath: z
    .array(z.union([z.string().min(1), z.number().int().min(0)]))
    .min(1)
    .max(INLINE_LIMITS.maxPathSegments),
  fieldKind: EditableFieldKindSchema,
  currentValue: z
    .string()
    .max(INLINE_LIMITS.maxCurrentValueLength, "Current value is too long."),
  surroundingContext: z
    .string()
    .max(INLINE_LIMITS.maxContextLength, "Context is too large.")
    .optional(),
  variant: z.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export const InlineEditResponseSchema = z.object({
  ok: z.literal(true),
  source: z.enum(["gemini", "rule-based"]),
  suggestion: z.object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    baseRevision: z.number().int().min(0),
    pageId: z.string().min(1),
    sectionId: z.string().min(1),
    sectionType: z.string().min(1),
    fieldPath: z.array(z.union([z.string().min(1), z.number().int().min(0)])),
    originalValue: z.string(),
    suggestedValue: z
      .string()
      .min(1)
      .max(INLINE_LIMITS.maxSuggestionLength),
    instruction: z.string().min(1),
    explanation: z.string().max(INLINE_LIMITS.maxExplanationLength).optional(),
    provider: z.enum(["gemini", "rule-based"]),
    createdAt: z.string().min(1),
  }),
  warnings: z.array(z.string()).default([]),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type ValidatedInlineEditRequest = z.infer<typeof InlineEditRequestSchema>;
export type ValidatedInlineSuggestionPayload = z.infer<
  typeof InlineSuggestionPayloadSchema
>;
export type ValidatedInlineEditResponse = z.infer<typeof InlineEditResponseSchema>;
