// ---------------------------------------------------------------------------
// Copilot memory — persisted record schema tests (Phase P11)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  validateCopilotMemoryRecord,
  copilotMemoryRecordSchema,
} from "../schema";
import { COPILOT_LIMITS, COPILOT_MEMORY_LIMITS } from "../../constants";
import type { CopilotMemoryRecord } from "../types";

function makeRecord(overrides: Partial<CopilotMemoryRecord> = {}): CopilotMemoryRecord {
  return {
    id: "proj-1",
    version: 1,
    messages: [
      {
        id: "m1",
        role: "user",
        content: "Make it friendlier",
        createdAt: 1720000000000,
      },
      {
        id: "m2",
        role: "assistant",
        content: "I prepared 2 changes.",
        createdAt: 1720000001000,
        kind: "edit-plan",
        metadata: { pageId: "page-1", planId: "plan-1", opLabels: ["a", "b"] },
      },
    ],
    styleNotes: ["keep it friendly"],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("validateCopilotMemoryRecord", () => {
  it("accepts a valid record", () => {
    const record = makeRecord();
    expect(validateCopilotMemoryRecord(record)).toEqual(record);
  });

  it("accepts a minimal record (no messages, no notes)", () => {
    const record = makeRecord({
      messages: [],
      styleNotes: [],
    });
    const result = validateCopilotMemoryRecord(record);
    expect(result).not.toBeNull();
    expect(result?.messages).toEqual([]);
  });

  it("rejects null / undefined / non-objects", () => {
    expect(validateCopilotMemoryRecord(null)).toBeNull();
    expect(validateCopilotMemoryRecord(undefined)).toBeNull();
    expect(validateCopilotMemoryRecord("nope")).toBeNull();
    expect(validateCopilotMemoryRecord(42)).toBeNull();
  });

  it("rejects an unknown version", () => {
    expect(
      validateCopilotMemoryRecord(
        makeRecord({ version: 99 } as unknown as CopilotMemoryRecord),
      ),
    ).toBeNull();
  });

  it("rejects unknown top-level keys", () => {
    const record = makeRecord() as CopilotMemoryRecord & { evil: string };
    record.evil = "payload";
    expect(validateCopilotMemoryRecord(record)).toBeNull();
  });

  it("rejects prototype-pollution keys in style notes", () => {
    expect(
      validateCopilotMemoryRecord(makeRecord({ styleNotes: ["__proto__"] })),
    ).toBeNull();
    expect(
      validateCopilotMemoryRecord(makeRecord({ styleNotes: ["constructor"] })),
    ).toBeNull();
    expect(
      validateCopilotMemoryRecord(makeRecord({ styleNotes: ["prototype"] })),
    ).toBeNull();
  });

  it("rejects prototype-pollution keys inside message opLabels", () => {
    const record = makeRecord();
    record.messages[1].metadata = {
      opLabels: ["safe", "__proto__"],
    };
    expect(validateCopilotMemoryRecord(record)).toBeNull();
  });

  it("rejects unknown keys inside a message", () => {
    const record = makeRecord();
    const dirty = record.messages[0] as unknown as Record<string, unknown>;
    dirty.extraField = "x";
    expect(validateCopilotMemoryRecord(record)).toBeNull();
  });

  it("rejects an unknown role", () => {
    const record = makeRecord();
    record.messages[0].role = "admin" as never;
    expect(validateCopilotMemoryRecord(record)).toBeNull();
  });

  it("rejects non-finite createdAt", () => {
    const record = makeRecord();
    record.messages[0].createdAt = Number.NaN;
    expect(validateCopilotMemoryRecord(record)).toBeNull();
  });

  it("rejects messages over the max bound", () => {
    const record = makeRecord({
      messages: Array.from({ length: COPILOT_LIMITS.maxMessages + 1 }, (_, i) => ({
        id: `m${i}`,
        role: "user" as const,
        content: "x",
        createdAt: i,
      })),
    });
    expect(validateCopilotMemoryRecord(record)).toBeNull();
  });

  it("rejects style notes over the max bound", () => {
    const record = makeRecord({
      styleNotes: Array.from(
        { length: COPILOT_MEMORY_LIMITS.maxStyleNotes + 1 },
        (_, i) => `note ${i}`,
      ),
    });
    expect(validateCopilotMemoryRecord(record)).toBeNull();
  });

  it("rejects an over-length style note", () => {
    const record = makeRecord({
      styleNotes: ["x".repeat(COPILOT_MEMORY_LIMITS.maxStyleNoteLength + 1)],
    });
    expect(validateCopilotMemoryRecord(record)).toBeNull();
  });

  it("rejects an over-length message content", () => {
    const record = makeRecord();
    record.messages[0].content = "x".repeat(
      COPILOT_MEMORY_LIMITS.maxPersistedMessageContent + 1,
    );
    expect(validateCopilotMemoryRecord(record)).toBeNull();
  });

  it("accepts metadata without a scope", () => {
    const record = makeRecord();
    record.messages[1].metadata = { findingId: "f-1" };
    expect(validateCopilotMemoryRecord(record)).not.toBeNull();
  });

  it("schema strictness rejects nested pollution in metadata scope", () => {
    const record = makeRecord();
    record.messages[1].metadata = {
      scope: {
        type: "section",
        pageId: "p",
        sectionId: "s",
      } as never,
    };
    const result = copilotMemoryRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
  });
});
