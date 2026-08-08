// ---------------------------------------------------------------------------
// AI Copilot — project memory types (Phase P11)
//
// One bounded record per project, stored locally in IndexedDB
// ("copilotMemory" store, database version 9). Never synced, never in
// ProjectSchema, never in .buildora.json or the website export.
//
// Guarantees:
//   - only a SAFE projection of CopilotMessage is persisted (no plan
//     payloads, no provider internals, no raw provider text)
//   - plan/approval state (planState, elementSuggestion, error, status,
//     lastRequest, appliedSummary) is NEVER persisted — restoring a
//     conversation can never resurrect an approval surface or auto-apply
//     a plan
// ---------------------------------------------------------------------------

import type { CopilotMessageKind, CopilotMessageMetadata } from "../types";

/** Schema version of the persisted record. Bump = migration + re-validate. */
export const COPILOT_MEMORY_RECORD_VERSION = 1;

/**
 * Safe persisted projection of a CopilotMessage. Only whitelisted fields are
 * stored; content is capped at write time and re-capped at read time.
 */
export interface PersistedCopilotMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  kind?: CopilotMessageKind;
  metadata?: CopilotMessageMetadata;
}

/**
 * One record per project. `messages` is bounded to COPILOT_LIMITS.maxMessages;
 * `styleNotes` is bounded to COPILOT_MEMORY_LIMITS.maxStyleNotes × max length.
 */
export interface CopilotMemoryRecord {
  id: string;
  version: typeof COPILOT_MEMORY_RECORD_VERSION;
  messages: PersistedCopilotMessage[];
  styleNotes: string[];
  createdAt: string;
  updatedAt: string;
}

/** Result type for memory storage operations (never throws to callers). */
export type CopilotMemoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; cause?: string } };
