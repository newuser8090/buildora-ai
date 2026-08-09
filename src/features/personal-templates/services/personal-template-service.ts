// ---------------------------------------------------------------------------
// Personal Templates (Phase P9) — service
//
// Framework-independent (no React, no Zustand). Handles:
//   - saveAsTemplate: validate input, deep-clone the project snapshot,
//     validate through ProjectSchema, enforce the local quota
//   - list / get / delete / rename / duplicate
//   - createProjectFromPersonalTemplate: build a fresh Project from a stored
//     snapshot with brand-new IDs (project + pages + sections) and reset
//     timestamps — content, styles, theme, site settings, and assets are
//     retained; deployment/domain/sync/revision state is never copied.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import { validateProjectName } from "@/features/projects/utils/validate-project-name";
import type { TemplateIdFactory } from "@/features/templates/types";
import { TEMPLATE_CATEGORY_LABELS } from "@/features/templates/types";
import { TemplateCategory } from "@/features/templates/types";
import {
  MAX_PERSONAL_TEMPLATES,
  MAX_TAG_LENGTH,
  MAX_TEMPLATE_DESCRIPTION_LENGTH,
  MAX_TEMPLATE_TAGS,
  type PersonalTemplateError,
  type PersonalTemplateRecord,
  type SaveAsTemplateInput,
  toPersonalTemplateError,
} from "../types";
import {
  getPersonalTemplateStorage,
  type PersonalTemplateStorageAdapter,
} from "../storage/personal-template-storage";

// ---------------------------------------------------------------------------
// Default ID factory — crypto.randomUUID at the orchestration boundary only.
// ---------------------------------------------------------------------------

function defaultProjectId(): string {
  return crypto.randomUUID();
}

export function createPersonalTemplateIdFactory(): TemplateIdFactory {
  return {
    projectId: defaultProjectId,
    pageId: (_templateId, index) => `page-${crypto.randomUUID()}-${index}`,
    sectionId: (_templateId, _type, index) =>
      `sec-${crypto.randomUUID()}-${index}`,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PersonalTemplateService {
  private storage: PersonalTemplateStorageAdapter;

  constructor(storage?: PersonalTemplateStorageAdapter) {
    this.storage = storage ?? getPersonalTemplateStorage();
  }

  /** Personal template ids use the "personal-" prefix. */
  isPersonalTemplateId(templateId: string): boolean {
    return templateId.startsWith("personal-");
  }

  // -----------------------------------------------------------------------
  // Save
  // -----------------------------------------------------------------------

  async saveAsTemplate(
    input: SaveAsTemplateInput,
  ): Promise<PersonalTemplateResult> {
    const name = input.name.trim();

    const nameValidation = validateProjectName(name);
    if (!nameValidation.valid) {
      return {
        ok: false,
        error: {
          code: "PERSONAL_TEMPLATE_INVALID_INPUT",
          message: nameValidation.error ?? "Enter a name for your template.",
        },
      };
    }

    const description = (input.description ?? "").trim();
    if (description.length > MAX_TEMPLATE_DESCRIPTION_LENGTH) {
      return {
        ok: false,
        error: {
          code: "PERSONAL_TEMPLATE_INVALID_INPUT",
          message: `Keep the description under ${MAX_TEMPLATE_DESCRIPTION_LENGTH} characters.`,
        },
      };
    }

    const tags = (input.tags ?? [])
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0)
      .slice(0, MAX_TEMPLATE_TAGS);
    for (const tag of tags) {
      if (tag.length > MAX_TAG_LENGTH) {
        return {
          ok: false,
          error: {
            code: "PERSONAL_TEMPLATE_INVALID_INPUT",
            message: `Keep tags under ${MAX_TAG_LENGTH} characters.`,
          },
        };
      }
    }

    // Deep-clone the snapshot so future project edits never mutate the saved
    // template (and vice versa).
    let snapshot: Project;
    try {
      snapshot = JSON.parse(JSON.stringify(input.project)) as Project;
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "PERSONAL_TEMPLATE_SNAPSHOT_INVALID",
          message: "This project could not be saved as a template.",
          cause: err instanceof Error ? err.message : String(err),
        },
      };
    }

    // Validate through the existing project schema — a template must always
    // be a valid project.
    const validation = ProjectSchema.safeParse(snapshot);
    if (!validation.success) {
      return {
        ok: false,
        error: {
          code: "PERSONAL_TEMPLATE_SNAPSHOT_INVALID",
          message: "This project could not be saved as a template.",
          cause: validation.error.issues
            .map((issue) => `${issue.path.join(".")} — ${issue.message}`)
            .join("; "),
        },
      };
    }

    const now = input.now ?? new Date().toISOString();
    const record: PersonalTemplateRecord = {
      id: input.id ?? `personal-${crypto.randomUUID()}`,
      name,
      description,
      category: input.category,
      tags,
      createdAt: now,
      updatedAt: now,
      source: "personal",
      project: validation.data,
    };

    const saved = await this.storage.saveTemplate(record);
    if (!saved.ok) return saved;
    return { ok: true, record: saved.value };
  }

  // -----------------------------------------------------------------------
  // Install a pre-validated record (Phase P13 imported templates)
  // -----------------------------------------------------------------------

  /**
   * Persist a fully-validated record (built by the template-package importer
   * after its own strict validation). Re-validates the essential invariants
   * before a single quota-enforcing storage write — a failed install never
   * leaves a half-installed template.
   */
  async installRecord(
    record: PersonalTemplateRecord,
  ): Promise<PersonalTemplateResult> {
    if (!record.id || !record.id.startsWith("personal-")) {
      return {
        ok: false,
        error: {
          code: "PERSONAL_TEMPLATE_INVALID_INPUT",
          message: "The template record is invalid.",
        },
      };
    }
    const nameValidation = validateProjectName(record.name);
    if (!nameValidation.valid) {
      return {
        ok: false,
        error: {
          code: "PERSONAL_TEMPLATE_INVALID_INPUT",
          message: nameValidation.error ?? "Invalid template name.",
        },
      };
    }
    const validation = ProjectSchema.safeParse(record.project);
    if (!validation.success) {
      return {
        ok: false,
        error: {
          code: "PERSONAL_TEMPLATE_SNAPSHOT_INVALID",
          message: "The template content is invalid.",
          cause: validation.error.issues
            .map((issue) => `${issue.path.join(".")} — ${issue.message}`)
            .join("; "),
        },
      };
    }

    const saved = await this.storage.saveTemplate({
      ...record,
      project: validation.data,
    });
    if (!saved.ok) return saved;
    return { ok: true, record: saved.value };
  }

  // -----------------------------------------------------------------------
  // List / get
  // -----------------------------------------------------------------------

  async listTemplates(): Promise<
    { ok: true; templates: PersonalTemplateRecord[] } | { ok: false; error: PersonalTemplateError }
  > {
    const result = await this.storage.listTemplates();
    if (!result.ok) return result;
    return { ok: true, templates: result.value };
  }

  async getTemplate(
    templateId: string,
  ): Promise<
    { ok: true; template: PersonalTemplateRecord | null } | { ok: false; error: PersonalTemplateError }
  > {
    const result = await this.storage.getTemplate(templateId);
    if (!result.ok) return result;
    return { ok: true, template: result.value };
  }

  async countTemplates(): Promise<{ ok: true; count: number } | { ok: false; error: PersonalTemplateError }> {
    const result = await this.storage.countTemplates();
    if (!result.ok) return result;
    return { ok: true, count: result.value };
  }

  // -----------------------------------------------------------------------
  // Delete / rename / duplicate
  // -----------------------------------------------------------------------

  async deleteTemplate(
    templateId: string,
  ): Promise<{ ok: true } | { ok: false; error: PersonalTemplateError }> {
    return this.storage.deleteTemplate(templateId);
  }

  async renameTemplate(
    templateId: string,
    newName: string,
  ): Promise<{ ok: true; record: PersonalTemplateRecord } | { ok: false; error: PersonalTemplateError }> {
    const nameValidation = validateProjectName(newName);
    if (!nameValidation.valid) {
      return {
        ok: false,
        error: {
          code: "PERSONAL_TEMPLATE_INVALID_INPUT",
          message: nameValidation.error ?? "Enter a name for your template.",
        },
      };
    }

    const got = await this.storage.getTemplate(templateId);
    if (!got.ok) return got;
    if (!got.value) {
      return {
        ok: false,
        error: {
          code: "PERSONAL_TEMPLATE_NOT_FOUND",
          message: "That template no longer exists.",
        },
      };
    }

    const updated: PersonalTemplateRecord = {
      ...got.value,
      name: newName.trim(),
      updatedAt: new Date().toISOString(),
    };
    const saved = await this.storage.saveTemplate(updated);
    if (!saved.ok) return saved;
    return { ok: true, record: saved.value };
  }

  async duplicateTemplate(
    templateId: string,
  ): Promise<{ ok: true; record: PersonalTemplateRecord } | { ok: false; error: PersonalTemplateError }> {
    const got = await this.storage.getTemplate(templateId);
    if (!got.ok) return got;
    if (!got.value) {
      return {
        ok: false,
        error: {
          code: "PERSONAL_TEMPLATE_NOT_FOUND",
          message: "That template no longer exists.",
        },
      };
    }

    const list = await this.storage.listTemplates();
    const existingNames = list.ok ? list.value.map((t) => t.name) : [];
    const name = generateDuplicateTemplateName(got.value.name, existingNames);
    const now = new Date().toISOString();

    const record: PersonalTemplateRecord = {
      ...got.value,
      id: `personal-${crypto.randomUUID()}`,
      name,
      createdAt: now,
      updatedAt: now,
    };
    const saved = await this.storage.saveTemplate(record);
    if (!saved.ok) return saved;
    return { ok: true, record: saved.value };
  }

  // -----------------------------------------------------------------------
  // Create project from personal template (fresh IDs)
  // -----------------------------------------------------------------------

  async createProjectFromPersonalTemplate(
    templateId: string,
    projectName: string,
    options?: { idFactory?: TemplateIdFactory; now?: string },
  ): Promise<CreateFromPersonalTemplateResult> {
    const got = await this.storage.getTemplate(templateId);
    if (!got.ok) {
      return {
        ok: false,
        error: {
          code: "PERSONAL_TEMPLATE_NOT_FOUND",
          message: got.error.message,
          cause: got.error.cause,
        },
      };
    }
    if (!got.value) {
      return {
        ok: false,
        error: {
          code: "PERSONAL_TEMPLATE_NOT_FOUND",
          message: `Template "${templateId}" was not found.`,
        },
      };
    }

    const nameValidation = validateProjectName(projectName);
    if (!nameValidation.valid) {
      return {
        ok: false,
        error: {
          code: "PERSONAL_TEMPLATE_INVALID_INPUT",
          message: nameValidation.error ?? "Invalid project name.",
        },
      };
    }

    const idFactory = options?.idFactory ?? createPersonalTemplateIdFactory();
    const now = options?.now ?? new Date().toISOString();

    let built: Project;
    try {
      built = JSON.parse(JSON.stringify(got.value.project)) as Project;
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "PERSONAL_TEMPLATE_SNAPSHOT_INVALID",
          message: "The saved template could not be used.",
          cause: err instanceof Error ? err.message : String(err),
        },
      };
    }

    // Fresh identity + reset timestamps. Content/styles/settings are kept.
    built.id = idFactory.projectId();
    built.name = projectName.trim();
    built.createdAt = now;
    built.updatedAt = now;
    built.pages = built.pages.map((page, pageIndex) => {
      const freshPage = {
        ...page,
        id: idFactory.pageId(templateId, pageIndex),
      };
      freshPage.sections = page.sections.map((section, sectionIndex) => ({
        ...section,
        id: idFactory.sectionId(templateId, section.type, sectionIndex),
      }));
      return freshPage;
    });

    const validation = ProjectSchema.safeParse(built);
    if (!validation.success) {
      return {
        ok: false,
        error: {
          code: "PERSONAL_TEMPLATE_SNAPSHOT_INVALID",
          message: "The saved template produced an invalid project.",
          cause: validation.error.issues
            .map((issue) => `${issue.path.join(".")} — ${issue.message}`)
            .join("; "),
        },
      };
    }

    return { ok: true, project: validation.data };
  }
}

export type PersonalTemplateResult =
  | { ok: true; record: PersonalTemplateRecord }
  | { ok: false; error: PersonalTemplateError };

export type CreateFromPersonalTemplateResult =
  | { ok: true; project: Project }
  | { ok: false; error: PersonalTemplateError };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateDuplicateTemplateName(
  originalName: string,
  existingNames: string[],
): string {
  const baseName = `${originalName} Copy`;
  if (!existingNames.includes(baseName)) return baseName;
  let counter = 2;
  while (existingNames.includes(`${baseName} ${counter}`)) {
    counter += 1;
  }
  return `${baseName} ${counter}`;
}

/** All valid categories for the save dialog (never "blank"). */
export const SAVABLE_TEMPLATE_CATEGORIES = Object.keys(
  TEMPLATE_CATEGORY_LABELS,
).filter((c) => c !== "blank") as TemplateCategory[];

// Keep MAX_PERSONAL_TEMPLATES referenced so quota stays importable by callers.
export { MAX_PERSONAL_TEMPLATES };

// Re-export for callers that only need the category type.
export type { TemplateCategory };

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let serviceSingleton: PersonalTemplateService | null = null;

export function getPersonalTemplateService(): PersonalTemplateService {
  if (!serviceSingleton) {
    serviceSingleton = new PersonalTemplateService();
  }
  return serviceSingleton;
}

export function setPersonalTemplateServiceForTests(
  service: PersonalTemplateService | null,
): void {
  serviceSingleton = service;
}

// Suppress unused-import warnings for the error helper re-exported for tests.
void toPersonalTemplateError;
