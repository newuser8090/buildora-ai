// ---------------------------------------------------------------------------
// AI Copilot — persisted memory record schema (Phase P11)
//
// Records are validated on READ (before hydrating the store) and bounded on
// WRITE. Strict objects reject unknown keys (prototype-pollution keys
// included), every string is capped, and the message/style arrays are
// bounded so a corrupt or oversized record can never blow up the UI.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { COPILOT_LIMITS, COPILOT_MEMORY_LIMITS } from "../constants";
import type { CopilotMessageKind, CopilotMessageMetadata } from "../types";
import { COPILOT_MEMORY_RECORD_VERSION } from "./types";

// ---------------------------------------------------------------------------
// Message projection
// ---------------------------------------------------------------------------

const messageKindSchema = z.enum([
  "question",
  "edit-plan",
  "applied",
  "error",
  "system",
  "quality",
]) as z.ZodType<CopilotMessageKind>;

const scopeSchema = z.union([
  z.object({ type: z.literal("project") }),
  z.object({ type: z.literal("page"), pageId: z.string().max(200) }),
  z.object({
    type: z.literal("section"),
    pageId: z.string().max(200),
    sectionId: z.string().max(200),
  }),
]);

const messageMetadataSchema = z
  .object({
    scope: scopeSchema.optional(),
    pageId: z.string().max(200).optional(),
    sectionId: z.string().max(200).optional(),
    planId: z.string().max(200).optional(),
    opLabels: z.array(z.string().max(500)).max(50).optional(),
    findingId: z.string().max(200).optional(),
  })
  .strict() as z.ZodType<CopilotMessageMetadata>;

export const persistedMessageSchema = z
  .object({
    id: z.string().max(200),
    role: z.enum(["user", "assistant", "system"]),
    content: z.string().max(COPILOT_MEMORY_LIMITS.maxPersistedMessageContent),
    createdAt: z.number().finite(),
    kind: messageKindSchema.optional(),
    metadata: messageMetadataSchema.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

export const copilotMemoryRecordSchema = z
  .object({
    id: z.string().max(200),
    version: z.literal(COPILOT_MEMORY_RECORD_VERSION),
    messages: z.array(persistedMessageSchema).max(COPILOT_LIMITS.maxMessages),
    styleNotes: z
      .array(z.string().max(COPILOT_MEMORY_LIMITS.maxStyleNoteLength))
      .max(COPILOT_MEMORY_LIMITS.maxStyleNotes),
    createdAt: z.string().max(64),
    updatedAt: z.string().max(64),
  })
  .strict();

export type ValidatedCopilotMemoryRecord = z.infer<
  typeof copilotMemoryRecordSchema
>;

/**
 * Validate an untrusted persisted record. Returns null when the record is
 * missing, malformed, the wrong version, or exceeds any bound — a caller
 * treats null as "no memory" and never throws the record into the UI.
 */
export function validateCopilotMemoryRecord(
  raw: unknown,
): ValidatedCopilotMemoryRecord | null {
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const parsed = copilotMemoryRecordSchema.safeParse(raw);
  if (!parsed.success) return null;
  const record = parsed.data;

  // Defense-in-depth: reject prototype-pollution keys inside message
  // metadata and opLabels (strict() already rejects unknown object keys,
  // but nested arrays/values are checked here explicitly).
  if (record.messages.some((m) => m.metadata?.opLabels?.some((l) => isPollutionKey(l)))) {
    return null;
  }
  if (record.styleNotes.some((n) => isPollutionKey(n))) return null;
  return record;
}

/**
 * True for keys that could participate in prototype pollution if assigned as
 * object properties. Used by the read-path validation (defense-in-depth) and
 * by the write/entry sanitizers, so a user-authored string that happens to be
 * a pollution key is dropped at entry instead of failing the whole record.
 */
export function isPollutionKey(value: string): boolean {
  return value === "__proto__" || value === "prototype" || value === "constructor";
}
