// ---------------------------------------------------------------------------
// Section Library — model types
//
// The section library is a framework-independent catalogue of the sections a
// user can add to a page. It stores NO React components, NO Zustand state, NO
// browser APIs and NO persistence hooks — only data + deterministic default
// factories. The editor UI resolves definitions from this library and creates
// validated Section objects through the SectionFactory.
// ---------------------------------------------------------------------------

import type { SectionPropsMap } from "@/types/section";

// ---------------------------------------------------------------------------
// SectionType — the union of every known section type
// ---------------------------------------------------------------------------

export type SectionType = keyof SectionPropsMap;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type SectionLibraryCategory =
  | "navigation"
  | "hero"
  | "content"
  | "commerce"
  | "conversion"
  | "footer";

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export interface SectionLibraryDefinition<
  T extends SectionType = SectionType,
> {
  type: T;
  name: string;
  description: string;
  category: SectionLibraryCategory;
  keywords: string[];
  /** Framework-independent icon key — the UI layer maps this to an icon. */
  iconKey: string;
  recommendedPosition?: "top" | "middle" | "bottom";
  /** Singleton sections may only appear once per page. */
  singleton?: boolean;
  /** Deterministic ordering inside the library UI. */
  sortOrder?: number;
  /** Returns fresh, typed default props. Must never return shared references. */
  createProps: () => SectionPropsMap[T];
  /** Returns fresh default styles (plain object). */
  createStyles: () => Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Singleton policy — Header and Footer are unique per page
// ---------------------------------------------------------------------------

export const SINGLETON_SECTION_TYPES: ReadonlySet<SectionType> = new Set([
  "header",
  "footer",
]);

export function isSingletonSectionType(type: string): boolean {
  return SINGLETON_SECTION_TYPES.has(type as SectionType);
}

// ---------------------------------------------------------------------------
// Structured errors
// ---------------------------------------------------------------------------

export type SectionLibraryErrorCode =
  | "SECTION_DEFINITION_NOT_FOUND"
  | "SECTION_CREATION_FAILED"
  | "SECTION_VALIDATION_FAILED"
  | "SECTION_ID_CONFLICT"
  | "SINGLETON_SECTION_EXISTS"
  | "INVALID_INSERT_POSITION"
  | "UNKNOWN_SECTION_LIBRARY_ERROR";

export class SectionLibraryError extends Error {
  readonly code: SectionLibraryErrorCode;
  readonly cause?: unknown;

  constructor(
    code: SectionLibraryErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "SectionLibraryError";
    this.code = code;
    this.cause = options?.cause;
  }
}
