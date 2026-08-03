// ---------------------------------------------------------------------------
// Templates — framework-independent data model
//
// Templates are deterministic fixtures: they contain no React components,
// no persistence adapter dependencies, no Zustand, no browser APIs, and no
// runtime timestamps or random IDs. All identity and time values are injected
// through TemplateCreationContext at creation time.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type TemplateCategory =
  | "blank"
  | "business"
  | "portfolio"
  | "commerce"
  | "food"
  | "landing-page";

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  blank: "Blank",
  business: "Business",
  portfolio: "Portfolio",
  commerce: "Commerce",
  food: "Food",
  "landing-page": "Landing Page",
};

// ---------------------------------------------------------------------------
// Preview model — a lightweight, deterministic visual representation.
// No screenshots, no hidden editor projects, no iframes, no remote images.
// ---------------------------------------------------------------------------

export type TemplatePreviewSectionKind =
  | "header"
  | "hero"
  | "content"
  | "pricing"
  | "cta"
  | "footer";

export interface TemplatePreviewSection {
  /** Kind drives the mock block shape in the preview frame. */
  kind: TemplatePreviewSectionKind;
  label: string;
}

export interface TemplatePreview {
  /** Accent color used in the preview frame. */
  accent?: string;
  /** Background color used in the preview frame. */
  background?: string;
  /** Short badge label, e.g. "Featured". */
  badge?: string;
  sections: TemplatePreviewSection[];
}

// ---------------------------------------------------------------------------
// ID factory — injected into the template creation layer so templates never
// call crypto.randomUUID() themselves.
// ---------------------------------------------------------------------------

export interface TemplateIdFactory {
  projectId(): string;
  pageId(templateId: string, index: number): string;
  sectionId(templateId: string, type: string, index: number): string;
}

// ---------------------------------------------------------------------------
// Creation context — everything a template needs to build a Project.
// Deterministic per call when the caller injects fixed values.
// ---------------------------------------------------------------------------

export interface TemplateCreationContext {
  /** Stable template ID (e.g. "template-saas") — used as an ID prefix. */
  templateId: string;
  projectId: string;
  projectName: string;
  createdAt: string;
  updatedAt: string;
  /** Injected ID factory — page/section IDs come from here, never from
   *  crypto.randomUUID() inside template definitions. */
  ids: TemplateIdFactory;
}

// ---------------------------------------------------------------------------
// Template definition
// ---------------------------------------------------------------------------

export interface BuildoraTemplate {
  /** Stable, unique ID, e.g. "template-saas". Never changes across releases. */
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  tags: string[];
  featured?: boolean;
  /** Lower numbers sort first. Blank typically uses 0. */
  sortOrder?: number;
  /** Default project name when this template is chosen. */
  defaultName: string;
  preview: TemplatePreview;
  /**
   * Build a fresh Project from the injected context. Must:
   *  - return a complete, schema-valid Project
   *  - use context.ids for every page/section ID
   *  - use context.createdAt/updatedAt (never new Date())
   *  - not share mutable references across calls
   */
  createProject(context: TemplateCreationContext): Project;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type TemplateErrorCode =
  | "TEMPLATE_NOT_FOUND"
  | "INVALID_PROJECT_NAME"
  | "TEMPLATE_CREATION_FAILED"
  | "TEMPLATE_VALIDATION_FAILED"
  | "DUPLICATE_TEMPLATE_ID"
  | "UNKNOWN_TEMPLATE_ERROR";

export interface TemplateErrorInput {
  code: TemplateErrorCode;
  /** User-safe message suitable for display. */
  message: string;
  templateId?: string;
  /** Internal technical detail — never exposed as a raw stack trace. */
  cause?: unknown;
}

export class TemplateError extends Error {
  readonly code: TemplateErrorCode;
  readonly templateId?: string;
  readonly cause?: unknown;

  constructor(input: TemplateErrorInput) {
    super(input.message);
    this.name = "TemplateError";
    this.code = input.code;
    this.templateId = input.templateId;
    this.cause = input.cause;
  }
}
