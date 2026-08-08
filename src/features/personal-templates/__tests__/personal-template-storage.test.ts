// ---------------------------------------------------------------------------
// Personal Templates (Phase P9) — storage adapter tests
//
//   - save/list/get roundtrip, newest first
//   - quota cap (MAX_PERSONAL_TEMPLATES) — never a silent overwrite
//   - updates do not consume a new slot
//   - delete removes the record
//   - first-connection creates the personalTemplates store + every other store
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import {
  IndexedDbPersonalTemplateAdapter,
} from "../storage/personal-template-storage";
import {
  MAX_PERSONAL_TEMPLATES,
  type PersonalTemplateRecord,
} from "../types";
import { DATABASE_VERSION } from "@/features/persistence/constants";

let counter = 0;

function makeRecord(overrides?: Partial<PersonalTemplateRecord>): PersonalTemplateRecord {
  return {
    id: `personal-test-${counter}`,
    name: "My Template",
    description: "A saved project",
    category: "business",
    tags: ["test"],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    source: "personal",
    project: makeProject(),
    ...overrides,
  };
}

export function makeProject() {
  return {
    id: "proj-src",
    name: "Source Project",
    theme: {
      palette: {
        background: "#fff", foreground: "#000", primary: "#7c5cfc",
        primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#000",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#fff", border: "#e5e5e5", card: "#fff", cardForeground: "#000",
      },
      typography: { fontFamily: "sans-serif", headingFont: "sans-serif", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "5rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
    pages: [
      {
        id: "p1",
        title: "Home",
        slug: "/",
        sections: [
          {
            id: "s1",
            type: "hero",
            order: 1,
            visible: true,
            props: { headline: "Hello", primaryCta: { text: "Go", href: "#" } },
            styles: {},
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeAdapter() {
  counter += 1;
  return new IndexedDbPersonalTemplateAdapter({
    dbName: `personal-storage-${counter}`,
    dbVersion: DATABASE_VERSION,
  });
}

describe("PersonalTemplateStorage — CRUD", () => {
  it("saves, lists (newest first), and gets a template", async () => {
    const adapter = makeAdapter();
    const a = await adapter.saveTemplate(makeRecord({ id: "personal-a", updatedAt: "2026-08-01T00:00:00.000Z" }));
    const b = await adapter.saveTemplate(makeRecord({ id: "personal-b", updatedAt: "2026-08-02T00:00:00.000Z" }));
    expect(a.ok && b.ok).toBe(true);

    const list = await adapter.listTemplates();
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value.map((t) => t.id)).toEqual(["personal-b", "personal-a"]);
    }

    const got = await adapter.getTemplate("personal-a");
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.value?.name).toBe("My Template");
      expect(got.value?.project.name).toBe("Source Project");
    }
    adapter.close();
  });

  it("getTemplate returns null for a missing id", async () => {
    const adapter = makeAdapter();
    const got = await adapter.getTemplate("nope");
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.value).toBeNull();
    adapter.close();
  });

  it("delete removes the record", async () => {
    const adapter = makeAdapter();
    await adapter.saveTemplate(makeRecord());
    const deleted = await adapter.deleteTemplate(makeRecord().id);
    expect(deleted.ok).toBe(true);
    const list = await adapter.listTemplates();
    if (list.ok) expect(list.value).toHaveLength(0);
    adapter.close();
  });

  it("updating an existing template does not consume a new quota slot", async () => {
    const adapter = makeAdapter();
    const id = "personal-slot";
    await adapter.saveTemplate(makeRecord({ id }));
    await adapter.saveTemplate({ ...makeRecord({ id }), name: "Renamed" });
    const count = await adapter.countTemplates();
    expect(count.ok).toBe(true);
    if (count.ok) expect(count.value).toBe(1);
    adapter.close();
  });

  it("rejects saves beyond the quota with QUOTA_EXCEEDED (never a silent overwrite)", async () => {
    const adapter = makeAdapter();
    for (let i = 0; i < MAX_PERSONAL_TEMPLATES; i += 1) {
      const saved = await adapter.saveTemplate(makeRecord({ id: `personal-q-${i}` }));
      expect(saved.ok).toBe(true);
    }
    const over = await adapter.saveTemplate(makeRecord({ id: "personal-over" }));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error.code).toBe("PERSONAL_TEMPLATE_QUOTA_EXCEEDED");
    adapter.close();
  });
});

describe("PersonalTemplateStorage — first connection", () => {
  it("a fresh database opened ONLY by the personal-template adapter gets every store", async () => {
    const dbName = `personal-first-${counter++}`;
    const adapter = new IndexedDbPersonalTemplateAdapter({
      dbName,
      dbVersion: DATABASE_VERSION,
    });
    await adapter.saveTemplate(makeRecord({ id: "personal-first" }));
    adapter.close();

    const open = indexedDB.open(dbName);
    const names = await new Promise<string[]>((resolve, reject) => {
      open.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        resolve(Array.from(db.objectStoreNames));
        db.close();
      };
      open.onerror = () => reject(open.error);
    });

    expect(names).toContain("personalTemplates");
    for (const expected of [
      "projects",
      "metadata",
      "projectThumbnails",
      "myBlocks",
      "myBlockThumbnails",
      "myBlockCollections",
      "cloudSyncQueue",
      "cloudSyncMarkers",
      "cloudSyncConflicts",
      "deployments",
      "deploymentDomains",
      "personalTemplates",
      "recoverySnapshots",
      "copilotMemory",
    ]) {
      expect(names).toContain(expected);
    }
    expect(names).toHaveLength(14);
  });
});
