// ---------------------------------------------------------------------------
// TemplateProjectFactory
//
// Builds a fresh, schema-valid Project from a registered template. Pure and
// framework-independent:
//   - resolves the template from a registry
//   - validates the project name with validateProjectName()
//   - generates/accepted project ID through an injected TemplateIdFactory
//   - uses one injected clock value for both timestamps
//   - deep-clones the template output for full independence
//   - normalizes and validates through the existing Project schema
//
// Creation and persistence remain separate — this factory never saves.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import { validateProjectName } from "@/features/projects/utils/validate-project-name";
import { templateRegistry, TemplateRegistry } from "../registry/template-registry";
import type {
  BuildoraTemplate,
  TemplateError,
  TemplateIdFactory,
} from "../types";
import { TemplateError as TemplateErrorClass } from "../types";

// ---------------------------------------------------------------------------
// Request / result types
// ---------------------------------------------------------------------------

export interface CreateProjectFromTemplateRequest {
  templateId: string;
  projectName: string;
  /** Optional explicit project ID — overrides the injected factory. */
  projectId?: string;
  /** Optional injected clock value (ISO string). Defaults to new Date(). */
  now?: string;
  /** Optional injected ID factory — defaults to crypto.randomUUID. */
  idFactory?: TemplateIdFactory;
  /** Optional registry — defaults to the application singleton. */
  registry?: TemplateRegistry;
}

export type CreateProjectFromTemplateResult =
  | { ok: true; project: Project; template: BuildoraTemplate }
  | { ok: false; error: TemplateError };

// ---------------------------------------------------------------------------
// Default ID factory — crypto.randomUUID at the orchestration boundary only.
// ---------------------------------------------------------------------------

function defaultProjectId(): string {
  return crypto.randomUUID();
}

function defaultSectionId(_templateId: string, _type: string, index: number): string {
  return `sec-${crypto.randomUUID()}-${index}`;
}

export function createDefaultTemplateIdFactory(): TemplateIdFactory {
  return {
    projectId: defaultProjectId,
    pageId: (_templateId, index) => `page-${crypto.randomUUID()}-${index}`,
    sectionId: defaultSectionId,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export class TemplateProjectFactory {
  private readonly registry: TemplateRegistry;
  private readonly defaultIdFactory: TemplateIdFactory;

  constructor(options?: { registry?: TemplateRegistry; idFactory?: TemplateIdFactory }) {
    this.registry = options?.registry ?? templateRegistry;
    this.defaultIdFactory = options?.idFactory ?? createDefaultTemplateIdFactory();
  }

  /**
   * Create a fresh Project from a template.
   *
   * Steps:
   *   1. Resolve template (TEMPLATE_NOT_FOUND)
   *   2. Validate project name (INVALID_PROJECT_NAME)
   *   3. Resolve project ID + single clock value
   *   4. Call template.createProject(context) (TEMPLATE_CREATION_FAILED)
   *   5. Deep-clone for independence
   *   6. Validate against ProjectSchema (TEMPLATE_VALIDATION_FAILED)
   *
   * Does NOT persist anything.
   */
  createProjectFromTemplate(
    request: CreateProjectFromTemplateRequest,
  ): CreateProjectFromTemplateResult {
    // ---- 1. Resolve template ----
    const template = this.registry.get(request.templateId);
    if (!template) {
      return {
        ok: false,
        error: new TemplateErrorClass({
          code: "TEMPLATE_NOT_FOUND",
          message: `Template "${request.templateId}" was not found.`,
          templateId: request.templateId,
        }),
      };
    }

    // ---- 2. Validate project name (canonical) ----
    const nameValidation = validateProjectName(request.projectName);
    if (!nameValidation.valid) {
      return {
        ok: false,
        error: new TemplateErrorClass({
          code: "INVALID_PROJECT_NAME",
          message: nameValidation.error ?? "Invalid project name.",
          templateId: template.id,
        }),
      };
    }

    // ---- 3. Identity + one clock value ----
    const idFactory = request.idFactory ?? this.defaultIdFactory;
    const projectId = request.projectId ?? idFactory.projectId();
    const now = request.now ?? new Date().toISOString();

    // ---- 4. Build via template ----
    let built: Project;
    try {
      built = template.createProject({
        templateId: template.id,
        projectId,
        projectName: request.projectName.trim(),
        createdAt: now,
        updatedAt: now,
        ids: idFactory,
      });
    } catch (err) {
      return {
        ok: false,
        error: new TemplateErrorClass({
          code: "TEMPLATE_CREATION_FAILED",
          message: `Template "${template.id}" could not build a project.`,
          templateId: template.id,
          cause: err,
        }),
      };
    }

    // ---- 5. Deep-clone — guarantees no shared mutable references with the
    //         template definition, the registry, or any other created project.
    let cloned: Project;
    try {
      cloned = JSON.parse(JSON.stringify(built)) as Project;
    } catch (err) {
      return {
        ok: false,
        error: new TemplateErrorClass({
          code: "TEMPLATE_CREATION_FAILED",
          message: `Template "${template.id}" produced non-cloneable data.`,
          templateId: template.id,
          cause: err,
        }),
      };
    }

    // ---- 6. Normalize + validate through the existing Project schema ----
    const validation = ProjectSchema.safeParse(cloned);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((issue) => `${issue.path.join(".")} — ${issue.message}`)
        .join("; ");
      return {
        ok: false,
        error: new TemplateErrorClass({
          code: "TEMPLATE_VALIDATION_FAILED",
          message: `Template "${template.id}" produced an invalid project: ${issues}`,
          templateId: template.id,
          cause: issues,
        }),
      };
    }

    return { ok: true, project: validation.data, template };
  }
}

/** Convenience singleton with default registry + ID factory. */
export const templateProjectFactory = new TemplateProjectFactory();
