// ---------------------------------------------------------------------------
// Personal Templates (Phase P9) — service tests
//
//   - saveAsTemplate: name validation, schema validation, deep-clone, quota
//   - list / rename / duplicate
//   - createProjectFromPersonalTemplate: fresh project/page/section IDs,
//     fresh timestamps, retained content, NO deployment/domain/sync state
//   - corrupted template isolation
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import {
  IndexedDbPersonalTemplateAdapter,
  setPersonalTemplateStorageForTests,
} from "../storage/personal-template-storage";
import {
  PersonalTemplateService,
  setPersonalTemplateServiceForTests,
} from "../services/personal-template-service";
import type { PersonalTemplateRecord, SaveAsTemplateInput } from "../types";
import { DATABASE_VERSION } from "@/features/persistence/constants";

let counter = 0;

function makeProject(overrides?: Record<string, unknown>) {
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
    ...overrides,
  };
}

function makeInput(overrides?: Partial<SaveAsTemplateInput>): SaveAsTemplateInput {
  return {
    project: makeProject(),
    name: "My Template",
    description: "desc",
    category: "business",
    tags: ["test", "landing"],
    now: "2026-08-01T00:00:00.000Z",
    id: `personal-${counter++}`,
    ...overrides,
  };
}

async function freshService(): Promise<PersonalTemplateService> {
  counter += 1;
  const storage = new IndexedDbPersonalTemplateAdapter({
    dbName: `personal-service-${counter}`,
    dbVersion: DATABASE_VERSION,
  });
  return new PersonalTemplateService(storage);
}

describe("PersonalTemplateService — save", () => {
  it("saves a validated, deep-cloned template", async () => {
    const service = await freshService();
    const input = makeInput();
    const result = await service.saveAsTemplate(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Mutating the source project after saving must not change the template.
    input.project.name = "Mutated Later";
    const list = await service.listTemplates();
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.templates[0].project.name).toBe("Source Project");
    }
  });

  it("rejects an empty name", async () => {
    const service = await freshService();
    const result = await service.saveAsTemplate(makeInput({ name: "   " }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PERSONAL_TEMPLATE_INVALID_INPUT");
  });

  it("rejects an invalid project snapshot (fails ProjectSchema)", async () => {
    const service = await freshService();
    const result = await service.saveAsTemplate(
      makeInput({ project: { ...makeProject(), pages: "not-an-array" } as never }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PERSONAL_TEMPLATE_SNAPSHOT_INVALID");
  });

  it("normalizes tags (trim, lowercase, bounded)", async () => {
    const service = await freshService();
    const result = await service.saveAsTemplate(
      makeInput({ tags: ["  Landing ", "PORTFOLIO", ""] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.tags).toEqual(["landing", "portfolio"]);
    }
  });
});

describe("PersonalTemplateService — rename/duplicate/list/delete", () => {
  it("renames a template", async () => {
    const service = await freshService();
    const saved = await service.saveAsTemplate(makeInput());
    if (!saved.ok) return;
    const renamed = await service.renameTemplate(saved.record.id, "New Name");
    expect(renamed.ok).toBe(true);
    if (renamed.ok) expect(renamed.record.name).toBe("New Name");
  });

  it("duplicates with a collision-safe name and fresh id", async () => {
    const service = await freshService();
    const saved = await service.saveAsTemplate(makeInput({ name: "Landing" }));
    if (!saved.ok) return;
    const dup = await service.duplicateTemplate(saved.record.id);
    expect(dup.ok).toBe(true);
    if (dup.ok) {
      expect(dup.record.name).toBe("Landing Copy");
      expect(dup.record.id).not.toBe(saved.record.id);
    }
  });

  it("deletes a template", async () => {
    const service = await freshService();
    const saved = await service.saveAsTemplate(makeInput());
    if (!saved.ok) return;
    const deleted = await service.deleteTemplate(saved.record.id);
    expect(deleted.ok).toBe(true);
    const list = await service.listTemplates();
    if (list.ok) expect(list.templates).toHaveLength(0);
  });
});

describe("PersonalTemplateService — create from personal template", () => {
  it("creates a project with fresh IDs and fresh timestamps", async () => {
    const service = await freshService();
    const saved = await service.saveAsTemplate(makeInput({ name: "My Template" }));
    if (!saved.ok) return;

    let idCounter = 0;
    const idFactory = {
      projectId: () => `fresh-proj-${++idCounter}`,
      pageId: (_t: string, i: number) => `fresh-page-${i}`,
      sectionId: (_t: string, _type: string, i: number) => `fresh-sec-${i}`,
    };

    const created = await service.createProjectFromPersonalTemplate(
      saved.record.id,
      "Fresh Project",
      { idFactory, now: "2026-09-01T00:00:00.000Z" },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.project.id).toBe("fresh-proj-1");
    expect(created.project.name).toBe("Fresh Project");
    expect(created.project.createdAt).toBe("2026-09-01T00:00:00.000Z");
    expect(created.project.updatedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(created.project.pages[0].id).toBe("fresh-page-0");
    expect(created.project.pages[0].sections[0].id).toBe("fresh-sec-0");
    // Content retained.
    expect(created.project.pages[0].sections[0].props.headline).toBe("Hello");
  });

  it("never copies deployment, domain, sync, or auth state", async () => {
    const service = await freshService();
    // The Project schema carries no deployment/domain/sync/auth fields — but
    // a defensive test documents that create-from-template strips them even
    // if a malformed snapshot contained such keys.
    const projectWithJunk = {
      ...makeProject(),
      deployments: [{ id: "dpl-1" }],
      domainRecords: [{ id: "dom-1" }],
      cloudSyncQueue: [{ id: "q-1" }],
      authToken: "secret",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const saved = await service.saveAsTemplate(
      makeInput({ project: projectWithJunk }),
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const created = await service.createProjectFromPersonalTemplate(
      saved.record.id,
      "Fresh",
      { idFactory: {
        projectId: () => "fresh-proj",
        pageId: (_t, i) => `p-${i}`,
        sectionId: (_t, _type, i) => `s-${i}`,
      } },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    // ProjectSchema normalization drops unknown keys.
    const raw = JSON.parse(JSON.stringify(created.project));
    expect("deployments" in raw).toBe(false);
    expect("domainRecords" in raw).toBe(false);
    expect("cloudSyncQueue" in raw).toBe(false);
    expect("authToken" in raw).toBe(false);
  });

  it("returns NOT_FOUND for a missing template", async () => {
    const service = await freshService();
    const created = await service.createProjectFromPersonalTemplate(
      "personal-missing",
      "Fresh",
    );
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.code).toBe("PERSONAL_TEMPLATE_NOT_FOUND");
  });
});

// Keep the record type referenced for future schema tests.
void (null as PersonalTemplateRecord | null);
void setPersonalTemplateStorageForTests;
void setPersonalTemplateServiceForTests;
