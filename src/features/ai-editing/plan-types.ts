// ---------------------------------------------------------------------------
// AI editing — Phase L plan model types
//
// Phase L expands the Phase K one-section edit into page-level and
// project-level AI editing with previewable plans, selective application, and
// one-step undo. This module defines the versioned plan model only — it
// contains NO logic. Validation lives in schemas/plan-schemas.ts, planning in
// planner/, pure simulation in services/plan-simulator.ts, and atomic
// application in the editor store.
//
// Guarantees:
//   - the AI never mutates the editor store directly
//   - a plan is data, not code — no executable payloads, no arbitrary
//     property paths, no JSON Patch against the Project object
// ---------------------------------------------------------------------------

import type { BaseSection } from "@/types/section";
import type { Page, PageMeta, Project } from "@/types/project";

// ---------------------------------------------------------------------------
// Scopes — what the user wants edited
// ---------------------------------------------------------------------------

export type AiEditScope =
  | { type: "section"; pageId: string; sectionId: string }
  | { type: "page"; pageId: string }
  | { type: "project" };

/**
 * Explicit user-facing scope pick. "current-section"/"current-page" resolve
 * against live selection; "specific-page"/"entire-project" are explicit.
 * Scope is UI/transient state only — it never enters ProjectSchema.
 */
export type AiEditTarget =
  | { type: "current-section" }
  | { type: "current-page" }
  | { type: "specific-page"; pageId: string }
  | { type: "entire-project" };

export function scopeLabel(scope: AiEditScope): string {
  switch (scope.type) {
    case "section":
      return "selected section";
    case "page":
      return "current page";
    case "project":
      return "entire website";
  }
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

export interface AiEditWarning {
  code: string;
  message: string;
  /** Optional operation this warning relates to. */
  operationId?: string;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export type AiEditOperationType =
  | "update-section-props"
  | "update-section-styles"
  | "insert-section"
  | "delete-section"
  | "duplicate-section"
  | "move-section"
  | "set-section-visibility"
  | "add-page"
  | "rename-page"
  | "delete-page"
  | "move-page"
  | "update-page-meta";

export type AiEditRisk = "low" | "medium" | "high";

export interface AiEditOperationBase {
  /** Unique id inside the plan (referenced by dependsOn). */
  id: string;
  type: AiEditOperationType;
  /** Page the operation targets (optional for project-level ops). */
  pageId?: string;
  /** Section the operation targets (optional for page-level ops). */
  sectionId?: string;
  /** Short human-readable label, e.g. "Hero rewritten". */
  label: string;
  /** One-sentence explanation shown in the review UI. */
  explanation: string;
  risk: AiEditRisk;
  /**
   * Ids of earlier operations this one depends on (e.g. an update that
   * targets a section inserted by a previous operation). Dependencies must
   * appear earlier in the plan and remain selected when this op is selected.
   */
  dependsOn?: string[];
}

export interface UpdateSectionPropsOperation extends AiEditOperationBase {
  type: "update-section-props";
  pageId: string;
  sectionId: string;
  /** Must match the current section type at application time. */
  sectionType: string;
  /** Complete revised props for the section (validated per type). */
  nextProps: Record<string, unknown>;
}

export interface UpdateSectionStylesOperation extends AiEditOperationBase {
  type: "update-section-styles";
  pageId: string;
  sectionId: string;
  nextStyles: Record<string, unknown>;
}

export type SectionInsertPosition =
  | { type: "start" }
  | { type: "end" }
  | { type: "before"; sectionId: string }
  | { type: "after"; sectionId: string };

export interface InsertSectionOperation extends AiEditOperationBase {
  type: "insert-section";
  pageId: string;
  sectionType: string;
  /** Full section object; order is normalized on application. */
  section: BaseSection;
  position: SectionInsertPosition;
}

export interface DeleteSectionOperation extends AiEditOperationBase {
  type: "delete-section";
  pageId: string;
  sectionId: string;
}

export interface DuplicateSectionOperation extends AiEditOperationBase {
  type: "duplicate-section";
  pageId: string;
  sectionId: string;
  newSectionId: string;
}

export interface MoveSectionOperation extends AiEditOperationBase {
  type: "move-section";
  pageId: string;
  sectionId: string;
  targetIndex: number;
}

export interface SetSectionVisibilityOperation extends AiEditOperationBase {
  type: "set-section-visibility";
  pageId: string;
  sectionId: string;
  visible: boolean;
}

export interface AddPageOperation extends AiEditOperationBase {
  type: "add-page";
  /** Full page object; slug must be valid and unique. */
  page: Page;
  /** Optional target index (default: append to end). */
  position?: number;
}

export interface RenamePageOperation extends AiEditOperationBase {
  type: "rename-page";
  pageId: string;
  title: string;
}

export interface DeletePageOperation extends AiEditOperationBase {
  type: "delete-page";
  pageId: string;
}

export interface MovePageOperation extends AiEditOperationBase {
  type: "move-page";
  pageId: string;
  targetIndex: number;
}

export interface UpdatePageMetaOperation extends AiEditOperationBase {
  type: "update-page-meta";
  pageId: string;
  meta: PageMeta;
}

export type AiEditOperation =
  | UpdateSectionPropsOperation
  | UpdateSectionStylesOperation
  | InsertSectionOperation
  | DeleteSectionOperation
  | DuplicateSectionOperation
  | MoveSectionOperation
  | SetSectionVisibilityOperation
  | AddPageOperation
  | RenamePageOperation
  | DeletePageOperation
  | MovePageOperation
  | UpdatePageMetaOperation;

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export const AI_EDIT_PLAN_VERSION = 1 as const;

export interface AiEditPlan {
  version: typeof AI_EDIT_PLAN_VERSION;
  id: string;
  projectId: string;
  /** Editor revision the plan was created against. Stale when it differs. */
  baseRevision: number;
  scope: AiEditScope;
  instruction: string;
  summary: string;
  operations: AiEditOperation[];
  warnings: AiEditWarning[];
  createdAt: string;
  provider: "gemini" | "rule-based";
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type AiEditPlanErrorCode =
  | "PLAN_REQUEST_INVALID"
  | "PLAN_PROVIDER_FAILED"
  | "PLAN_VALIDATION_FAILED"
  | "PLAN_TOO_LARGE"
  | "PLAN_STALE"
  | "PLAN_PROJECT_MISMATCH"
  | "PLAN_OPERATION_UNSUPPORTED"
  | "PLAN_OPERATION_INVALID"
  | "PLAN_DEPENDENCY_INVALID"
  | "PLAN_SIMULATION_FAILED"
  | "PLAN_APPLY_FAILED"
  | "PLAN_NO_CHANGES"
  | "PLAN_DESTRUCTIVE_CONFIRMATION_REQUIRED"
  | "PLAN_SCOPE_INVALID"
  | "PLAN_READONLY";

export interface AiEditPlanError {
  code: AiEditPlanErrorCode;
  /** User-safe message suitable for display. */
  message: string;
  /** Operation that caused the failure, when applicable. */
  operationId?: string;
  /** Field path that caused the failure, when applicable. */
  field?: string;
}

// ---------------------------------------------------------------------------
// Simulation results
// ---------------------------------------------------------------------------

export interface AiOperationSimulationResult {
  operationId: string;
  ok: true;
  kind: "applied" | "no-op";
  /** Human-readable detail, e.g. "Moved CTA to position 4". */
  detail?: string;
}

export type SimulatePlanResult =
  | {
      ok: true;
      project: Project;
      operationResults: AiOperationSimulationResult[];
      warnings: AiEditWarning[];
      /**
       * Project state before each operation (index i = state before op i)
       * plus the final state at index operations.length. Only populated when
       * captureSnapshots is enabled (preview/diff path).
       */
      snapshots: Project[];
    }
  | {
      ok: false;
      error: AiEditPlanError;
      failedOperationId?: string;
    };

// ---------------------------------------------------------------------------
// Store application result
// ---------------------------------------------------------------------------

export type AiEditApplyResult =
  | {
      ok: true;
      changed: boolean;
      applied: number;
      skipped: number;
      operationResults: AiOperationSimulationResult[];
    }
  | { ok: false; error: AiEditPlanError };

// ---------------------------------------------------------------------------
// Diffs — structured, safe change representation for the review UI
// ---------------------------------------------------------------------------

export type AiEditDiffKind =
  | "text"
  | "structure"
  | "visibility"
  | "metadata"
  | "page";

export interface AiEditDiffField {
  key: string;
  label: string;
  /** Before value (absent for pure insertions). */
  before?: unknown;
  /** After value (absent for pure deletions). */
  after?: unknown;
}

export interface AiEditDiff {
  operationId: string;
  kind: AiEditDiffKind;
  fields: AiEditDiffField[];
}

// ---------------------------------------------------------------------------
// Planner contract
// ---------------------------------------------------------------------------

export interface AiEditPlannerInput {
  instruction: string;
  scope: AiEditScope;
  /** Read-only project snapshot — planners must never mutate it. */
  project: Project;
  selectedPageId?: string;
  selectedSectionId?: string;
  baseRevision: number;
}

export type AiEditPlannerResult =
  | { ok: true; plan: AiEditPlan; warnings: string[] }
  | { ok: false; error: AiEditPlanError; warnings?: string[] };

export interface AiEditPlanner {
  readonly id: string;
  createPlan(input: AiEditPlannerInput): Promise<AiEditPlannerResult>;
}
