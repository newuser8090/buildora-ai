// ---------------------------------------------------------------------------
// SectionLibraryRegistry — stores SectionLibraryDefinition objects
//
// Mirrors the TemplateRegistry pattern. Definitions are treated as immutable:
// registering the same type twice is rejected (returns false). Deterministic
// listing in registration order. Framework-independent.
// ---------------------------------------------------------------------------

import type {
  SectionLibraryDefinition,
  SectionType,
} from "../types";

export class SectionLibraryRegistry {
  private registry = new Map<SectionType, SectionLibraryDefinition>();

  /**
   * Register a definition. Returns true when newly registered, false when the
   * type already exists (duplicate registration is rejected — the first
   * definition wins and the registry is never silently overwritten).
   */
  register(definition: SectionLibraryDefinition): boolean {
    if (this.registry.has(definition.type)) return false;
    this.registry.set(definition.type, Object.freeze(definition));
    return true;
  }

  get<T extends SectionType>(type: T): SectionLibraryDefinition<T> | undefined {
    return this.registry.get(type) as SectionLibraryDefinition<T> | undefined;
  }

  has(type: SectionType): boolean {
    return this.registry.has(type);
  }

  /** Deterministic list in registration order. Callers must not mutate entries. */
  list(): SectionLibraryDefinition[] {
    return Array.from(this.registry.values());
  }

  get types(): SectionType[] {
    return Array.from(this.registry.keys());
  }

  clear(): void {
    this.registry.clear();
  }
}

/** Singleton shared across the application. */
export const sectionLibraryRegistry = new SectionLibraryRegistry();
