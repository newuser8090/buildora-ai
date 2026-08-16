// ---------------------------------------------------------------------------
// TemplateProjectFactory
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import { validateProjectName } from "@/features/projects/utils/validate-project-name";
import { stripCustomCodeFromProject } from "@/features/code-import/services/strip-custom-code";
import { templateRegistry, TemplateRegistry } from "../registry/template-registry";
import type { BuildoraTemplate, TemplateError, TemplateIdFactory } from "../types";
import { TemplateError as TemplateErrorClass } from "../types";

export interface CreateProjectFromTemplateRequest {
  templateId: string;
  projectName: string;
  projectId?: string;
  now?: string;
  idFactory?: TemplateIdFactory;
  registry?: TemplateRegistry;
}

export type CreateProjectFromTemplateResult =
  | { ok: true; project: Project; template: BuildoraTemplate }
  | { ok: false; error: TemplateError };

function defaultProjectId(): string { return crypto.randomUUID(); }
function defaultSectionId(_templateId: string, _type: string, index: number): string { return `sec-${crypto.randomUUID()}-${index}`; }
export function createDefaultTemplateIdFactory(): TemplateIdFactory {
  return {
    projectId: defaultProjectId,
    pageId: (_templateId, index) => `page-${crypto.randomUUID()}-${index}`,
    sectionId: defaultSectionId,
  };
}

export class TemplateProjectFactory {
  private readonly registry: TemplateRegistry;
  private readonly defaultIdFactory: TemplateIdFactory;

  constructor(options?: { registry?: TemplateRegistry; idFactory?: TemplateIdFactory }) {
    this.registry = options?.registry ?? templateRegistry;
    this.defaultIdFactory = options?.idFactory ?? createDefaultTemplateIdFactory();
  }

  createProjectFromTemplate(request: CreateProjectFromTemplateRequest): CreateProjectFromTemplateResult {
    const template = this.registry.get(request.templateId);
    if (!template) {
      return { ok: false, error: new TemplateErrorClass({ code: "TEMPLATE_NOT_FOUND", message: `Template "${request.templateId}" was not found.`, templateId: request.templateId }) };
    }

    const nameValidation = validateProjectName(request.projectName);
    if (!nameValidation.valid) {
      return { ok: false, error: new TemplateErrorClass({ code: "INVALID_PROJECT_NAME", message: nameValidation.error ?? "Invalid project name.", templateId: template.id }) };
    }

    const idFactory = request.idFactory ?? this.defaultIdFactory;
    const projectId = request.projectId ?? idFactory.projectId();
    const now = request.now ?? new Date().toISOString();

    let built: Project;
    try {
      built = template.createProject({ templateId: template.id, projectId, projectName: request.projectName.trim(), createdAt: now, updatedAt: now, ids: idFactory });
    } catch (err) {
      return { ok: false, error: new TemplateErrorClass({ code: "TEMPLATE_CREATION_FAILED", message: `Template "${template.id}" could not build a project.`, templateId: template.id, cause: err }) };
    }

    let cloned: Project;
    try {
      cloned = stripCustomCodeFromProject(JSON.parse(JSON.stringify(built)) as Project);
    } catch (err) {
      return { ok: false, error: new TemplateErrorClass({ code: "TEMPLATE_CREATION_FAILED", message: `Template "${template.id}" produced non-cloneable data.`, templateId: template.id, cause: err }) };
    }

    const validation = ProjectSchema.safeParse(cloned);
    if (!validation.success) {
      const issues = validation.error.issues.map((issue) => `${issue.path.join(".")} — ${issue.message}`).join("; ");
      return { ok: false, error: new TemplateErrorClass({ code: "TEMPLATE_VALIDATION_FAILED", message: `Template "${template.id}" produced an invalid project: ${issues}`, templateId: template.id, cause: issues }) };
    }

    return { ok: true, project: validation.data, template };
  }
}

export const templateProjectFactory = new TemplateProjectFactory();
