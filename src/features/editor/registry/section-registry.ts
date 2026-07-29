import { type ComponentType } from "react";
import type { BaseSection } from "@/types/section";

// ---------------------------------------------------------------------------
// A section component receives a section object and renders it.
// ---------------------------------------------------------------------------

export type SectionComponent = ComponentType<{ section: BaseSection }>;

// ---------------------------------------------------------------------------
// Registry — open for extension, no hardcoded section types
// ---------------------------------------------------------------------------

class SectionRegistry {
  private registry = new Map<string, SectionComponent>();

  register(type: string, component: SectionComponent): void {
    this.registry.set(type, component);
  }

  get(type: string): SectionComponent | undefined {
    return this.registry.get(type);
  }

  has(type: string): boolean {
    return this.registry.has(type);
  }

  /** Register multiple sections at once. */
  registerAll(entries: [string, SectionComponent][]): void {
    for (const [type, component] of entries) {
      this.registry.set(type, component);
    }
  }

  get types(): string[] {
    return Array.from(this.registry.keys());
  }
}

/** Singleton shared across the application. */
export const sectionRegistry = new SectionRegistry();
