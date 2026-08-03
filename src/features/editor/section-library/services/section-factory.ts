// ---------------------------------------------------------------------------
// SectionFactory — creates validated, deeply independent Section objects
//
// Responsibilities:
//   - resolve the definition from the registry
//   - create default props + styles via the definition's factories
//   - inject an ID through an injectable ID factory
//   - assign visible: true and a deterministic order
//   - validate the result through the existing section schemas
//   - never insert into the store, never persist, never mutate definitions
//
// Framework-independent: no React, no Zustand, no browser APIs.
// ---------------------------------------------------------------------------

import type { BaseSection } from "@/types/section";
import type { SectionType } from "../types";
import { SectionLibraryError } from "../types";
import { sectionLibraryRegistry } from "../registry/section-library-registry";
import { validateSectionSafe } from "../../schemas/section-schemas";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateSectionRequest {
  type: SectionType;
  sectionId?: string;
  order?: number;
  /**
   * Optional existing IDs to check for collisions. When supplied and the
   * generated/resolved ID already exists, returns SECTION_ID_CONFLICT.
   */
  existingIds?: ReadonlySet<string> | ReadonlyArray<string>;
}

export type CreateSectionResult =
  | { ok: true; section: BaseSection }
  | { ok: false; error: SectionLibraryError };

export type SectionIdFactory = (type: SectionType) => string;

// ---------------------------------------------------------------------------
// Default ID factory
//
// Deterministic-ish and collision-resistant without depending on global
// random state: a monotonically increasing counter combined with the type and
// a timestamp base. The caller may inject their own factory (e.g. UUID).
// ---------------------------------------------------------------------------

let idCounter = 0;

export function createSectionId(type: SectionType): string {
  idCounter += 1;
  const base = Date.now().toString(36);
  return `${type}-${base}-${idCounter}`;
}

export const defaultSectionIdFactory: SectionIdFactory = createSectionId;

// ---------------------------------------------------------------------------
// Factory options
// ---------------------------------------------------------------------------

export interface SectionFactoryOptions {
  idFactory?: SectionIdFactory;
  registry?: typeof sectionLibraryRegistry;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export class SectionFactory {
  private readonly idFactory: SectionIdFactory;
  private readonly registry: typeof sectionLibraryRegistry;

  constructor(options?: SectionFactoryOptions) {
    this.idFactory = options?.idFactory ?? defaultSectionIdFactory;
    this.registry = options?.registry ?? sectionLibraryRegistry;
  }

  /**
   * Create a single validated section from a library definition.
   * Returns a deeply independent object — mutating the result never affects
   * the definition or any previously created section.
   */
  create(request: CreateSectionRequest): CreateSectionResult {
    const definition = this.registry.get(request.type);

    if (!definition) {
      return {
        ok: false,
        error: new SectionLibraryError(
          "SECTION_DEFINITION_NOT_FOUND",
          `No section definition registered for type "${request.type}".`,
        ),
      };
    }

    // Resolve the ID first so we can check for conflicts.
    const id = request.sectionId ?? this.idFactory(request.type);

    const existing = request.existingIds
      ? Array.isArray(request.existingIds)
        ? request.existingIds
        : Array.from(request.existingIds)
      : [];
    if (existing.includes(id)) {
      return {
        ok: false,
        error: new SectionLibraryError(
          "SECTION_ID_CONFLICT",
          `Section ID "${id}" already exists in the target page.`,
        ),
      };
    }

    // Build default props + styles. These are fresh objects per definition.
    let props: Record<string, unknown>;
    let styles: Record<string, unknown>;
    try {
      // Typed props are structurally compatible with the base record shape;
      // the cast via `unknown` is required because interface types (without
      // index signatures) are not directly comparable to Record<string, unknown>.
      props = definition.createProps() as unknown as Record<string, unknown>;
      styles = definition.createStyles() as unknown as Record<string, unknown>;
    } catch (cause) {
      return {
        ok: false,
        error: new SectionLibraryError(
          "SECTION_CREATION_FAILED",
          `Failed to create default content for section type "${request.type}".`,
          { cause },
        ),
      };
    }

    const section: BaseSection = {
      id,
      type: request.type,
      order: request.order ?? 0,
      visible: true,
      props,
      styles,
    };

    // Validate through the canonical section schemas.
    const validation = validateSectionSafe(section);
    if (!validation.success) {
      return {
        ok: false,
        error: new SectionLibraryError(
          "SECTION_VALIDATION_FAILED",
          `Created section of type "${request.type}" failed schema validation.`,
          { cause: validation.error },
        ),
      };
    }

    return { ok: true, section };
  }
}

/** Convenience singleton factory (no custom options). */
export const sectionFactory = new SectionFactory();
