// ---------------------------------------------------------------------------
// AI Copilot — project memory service (Phase P11)
//
// Framework-independent bridge between the transient Copilot store and the
// local IndexedDB record:
//   - serializeForStorage() persists ONLY a safe projection of messages
//     (never plan payloads, provider internals, or raw provider text)
//   - load() validates through the schema and bounds everything again
//   - save() trims to caps, stamps timestamps, and never throws to callers
//   - clear()/deleteForProject() remove the record entirely
//
// Plan/approval state (planState, elementSuggestion, error, status,
// lastRequest, appliedSummary) is NEVER persisted here.
// ---------------------------------------------------------------------------

import { markPerf } from "@/features/perf/perf-instrumentation";
import { COPILOT_LIMITS, COPILOT_MEMORY_LIMITS } from "../../constants";
import type { CopilotMessage } from "../../types";
import {
  COPILOT_MEMORY_RECORD_VERSION,
  type CopilotMemoryRecord,
  type CopilotMemoryResult,
  type PersistedCopilotMessage,
} from "../types";
import { isPollutionKey, validateCopilotMemoryRecord } from "../schema";
import {
  getCopilotMemoryStorage,
  type CopilotMemoryStorageAdapter,
} from "../storage/copilot-memory-storage";

// ---------------------------------------------------------------------------
// Serializer — safe projection (whitelisted fields only)
// ---------------------------------------------------------------------------

export function serializeCopilotMessages(
  messages: CopilotMessage[],
): PersistedCopilotMessage[] {
  return messages
    .slice(-COPILOT_LIMITS.maxMessages)
    .map((m) => ({
      id: m.id.slice(0, 200),
      role: m.role,
      content: m.content.slice(0, COPILOT_MEMORY_LIMITS.maxPersistedMessageContent),
      createdAt: Number.isFinite(m.createdAt) ? m.createdAt : Date.now(),
      kind: m.kind,
      // Metadata is whitelisted structurally by the message type; safe to
      // persist (used for cross-session follow-up resolution only).
      // Prototype-pollution keys inside opLabels are dropped here so an odd
      // label can never cause the whole record to be rejected at write time
      // (the read path still rejects them as defense-in-depth).
      metadata: m.metadata
        ? {
            ...m.metadata,
            opLabels: m.metadata.opLabels?.filter(
              (label) => !isPollutionKey(label),
            ),
          }
        : undefined,
    }));
}

export function sanitizeStyleNotes(notes: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of notes) {
    const note = raw.trim().slice(0, COPILOT_MEMORY_LIMITS.maxStyleNoteLength);
    // Prototype-pollution keys are dropped AT ENTRY so a user-authored note
    // can never cause the whole record to be rejected at write time (the
    // read path still rejects them as defense-in-depth for hostile records).
    if (!note || seen.has(note) || isPollutionKey(note)) continue;
    seen.add(note);
    result.push(note);
    if (result.length >= COPILOT_MEMORY_LIMITS.maxStyleNotes) break;
  }
  return result;
}

/** Validate a freshly-built record before it is handed to storage. */
export function validateMemoryRecordForWrite(
  record: CopilotMemoryRecord,
): CopilotMemoryRecord | null {
  return validateCopilotMemoryRecord(record);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class CopilotMemoryService {
  private storage: CopilotMemoryStorageAdapter;

  constructor(storage: CopilotMemoryStorageAdapter = getCopilotMemoryStorage()) {
    this.storage = storage;
  }

  /** Load a validated record for a project; null when absent/invalid. */
  async load(projectId: string): Promise<CopilotMemoryRecord | null> {
    const result = await this.storage.getMemory(projectId);
    if (!result.ok) return null;
    const validated = validateCopilotMemoryRecord(result.value);
    markPerf("copilot_memory_load", {
      count: validated?.messages.length ?? 0,
    });
    return validated;
  }

  /** Save a bounded, sanitized record. Never throws. */
  async save(input: {
    projectId: string;
    messages: CopilotMessage[];
    styleNotes: string[];
  }): Promise<CopilotMemoryResult<CopilotMemoryRecord>> {
    const now = new Date().toISOString();
    const record: CopilotMemoryRecord = {
      id: input.projectId,
      version: COPILOT_MEMORY_RECORD_VERSION,
      messages: serializeCopilotMessages(input.messages),
      styleNotes: sanitizeStyleNotes(input.styleNotes),
      createdAt: "",
      updatedAt: now,
    };
    const validated = validateMemoryRecordForWrite(record);
    if (!validated) {
      return {
        ok: false,
        error: {
          code: "COPILOT_MEMORY_INVALID_RECORD",
          message: "The conversation could not be saved on this device.",
        },
      };
    }
    // createdAt: preserve the existing record's createdAt when present.
    const existing = await this.storage.getMemory(input.projectId);
    validated.createdAt =
      existing.ok && existing.value?.createdAt
        ? existing.value.createdAt
        : now;

    const result = await this.storage.putMemory(validated);
    if (result.ok) {
      markPerf("copilot_memory_save", {
        count: validated.messages.length,
      });
    }
    return result;
  }

  /** Remove the persisted record for a project. Never throws. */
  async clear(projectId: string): Promise<CopilotMemoryResult<void>> {
    return this.storage.deleteMemory(projectId);
  }

  /** Lifecycle hook used when a project is deleted. */
  async deleteForProject(projectId: string): Promise<CopilotMemoryResult<void>> {
    return this.clear(projectId);
  }
}

// ---------------------------------------------------------------------------
// Singleton (browser)
// ---------------------------------------------------------------------------

let serviceSingleton: CopilotMemoryService | null = null;

export function getCopilotMemoryService(): CopilotMemoryService {
  if (!serviceSingleton) {
    serviceSingleton = new CopilotMemoryService();
  }
  return serviceSingleton;
}

export function setCopilotMemoryServiceForTests(
  service: CopilotMemoryService | null,
): void {
  serviceSingleton = service;
}
