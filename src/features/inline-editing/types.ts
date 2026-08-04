// ---------------------------------------------------------------------------
// Inline editing — Phase M model types
//
// Framework-independent editable field model. No React, no Zustand, no DOM.
// The registry (registry/editable-field-registry.ts) produces descriptors for
// a live section; the pure update service (services/field-update.ts) applies
// a validated value; the transient store holds selection/suggestion state.
//
// Guarantees:
//   - only registered safe fields are ever editable
//   - no href / AssetRef / price / id / structural field exposed as plain text
//   - field paths are validated before any update
//   - suggestions are data, never applied automatically
// ---------------------------------------------------------------------------

import type { SectionType } from "@/features/editor/section-library/types";

// ---------------------------------------------------------------------------
// Editable field model
// ---------------------------------------------------------------------------

export type EditableFieldKind =
  | "text"
  | "textarea"
  | "link-text"
  | "button-text"
  | "heading"
  | "description";

/** A path segment into section props: object keys or array indices. */
export type FieldPathSegment = string | number;

export interface EditableFieldDescriptor {
  pageId: string;
  sectionId: string;
  sectionType: SectionType;
  /** Concrete path into section.props, e.g. ["headline"] or ["features", 2, "title"]. */
  fieldPath: FieldPathSegment[];
  kind: EditableFieldKind;
  label: string;
  currentValue: string;
  maxLength?: number;
  aiEditable: boolean;
}

/** Registry definition (path template; "*" marks an array index). */
export interface EditableFieldDefinition {
  /** Stable id, e.g. "hero.headline" or "features.feature.title". */
  id: string;
  kind: EditableFieldKind;
  label: string;
  /** Path template with "*" placeholders for array indices. */
  path: string[];
  maxLength?: number;
  aiEditable: boolean;
}

// ---------------------------------------------------------------------------
// Inline AI suggestion
// ---------------------------------------------------------------------------

export interface InlineAiSuggestion {
  id: string;
  projectId: string;
  /** Editor revision the suggestion was created against. Stale when it differs. */
  baseRevision: number;
  pageId: string;
  sectionId: string;
  sectionType: SectionType;
  fieldPath: FieldPathSegment[];
  originalValue: string;
  suggestedValue: string;
  instruction: string;
  explanation?: string;
  provider: "gemini" | "rule-based";
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Structured errors
// ---------------------------------------------------------------------------

export type InlineAiErrorCode =
  | "INLINE_FIELD_NOT_FOUND"
  | "INLINE_FIELD_UNSUPPORTED"
  | "INLINE_FIELD_PATH_INVALID"
  | "INLINE_VALUE_INVALID"
  | "INLINE_SUGGESTION_FAILED"
  | "INLINE_SUGGESTION_INVALID"
  | "INLINE_SUGGESTION_STALE"
  | "INLINE_PROJECT_MISMATCH"
  | "INLINE_REVISION_MISMATCH"
  | "INLINE_APPLY_FAILED"
  | "INLINE_NO_CHANGE"
  | "INLINE_REQUEST_CANCELLED";

export interface InlineAiError {
  code: InlineAiErrorCode;
  /** User-safe message suitable for display. */
  message: string;
}

// ---------------------------------------------------------------------------
// Provider contracts
// ---------------------------------------------------------------------------

export interface InlineSuggestionInput {
  instruction: string;
  projectId: string;
  baseRevision: number;
  pageId: string;
  sectionId: string;
  /** Section type key — validated against the registry server-side. */
  sectionType: string;
  fieldPath: FieldPathSegment[];
  fieldKind: EditableFieldKind;
  currentValue: string;
  /** Optional section context digest (capped). */
  surroundingContext?: string;
  /** Regenerate counter — providers may use it for deterministic variation. */
  variant?: number;
}

export type InlineSuggestionProviderResult =
  | {
      ok: true;
      suggestion: {
        suggestedValue: string;
        explanation?: string;
      };
      warnings: string[];
    }
  | { ok: false; error: InlineAiError; warnings?: string[] };

export interface InlineSuggestionProvider {
  readonly id: string;
  suggest(input: InlineSuggestionInput): Promise<InlineSuggestionProviderResult>;
}

// ---------------------------------------------------------------------------
// Orchestrator result (server side)
// ---------------------------------------------------------------------------

export type InlineOrchestrationResult =
  | {
      ok: true;
      source: "gemini" | "rule-based";
      suggestion: InlineAiSuggestion;
      warnings: string[];
    }
  | { ok: false; error: InlineAiError; warnings?: string[] };

// ---------------------------------------------------------------------------
// Store application result
// ---------------------------------------------------------------------------

export type InlineFieldUpdateResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: InlineAiError };
