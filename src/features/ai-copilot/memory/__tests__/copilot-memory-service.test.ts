// ---------------------------------------------------------------------------
// Copilot memory — service tests (Phase P11)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CopilotMemoryService,
  serializeCopilotMessages,
  sanitizeStyleNotes,
} from "../services/copilot-memory-service";
import {
  buildStyleSuffix,
  applyStyleNotesToInstruction,
} from "../../services/copilot-service";
import { validateCopilotMemoryRecord } from "../schema";
import { COPILOT_MEMORY_LIMITS } from "../../constants";
import type { CopilotMemoryRecord } from "../types";
import type { CopilotMessage } from "../../types";
import type { CopilotMemoryStorageAdapter } from "../storage/copilot-memory-storage";
import { setCopilotMemoryServiceForTests } from "../services/copilot-memory-service";
import { COPILOT_LIMITS } from "../../constants";

function makeMessage(overrides: Partial<CopilotMessage> = {}): CopilotMessage {
  return {
    id: "m1",
    role: "user",
    content: "Hello",
    createdAt: 1720000000000,
    ...overrides,
  };
}

/** A persisted-shape message (no transient status field — matches the strict schema). */
function makePersistedMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "m1",
    role: "user",
    content: "Hello",
    createdAt: 1720000000000,
    ...overrides,
  };
}

function makeAdapter(
  overrides: {
    getMemory?: CopilotMemoryStorageAdapter["getMemory"];
    putMemory?: CopilotMemoryStorageAdapter["putMemory"];
    deleteMemory?: CopilotMemoryStorageAdapter["deleteMemory"];
    close?: () => void;
  } = {},
): CopilotMemoryStorageAdapter {
  return {
    getMemory: overrides.getMemory ?? vi.fn(async () => ({ ok: true as const, value: null })),
    putMemory:
      overrides.putMemory ??
      vi.fn(async (record) => ({ ok: true as const, value: record })),
    deleteMemory:
      overrides.deleteMemory ??
      vi.fn(async () => ({ ok: true as const, value: undefined })),
    close: overrides.close ?? vi.fn(),
  };
}

describe("serializeCopilotMessages", () => {
  it("persists only whitelisted fields (no plan payloads or internals)", () => {
    const messages: CopilotMessage[] = [
      makeMessage({
        role: "assistant",
        content: "Prepared changes",
        kind: "edit-plan",
        metadata: { planId: "plan-1", pageId: "page-1", opLabels: ["a"] },
      }),
    ];
    const persisted = serializeCopilotMessages(messages);
    expect(persisted[0]).toEqual({
      id: "m1",
      role: "assistant",
      content: "Prepared changes",
      createdAt: 1720000000000,
      kind: "edit-plan",
      metadata: { planId: "plan-1", pageId: "page-1", opLabels: ["a"] },
    });
    expect(Object.keys(persisted[0]).sort()).toEqual(
      ["content", "createdAt", "id", "kind", "metadata", "role"],
    );
  });

  it("caps content to the persisted bound", () => {
    const long = "x".repeat(COPILOT_MEMORY_LIMITS.maxPersistedMessageContent + 500);
    const [first] = serializeCopilotMessages([makeMessage({ content: long })]);
    expect(first.content.length).toBe(
      COPILOT_MEMORY_LIMITS.maxPersistedMessageContent,
    );
  });

  it("drops prototype-pollution keys from metadata opLabels at write", () => {
    const [first] = serializeCopilotMessages([
      makeMessage({
        role: "assistant",
        metadata: {
          opLabels: ["safe", "__proto__", "constructor"],
        },
      }),
    ]);
    expect(first.metadata?.opLabels).toEqual(["safe"]);
    // The resulting message is safe to persist (schema-valid).
    expect(
      validateCopilotMemoryRecord({
        id: "proj-1",
        version: 1,
        messages: [first as never],
        styleNotes: [],
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }),
    ).not.toBeNull();
  });

  it("bounds to maxMessages", () => {
    const messages = Array.from({ length: COPILOT_LIMITS.maxMessages + 10 }, (_, i) =>
      makeMessage({ id: `m${i}`, content: `msg ${i}` }),
    );
    const persisted = serializeCopilotMessages(messages);
    expect(persisted.length).toBe(COPILOT_LIMITS.maxMessages);
    // Oldest trimmed — the newest survive.
    expect(persisted[0].content).toBe(
      `msg ${COPILOT_LIMITS.maxMessages + 10 - COPILOT_LIMITS.maxMessages}`,
    );
  });

  it("falls back to a finite createdAt when missing", () => {
    const bad = makeMessage({ createdAt: Number.NaN });
    const [first] = serializeCopilotMessages([bad]);
    expect(Number.isFinite(first.createdAt)).toBe(true);
  });
});

describe("sanitizeStyleNotes", () => {
  it("trims, dedupes, caps length, and bounds count", () => {
    const notes = [
      "  keep it friendly  ",
      "keep it friendly",
      "x".repeat(COPILOT_MEMORY_LIMITS.maxStyleNoteLength + 20),
      "",
      "   ",
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
    ];
    const result = sanitizeStyleNotes(notes);
    expect(result).toEqual([
      "keep it friendly",
      "x".repeat(COPILOT_MEMORY_LIMITS.maxStyleNoteLength),
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(result.length).toBe(COPILOT_MEMORY_LIMITS.maxStyleNotes);
  });

  it("drops prototype-pollution keys so the write path never self-rejects", () => {
    const result = sanitizeStyleNotes([
      "__proto__",
      "prototype",
      "constructor",
      "keep it friendly",
    ]);
    expect(result).toEqual(["keep it friendly"]);
    // A record built from sanitized notes always passes the schema.
    expect(
      validateCopilotMemoryRecord({
        id: "proj-1",
        version: 1,
        messages: [],
        styleNotes: result,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }),
    ).not.toBeNull();
  });
});

describe("CopilotMemoryService", () => {
  let adapter: CopilotMemoryStorageAdapter;
  let service: CopilotMemoryService;

  beforeEach(() => {
    adapter = makeAdapter();
    service = new CopilotMemoryService(adapter);
    setCopilotMemoryServiceForTests(null);
  });

  afterEach(() => {
    setCopilotMemoryServiceForTests(null);
  });

  it("load returns null when the record is missing", async () => {
    const result = await service.load("proj-1");
    expect(result).toBeNull();
  });

  it("load returns null for an invalid record", async () => {
    adapter = makeAdapter({
      getMemory: vi.fn(async () => ({
        ok: true as const,
        value: { evil: true } as unknown as CopilotMemoryRecord,
      })),
    });
    service = new CopilotMemoryService(adapter);
    const result = await service.load("proj-1");
    expect(result).toBeNull();
  });

  it("load returns the validated record", async () => {
    const full: CopilotMemoryRecord = {
      id: "proj-1",
      version: 1,
      messages: [makePersistedMessage() as unknown as CopilotMemoryRecord["messages"][number]],
      styleNotes: ["friendly"],
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    };
    adapter = makeAdapter({
      getMemory: vi.fn(async () => ({ ok: true as const, value: full })),
    });
    service = new CopilotMemoryService(adapter);
    const result = await service.load("proj-1");
    expect(result?.id).toBe("proj-1");
    expect(result?.messages).toHaveLength(1);
  });

  it("save writes a valid bounded record and stamps timestamps", async () => {
    const result = await service.save({
      projectId: "proj-1",
      messages: [makeMessage()],
      styleNotes: ["keep it friendly", "keep it friendly"],
    });
    expect(result.ok).toBe(true);
    const record = (result as { ok: true; value: CopilotMemoryRecord }).value;
    expect(validateCopilotMemoryRecord(record)).not.toBeNull();
    expect(record.styleNotes).toEqual(["keep it friendly"]);
    expect(record.version).toBe(1);
    expect(record.createdAt).toBeTruthy();
    expect(record.updatedAt).toBeTruthy();
    expect(adapter.putMemory).toHaveBeenCalledOnce();
  });

  it("save preserves the original createdAt when a record already exists", async () => {
    const existing: CopilotMemoryRecord = {
      id: "proj-1",
      version: 1,
      messages: [],
      styleNotes: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    adapter = makeAdapter({
      getMemory: vi.fn(async () => ({ ok: true as const, value: existing })),
    });
    service = new CopilotMemoryService(adapter);
    const result = await service.save({
      projectId: "proj-1",
      messages: [],
      styleNotes: [],
    });
    expect(result.ok).toBe(true);
    const record = (result as { ok: true; value: CopilotMemoryRecord }).value;
    expect(record.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("clear and deleteForProject remove the record", async () => {
    await service.clear("proj-1");
    expect(adapter.deleteMemory).toHaveBeenCalledWith("proj-1");
    await service.deleteForProject("proj-2");
    expect(adapter.deleteMemory).toHaveBeenCalledWith("proj-2");
  });

  it("never throws on storage failure", async () => {
    adapter = makeAdapter({
      getMemory: vi.fn(async () => ({
        ok: false as const,
        error: { code: "X", message: "boom" },
      })),
      putMemory: vi.fn(async () => ({
        ok: false as const,
        error: { code: "X", message: "boom" },
      })),
      deleteMemory: vi.fn(async () => ({
        ok: false as const,
        error: { code: "X", message: "boom" },
      })),
    });
    service = new CopilotMemoryService(adapter);
    expect(await service.load("p")).toBeNull();
    const save = await service.save({ projectId: "p", messages: [], styleNotes: [] });
    expect(save.ok).toBe(false);
    const cleared = await service.clear("p");
    expect(cleared.ok).toBe(false);
  });
});

describe("style instruction suffix", () => {
  it("returns the instruction unchanged without notes", () => {
    expect(applyStyleNotesToInstruction("Make it better", undefined)).toBe("Make it better");
    expect(applyStyleNotesToInstruction("Make it better", [])).toBe("Make it better");
    expect(applyStyleNotesToInstruction("Make it better", ["   "])).toBe("Make it better");
  });

  it("appends a bounded suffix", () => {
    const result = applyStyleNotesToInstruction("Make it better", [
      "keep it friendly",
      "use British spelling",
    ]);
    expect(result).toBe(
      "Make it better Style preferences: keep it friendly; use British spelling.",
    );
  });

  it("caps the suffix to the note count and length bounds", () => {
    const notes = Array.from({ length: 5 }, (_, i) => `note ${i}`);
    const suffix = buildStyleSuffix(notes);
    // Only the first 2 notes are used.
    expect(suffix).toBe(" Style preferences: note 0; note 1.");
    expect(suffix.length).toBeLessThanOrEqual(
      COPILOT_MEMORY_LIMITS.maxStyleSuffixLength + " Style preferences: .".length,
    );
  });

  it("keeps the instruction within the overall limit", () => {
    const instruction = "x".repeat(COPILOT_LIMITS.maxInstructionLength - 10);
    const result = applyStyleNotesToInstruction(instruction, ["keep it friendly"]);
    expect(result.length).toBeLessThanOrEqual(COPILOT_LIMITS.maxInstructionLength);
  });
});
