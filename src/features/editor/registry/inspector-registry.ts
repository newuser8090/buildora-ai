import { type ComponentType } from "react";
import type { BaseSection } from "@/types/section";

// ---------------------------------------------------------------------------
// An inspector component receives a section object and renders editing controls.
// ---------------------------------------------------------------------------

export type InspectorComponent = ComponentType<{
  section: BaseSection;
  onUpdateProps: (props: Record<string, unknown>) => void;
  onUpdateStyles: (styles: Record<string, unknown>) => void;
}>;

// ---------------------------------------------------------------------------
// Registry — open for extension, mirrors SectionRegistry pattern
// ---------------------------------------------------------------------------

class InspectorRegistry {
  private registry = new Map<string, InspectorComponent>();

  register(type: string, component: InspectorComponent): void {
    this.registry.set(type, component);
  }

  get(type: string): InspectorComponent | undefined {
    return this.registry.get(type);
  }

  has(type: string): boolean {
    return this.registry.has(type);
  }

  registerAll(entries: [string, InspectorComponent][]): void {
    for (const [type, component] of entries) {
      this.registry.set(type, component);
    }
  }

  get types(): string[] {
    return Array.from(this.registry.keys());
  }
}

/** Singleton shared across the application. */
export const inspectorRegistry = new InspectorRegistry();
