// ---------------------------------------------------------------------------
// TemplateRegistry — registry for BuildoraTemplate definitions
//
// Mirrors the section/inspector registry pattern. Templates are stored by
// stable ID, never mutated by the registry, and listed in deterministic
// registration order.
// ---------------------------------------------------------------------------

import type { BuildoraTemplate } from "../types";
import { TemplateError } from "../types";

export class TemplateRegistry {
  private registry = new Map<string, BuildoraTemplate>();

  /**
   * Register a template. Throws DUPLICATE_TEMPLATE_ID if the ID already exists.
   */
  register(template: BuildoraTemplate): void {
    if (this.registry.has(template.id)) {
      throw new TemplateError({
        code: "DUPLICATE_TEMPLATE_ID",
        message: `Template "${template.id}" is already registered.`,
        templateId: template.id,
      });
    }
    this.registry.set(template.id, template);
  }

  unregister(templateId: string): void {
    this.registry.delete(templateId);
  }

  get(templateId: string): BuildoraTemplate | undefined {
    return this.registry.get(templateId);
  }

  /** Deterministic list in registration order. Callers must not mutate entries. */
  list(): BuildoraTemplate[] {
    return Array.from(this.registry.values());
  }

  clear(): void {
    this.registry.clear();
  }
}

/** Singleton shared across the application. */
export const templateRegistry = new TemplateRegistry();
