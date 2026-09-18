// ---------------------------------------------------------------------------
// Phase P24-B — durable section element trees
// Covers the legacy → materialize → edit → normalize → persist → reload
// round trip for EVERY regular section type, the durable-tree preference of
// sectionToElementTree, content reconciliation with props, and lossless
// materialization of element metadata.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";
import { registerDefaultElements } from "../registry/register-default-elements";
import { validateElementTree } from "../engine/element-validation";
import { updateElementGeometry } from "../engine/element-operations";
import { normalizeElementTree } from "../serialization/element-normalizer";
import {
  elementTreeToSection,
  materializeSectionElement,
  sectionHasDurableTree,
  sectionToElementTree,
} from "../adapters/section-element-adapter";
import type { BaseSection } from "@/types/section";
import type { ElementTree } from "../types";

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
  registerDefaultElements();
});

// ---------------------------------------------------------------------------
// Fixtures — one valid legacy section per built-in regular type
// ---------------------------------------------------------------------------

const SECTIONS: BaseSection[] = [
  {
    id: "s-header",
    type: "header",
    order: 1,
    visible: true,
    props: { logoText: "Brand", navLinks: [{ text: "Home", href: "/" }], ctaText: "Get Started" },
    styles: {},
  },
  {
    id: "s-hero",
    type: "hero",
    order: 2,
    visible: true,
    props: {
      headline: "Build beautiful websites",
      subheadline: "Describe your dream site in plain English.",
      primaryCta: { text: "Start Building Free", href: "#" },
    },
    styles: { padding: "6rem 0" },
  },
  {
    id: "s-features",
    type: "features",
    order: 3,
    visible: true,
    props: {
      title: "Features",
      features: [{ title: "Fast", description: "Blazing speed." }],
    },
    styles: {},
  },
  {
    id: "s-pricing",
    type: "pricing",
    order: 4,
    visible: true,
    props: {
      title: "Pricing",
      plans: [{ name: "Free", price: "$0", description: "", features: [], cta: "Start" }],
    },
    styles: {},
  },
  {
    id: "s-faq",
    type: "faq",
    order: 5,
    visible: true,
    props: { title: "FAQ", items: [{ question: "Why?", answer: "Because." }] },
    styles: {},
  },
  {
    id: "s-cta",
    type: "cta",
    order: 6,
    visible: true,
    props: { headline: "Get Started", ctaText: "Sign Up" },
    styles: {},
  },
  {
    id: "s-footer",
    type: "footer",
    order: 7,
    visible: true,
    props: { text: "© 2026 Buildora", links: [{ text: "Home", href: "/" }] },
    styles: {},
  },
];

/** Edit the text of the first bound child of a tree. */
function editFirstBoundText(tree: ElementTree, text: string): ElementTree {
  const root = tree.nodes[tree.rootIds[0]];
  const childId = root.children[0];
  const child = tree.nodes[childId];
  return {
    ...tree,
    nodes: {
      ...tree.nodes,
      [childId]: { ...child, props: { ...child.props, text } },
    },
  };
}

describe("durable round trip — every regular section type", () => {
  it("legacy → materialize → edit → normalize → reload keeps content for every type", () => {
    for (const section of SECTIONS) {
      // 1. Legacy projection.
      const tree = sectionToElementTree(section);
      expect(validateElementTree(tree).valid).toBe(true);
      const root = tree.nodes[tree.rootIds[0]];
      const childId = root.children[0];

      // 2. A real element-tree edit (bound text change).
      const edited = editFirstBoundText(tree, "Edited content");

      // 3. Normalize (as the persistence boundary would).
      const normalized = normalizeElementTree(edited);
      expect(normalized).not.toBeNull();
      if (!normalized) continue;
      expect(validateElementTree(normalized).valid).toBe(true);

      // 4. Persist the durable shape — the store folds the edited tree back
      // into props in the SAME commit, so the persisted section carries both.
      const folded = elementTreeToSection(normalized, section);
      expect(folded.ok).toBe(true);
      if (!folded.ok) continue;
      const persisted: BaseSection = { ...folded.value.section, tree: normalized };
      expect(sectionHasDurableTree(persisted)).toBe(true);
      expect(persisted.tree).toBe(normalized);

      // 5. Reload: the durable tree is authoritative and preserves the edit.
      const reloaded = sectionToElementTree(persisted);
      expect(reloaded.nodes[childId].props.text).toBe("Edited content");
      expect((folded.value.section.props as Record<string, unknown>).headline ??
        (folded.value.section.props as Record<string, unknown>).logoText ??
        (folded.value.section.props as Record<string, unknown>).title ??
        (folded.value.section.props as Record<string, unknown>).text).toBe("Edited content");
    }
  });

  it("legacy sections do NOT report a durable tree until materialized", () => {
    for (const section of SECTIONS) {
      expect(sectionHasDurableTree(section)).toBe(false);
    }
  });
});

describe("durable tree preference — geometry survives edits and reloads", () => {
  it("element metadata persists on the durable tree and wins over re-materialization", () => {
    const hero = SECTIONS.find((s) => s.type === "hero")!;
    const tree = sectionToElementTree(hero);
    const withGeometry = updateElementGeometry(tree, hero.id, { x: 40, y: 60, width: 320 });
    expect(withGeometry.ok).toBe(true);
    if (!withGeometry.ok) return;

    const durable = materializeSectionElement(hero, withGeometry.value);
    const reloaded = sectionToElementTree(durable);
    expect(reloaded.nodes[hero.id].geometry).toMatchObject({ x: 40, y: 60, width: 320 });
    // Content is still present and in sync.
    expect(reloaded.nodes[hero.id].props._sectionId).toBe(hero.id);
  });

  it("reconciled content from props is never lost by a later edit", () => {
    const hero = SECTIONS.find((s) => s.type === "hero")!;
    const tree = sectionToElementTree(hero);
    const durable = materializeSectionElement(hero, tree);

    // An edit made OUTSIDE the element-tree path (inline/AI) changes props.
    const propsEdited: BaseSection = {
      ...durable,
      props: { ...durable.props, headline: "Inline headline edit" },
    };

    // The next element-tree materialization must pick the new content up.
    const reloaded = sectionToElementTree(propsEdited);
    const headlineId = reloaded.nodes[hero.id].children[0];
    expect(reloaded.nodes[headlineId].props.text).toBe("Inline headline edit");
    // Element metadata (none here) would survive; markers stay intact.
    expect(reloaded.nodes[hero.id].props._sectionType).toBe("hero");
  });

  it("normalizeElementTree is idempotent on a durable tree", () => {
    const hero = SECTIONS.find((s) => s.type === "hero")!;
    const durable = materializeSectionElement(hero, sectionToElementTree(hero));
    const once = normalizeElementTree(durable.tree);
    expect(once).not.toBeNull();
    const twice = normalizeElementTree(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});
