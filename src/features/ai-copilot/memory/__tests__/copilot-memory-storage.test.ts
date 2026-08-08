// ---------------------------------------------------------------------------
// Copilot memory — IndexedDB storage adapter tests (Phase P11)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { IndexedDbCopilotMemoryStorage } from "../storage/copilot-memory-storage";
import type { CopilotMemoryRecord } from "../types";

let counter = 0;
function dbName(): string {
  counter += 1;
  return `copilot-memory-test-${counter}`;
}

function makeRecord(projectId: string, overrides: Partial<CopilotMemoryRecord> = {}): CopilotMemoryRecord {
  return {
    id: projectId,
    version: 1,
    messages: [{ id: "m1", role: "user", content: "Hello", createdAt: 1 }],
    styleNotes: ["friendly"],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("IndexedDbCopilotMemoryStorage", () => {
  let adapter: IndexedDbCopilotMemoryStorage;

  beforeEach(() => {
    adapter = new IndexedDbCopilotMemoryStorage({ dbName: dbName() });
  });

  it("returns null when no record exists", async () => {
    const result = await adapter.getMemory("proj-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
  });

  it("puts and gets a record", async () => {
    const record = makeRecord("proj-1");
    const saved = await adapter.putMemory(record);
    expect(saved.ok).toBe(true);

    const loaded = await adapter.getMemory("proj-1");
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value?.messages).toHaveLength(1);
      expect(loaded.value?.styleNotes).toEqual(["friendly"]);
    }
  });

  it("stores records keyed by project id (no cross-project reads)", async () => {
    await adapter.putMemory(makeRecord("proj-a", { messages: [] }));
    await adapter.putMemory(makeRecord("proj-b", { styleNotes: ["b-style"] }));

    const a = await adapter.getMemory("proj-a");
    const b = await adapter.getMemory("proj-b");
    if (a.ok) expect(a.value?.styleNotes).toEqual(["friendly"]);
    if (b.ok) expect(b.value?.styleNotes).toEqual(["b-style"]);
  });

  it("updates an existing record in place", async () => {
    await adapter.putMemory(makeRecord("proj-1", { messages: [] }));
    await adapter.putMemory(
      makeRecord("proj-1", { styleNotes: ["updated"] }),
    );
    const loaded = await adapter.getMemory("proj-1");
    if (loaded.ok) {
      expect(loaded.value?.styleNotes).toEqual(["updated"]);
    }
  });

  it("deletes a record", async () => {
    await adapter.putMemory(makeRecord("proj-1"));
    const del = await adapter.deleteMemory("proj-1");
    expect(del.ok).toBe(true);

    const loaded = await adapter.getMemory("proj-1");
    if (loaded.ok) expect(loaded.value).toBeNull();
  });

  it("delete on a missing key is a no-op success", async () => {
    const del = await adapter.deleteMemory("never-existed");
    expect(del.ok).toBe(true);
  });

  it("records survive close/reopen", async () => {
    const name = dbName();
    const first = new IndexedDbCopilotMemoryStorage({ dbName: name });
    await first.putMemory(makeRecord("proj-1"));
    first.close();

    const reopened = new IndexedDbCopilotMemoryStorage({ dbName: name });
    const loaded = await reopened.getMemory("proj-1");
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value?.messages).toHaveLength(1);
    }
    reopened.close();
  });
});
