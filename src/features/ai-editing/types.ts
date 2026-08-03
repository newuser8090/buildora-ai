// ---------------------------------------------------------------------------
// AI Editing — types
//
// AI editing lets a user modify a selected section's content with a
// natural-language instruction. It reuses the generation provider
// abstraction (Gemini + rule-based fallback), the per-type section schemas,
// and the editor store mutations. mode: "create" (full generation) is
// untouched; this feature implements mode: "modify".
// ---------------------------------------------------------------------------

import type { SUPPORTED_SECTION_TYPES } from "@/features/generation/providers/generation-provider";

// ---------------------------------------------------------------------------
// Target — what the user wants edited
// ---------------------------------------------------------------------------

export type EditSectionType = (typeof SUPPORTED_SECTION_TYPES)[number];

/**
 * The edit target. Phase K supports section-level edits; the kind union
 * leaves room for page/project targets later.
 */
export interface EditTarget {
  kind: "section";
  /** Client-side id of the section being edited (used to apply the result). */
  sectionId: string;
  /** Section type, e.g. "hero". Must be a supported type. */
  type: string;
  /** Human-readable label for chat/UI, e.g. "Hero section". */
  label?: string;
  /** The section's current props — sent so the AI edits against real content. */
  props: Record<string, unknown>;
  /** Optional context (e.g. brand name) for better copy. */
  context?: {
    brandName?: string;
  };
}

// ---------------------------------------------------------------------------
// Result — the edited content
// ---------------------------------------------------------------------------

/** One edited section: its type plus the full revised props. */
export interface EditedSection {
  type: string;
  props: Record<string, unknown>;
}

export interface EditResult {
  edits: EditedSection[];
}

// ---------------------------------------------------------------------------
// Provider contract (mirrors GenerationProvider for create mode)
// ---------------------------------------------------------------------------

export interface EditProviderInput {
  prompt: string;
  target: EditTarget;
}

export interface EditProviderResult {
  edits: EditedSection[];
  source: "gemini" | "rule-based";
  warnings: string[];
}

export interface EditProvider {
  readonly id: string;
  editContent(input: EditProviderInput): Promise<EditProviderResult>;
}
