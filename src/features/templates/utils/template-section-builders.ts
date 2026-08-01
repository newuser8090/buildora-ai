// ---------------------------------------------------------------------------
// Template section builder helpers
//
// Small factories that build fresh section objects for template fixtures.
// They keep templates free of runtime ID generation: every ID is supplied by
// the caller from the injected TemplateIdFactory.
// ---------------------------------------------------------------------------

import type { BaseSection } from "@/types/section";

export function makeSection(
  id: string,
  type: string,
  order: number,
  props: Record<string, unknown>,
): BaseSection {
  return { id, type, order, visible: true, props, styles: {} };
}

export function link(text: string, href: string): { text: string; href: string } {
  return { text, href };
}

export function navLinks(items: [string, string][]): { text: string; href: string }[] {
  return items.map(([text, href]) => link(text, href));
}

export function featureItem(title: string, description: string, icon: string) {
  return { title, description, icon };
}

export function plan(
  name: string,
  price: string,
  cta: string,
  features: string[],
  description = "",
  highlighted = false,
) {
  return { name, price, description, features, cta, highlighted };
}

export function faqItem(question: string, answer: string) {
  return { question, answer };
}
