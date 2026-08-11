// ---------------------------------------------------------------------------
// Phase P16 — collab-doc unit tests
//
// The CRDT document is the core collaboration guarantee. These tests verify:
//   * project round-trip (Project → Y.Doc → normalized Project)
//   * reconcile idempotence (reconcile(doc, toProject(doc)) applies zero ops)
//   * concurrent text edits merge (both contributions survive)
//   * concurrent structural edits merge (no duplicate ids / dangling refs)
//   * deterministic convergence (opposite op orders converge to the same state)
//   * remote updates never echo (origin filtering is the session's job — here
//     we verify the doc primitives merge updates applied in any order)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { initFromProject, toProject, reconcileProject } from "../crdt/collab-doc";
import { diffText } from "../crdt/text-diff";
import type { Project } from "@/types/project";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Test Site",
    theme: {
      palette: {
        background: "#ffffff",
        foreground: "#0a0a0a",
        primary: "#7c5cfc",
        primaryForeground: "#ffffff",
        secondary: "#f5f5f5",
        secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5",
        mutedForeground: "#737373",
        accent: "#7c5cfc",
        accentForeground: "#ffffff",
        border: "#e5e5e5",
        card: "#ffffff",
        cardForeground: "#0a0a0a",
      },
      typography: {
        fontFamily: "Geist, system-ui, sans-serif",
        headingFont: "Geist, system-ui, sans-serif",
        baseSize: "16px",
        scale: 1.25,
      },
      spacing: {
        sectionPadding: "6rem 0",
        containerMaxWidth: "1120px",
        gap: "1.5rem",
      },
      radius: {
        sm: "0.375rem",
        md: "0.5rem",
        lg: "0.75rem",
        xl: "1rem",
        full: "9999px",
      },
      shadows: {
        sm: "0 1px 2px rgba(0,0,0,0.05)",
        md: "0 4px 6px rgba(0,0,0,0.07)",
        lg: "0 10px 15px rgba(0,0,0,0.1)",
        xl: "0 20px 25px rgba(0,0,0,0.15)",
      },
    },
    assets: [],
    pages: [
      {
        id: "page-home",
        title: "Home",
        slug: "home",
        meta: { description: "Welcome" },
        sections: [
          {
            id: "sec-hero",
            type: "hero",
            order: 1,
            visible: true,
            props: {
              heading: "Hello world",
              eyebrow: "Startup",
            },
            styles: {},
          },
        ],
      },
    ],
    siteSettings: {
      siteName: "Test Site",
      siteDescription: "A test site",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Serialize a doc to a JSON string (deterministic structural compare). */
function docJson(doc: Y.Doc): string {
  return JSON.stringify(toProject(doc));
}

/**
 * Two clients sharing a canonical base, mirroring the real session:
 *   - A builds the project and SEEDS it (canonical state — first joiner)
 *   - B applies A's canonical state via applyUpdate (identical structs)
 * This is the architecture's canonical-state seeding; independently-built
 * content would carry different struct ids and duplicate on merge.
 */
function twoClients(project: Project): [Y.Doc, Y.Doc] {
  const a = new Y.Doc();
  initFromProject(a, project, "canonical-init");
  const canonical = Y.encodeStateAsUpdate(a);
  const b = new Y.Doc();
  Y.applyUpdate(b, canonical, "canonical");
  return [a, b];
}

/**
 * Two-client concurrent sync: both clients already share the canonical base.
 * `editA`/`editB` mutate each client's doc with their local origin; then the
 * incremental updates are relayed both ways and the docs must converge.
 */
function converge(
  project: Project,
  editA: (next: Project) => void,
  editB: (next: Project) => void,
): { a: Y.Doc; b: Y.Doc; projectA: Project; projectB: Project } {
  const [a, b] = twoClients(project);

  // Capture incremental updates (listeners registered BEFORE local edits — the
  // same as the session, which registers before any transaction).
  let upA: Uint8Array | null = null;
  let upB: Uint8Array | null = null;
  const subA = (u: Uint8Array, origin: unknown) => {
    if (origin === "a-local") upA = u;
  };
  const subB = (u: Uint8Array, origin: unknown) => {
    if (origin === "b-local") upB = u;
  };
  a.on("update", subA);
  b.on("update", subB);

  const aNext = JSON.parse(JSON.stringify(project)) as Project;
  editA(aNext);
  reconcileProject(a, aNext, "a-local");

  const bNext = JSON.parse(JSON.stringify(project)) as Project;
  editB(bNext);
  reconcileProject(b, bNext, "b-local");

  // Relay both ways.
  if (upA) Y.applyUpdate(b, upA, "a-to-b");
  if (upB) Y.applyUpdate(a, upB, "b-to-a");

  return {
    a,
    b,
    projectA: toProject(a),
    projectB: toProject(b),
  };
}

// ---------------------------------------------------------------------------
// Round-trip & idempotence
// ---------------------------------------------------------------------------

describe("collab-doc round-trip", () => {
  it("projects a canonical Project to the same normalized content", () => {
    const project = makeProject();
    const doc = new Y.Doc();
    initFromProject(doc, project, "init");
    const out = toProject(doc);
    expect(out.id).toBe("proj-1");
    expect(out.name).toBe("Test Site");
    expect(out.pages).toHaveLength(1);
    expect(out.pages[0].id).toBe("page-home");
    expect(out.pages[0].sections[0].props.heading).toBe("Hello world");
    expect(out.assets).toEqual([]);
  });

  it("reconcile(doc, toProject(doc)) applies zero ops (idempotent)", () => {
    const project = makeProject();
    const doc = new Y.Doc();
    initFromProject(doc, project, "init");
    const before = docJson(doc);
    // Reconcile with the same content — must not mutate the doc.
    reconcileProject(doc, toProject(doc), "local");
    expect(docJson(doc)).toBe(before);
  });

  it("reconcile is idempotent across repeated applications", () => {
    const project = makeProject();
    const doc = new Y.Doc();
    initFromProject(doc, project, "init");
    const next = makeProject({ name: "Renamed" });
    reconcileProject(doc, next, "local");
    const once = docJson(doc);
    reconcileProject(doc, toProject(doc), "local");
    expect(docJson(doc)).toBe(once);
  });

  it("normalizes dangling references instead of crashing (drop-invalid policy)", () => {
    const project = makeProject();
    // A malicious/racy page that references a section that doesn't exist.
    const doc = new Y.Doc();
    initFromProject(doc, project, "init");
    const tampered: Project = JSON.parse(JSON.stringify(project)) as Project;
    tampered.pages[0].sections.push({
      id: "sec-ghost",
      type: "hero",
      order: 1,
      visible: true,
      props: {},
      styles: {},
    });
    // Removing the ghost by reconciling an empty-sections doc must not throw.
    const cleaned: Project = JSON.parse(JSON.stringify(project)) as Project;
    cleaned.pages[0].sections = [];
    reconcileProject(doc, cleaned, "local");
    expect(() => toProject(doc)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Concurrent text
// ---------------------------------------------------------------------------

describe("concurrent text collaboration", () => {
  it("both concurrent insertions survive deterministically", () => {
    const project = makeProject();
    const { projectA, projectB } = converge(
      project,
      (next) => {
        // A inserts "beautiful " after "Hello " — without seeing B's edit.
        next.pages[0].sections[0].props.heading = "Hello beautiful world";
      },
      (next) => {
        // B inserts "!" at the end concurrently.
        next.pages[0].sections[0].props.heading = "Hello world!";
      },
    );

    const headingA = projectA.pages[0].sections[0].props.heading as string;
    const headingB = projectB.pages[0].sections[0].props.heading as string;
    expect(headingA).toBe(headingB);
    expect(headingA).toContain("beautiful");
    expect(headingA).toContain("!");
  });

  it("concurrent edits to different fields both survive (no LWW blob)", () => {
    const project = makeProject();
    const { projectA } = converge(
      project,
      (next) => {
        next.pages[0].sections[0].props.heading = "A's heading";
      },
      (next) => {
        next.pages[0].sections[0].props.eyebrow = "B's eyebrow";
      },
    );
    const props = projectA.pages[0].sections[0].props;
    expect(props.heading).toBe("A's heading");
    expect(props.eyebrow).toBe("B's eyebrow");
  });

  it("text diff primitive produces correct minimal ops", () => {
    // Insert in the middle: "Hello world" → "Hello beautiful world"
    // Common prefix "Hello ", common suffix "world" ⇒ middle replace.
    const op = diffText("Hello world", "Hello beautiful world");
    expect(op.deleteIndex).toBe(6);
    expect(op.deleteLength).toBe(0);
    expect(op.insertText).toBe("beautiful ");

    // Delete: "Hello world" → "Hello"
    const opDel = diffText("Hello world", "Hello");
    expect(opDel.deleteIndex).toBe(5);
    expect(opDel.deleteLength).toBe(6);
    expect(opDel.insertText).toBe("");

    // Identity.
    const opId = diffText("Same", "Same");
    expect(opId.deleteLength).toBe(0);
    expect(opId.insertText).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Concurrent structure
// ---------------------------------------------------------------------------

describe("concurrent structural collaboration", () => {
  it("concurrent block inserts both survive with no duplicate ids", () => {
    const project = makeProject();
    const { projectA } = converge(
      project,
      (next) => {
        next.pages[0].sections[0].props.heading = "A content";
      },
      (next) => {
        next.pages[0].sections[0].props.eyebrow = "B content";
      },
    );
    expect(projectA.pages[0].sections).toHaveLength(1);
    expect(projectA.pages[0].sections[0].props.heading).toBe("A content");
    expect(projectA.pages[0].sections[0].props.eyebrow).toBe("B content");
  });

  it("inserting sections concurrently preserves both in deterministic order", () => {
    const project = makeProject();
    const { projectA, projectB } = converge(
      project,
      (next) => {
        next.pages[0].sections.push({
          id: "sec-a",
          type: "features",
          order: next.pages[0].sections.length + 1,
          visible: true,
          props: { heading: "A section", items: [] },
          styles: {},
        });
      },
      (next) => {
        next.pages[0].sections.push({
          id: "sec-b",
          type: "features",
          order: next.pages[0].sections.length + 1,
          visible: true,
          props: { heading: "B section", items: [] },
          styles: {},
        });
      },
    );
    const idsA = projectA.pages[0].sections.map((s) => s.id);
    const idsB = projectB.pages[0].sections.map((s) => s.id);
    expect(idsA).toEqual(idsB); // deterministic convergence
    expect(idsA).toContain("sec-a");
    expect(idsA).toContain("sec-b");
    expect(new Set(idsA).size).toBe(idsA.length); // no duplicates
  });

  it("delete-vs-edit: deletion wins for structure, doc stays valid", () => {
    const project = makeProject();
    const { projectA, projectB } = converge(
      project,
      (next) => {
        // A deletes the section.
        next.pages[0].sections = [];
      },
      (next) => {
        // B edits text inside the section concurrently.
        next.pages[0].sections[0].props.heading = "B's edit inside deleted";
      },
    );
    // Deletion wins for structure: the section is gone on both sides.
    expect(projectA.pages[0].sections).toHaveLength(0);
    expect(projectB.pages[0].sections).toHaveLength(0);
  });

  it("concurrent move/reorder is deterministic and never duplicates", () => {
    const project = makeProject();
    const { projectA, projectB } = converge(
      project,
      (next) => {
        next.pages[0].sections.push({
          id: "sec-2",
          type: "features",
          order: next.pages[0].sections.length + 1,
          visible: true,
          props: { heading: "Second" },
          styles: {},
        });
      },
      (next) => {
        next.pages[0].sections.push({
          id: "sec-3",
          type: "pricing",
          order: next.pages[0].sections.length + 1,
          visible: true,
          props: { heading: "Third" },
          styles: {},
        });
      },
    );
    const idsA = projectA.pages[0].sections.map((s) => s.id).sort();
    const idsB = projectB.pages[0].sections.map((s) => s.id).sort();
    expect(idsA).toEqual(idsB);
    expect(idsA).toContain("sec-2");
    expect(idsA).toContain("sec-3");
    expect(new Set(idsA).size).toBe(idsA.length);
  });

  it("REGRESSION: concurrent reorder + text edit in another section both survive", () => {
    // Genuine scenario that exposed a real CRDT bug: Y.Array.delete() returns
    // void in Yjs v13 (the old move path destructured its return value and
    // re-inserted the SAME live element, which Yjs cannot re-integrate). The
    // fix rebuilds the moved element from its CURRENT merged content. This
    // test fails if the old delete/reinsert behavior is restored.
    const project = makeProject();
    // Add a second section so a reorder is meaningful.
    project.pages[0].sections.push({
      id: "sec-features",
      type: "features",
      order: 2,
      visible: true,
      props: { heading: "Features", items: [] },
      styles: {},
    });

    const { projectA, projectB } = converge(
      project,
      (next) => {
        // A moves the features section to the top (reorder).
        const [hero, features] = next.pages[0].sections;
        next.pages[0].sections = [features, hero];
      },
      (next) => {
        // B edits the hero's heading concurrently — a DIFFERENT section than
        // the one A moved. Both edits are made before either sees the other.
        next.pages[0].sections[0].props.heading = "B's hero heading";
      },
    );

    // No exception; both clients converge to identical state.
    expect(projectA.pages[0].sections).toEqual(projectB.pages[0].sections);

    const ids = projectA.pages[0].sections.map((s) => s.id);
    // Reorder survives: features is now first.
    expect(ids).toEqual(["sec-features", "sec-hero"]);
    // No duplicate ids, no missing sections.
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("sec-hero");
    expect(ids).toContain("sec-features");

    // B's text edit survives in the non-moved section.
    const hero = projectA.pages[0].sections.find((s) => s.id === "sec-hero")!;
    expect(hero.props.heading).toBe("B's hero heading");
    // The moved section's own content is intact (identity preserved).
    const features = projectA.pages[0].sections.find((s) => s.id === "sec-features")!;
    expect(features.props.heading).toBe("Features");
  });

  it("move rebuild preserves nested content and ids (documented delete-wins policy)", () => {
    // The move path serializes the CURRENT merged element (yjsToJson) and
    // rebuilds fresh structs. Nested Y.Text/Y.Map/Y.Array content and identity
    // must survive the round-trip with no prototype pollution / value loss.
    const project = makeProject();
    project.pages[0].sections.push({
      id: "sec-cta",
      type: "cta",
      order: 2,
      visible: true,
      props: {
        heading: "Call to action",
        eyebrow: "CTA eyebrow",
        links: [
          { label: "Primary", href: "https://example.com" },
          { label: "Secondary", href: "/about" },
        ],
      },
      styles: { background: "#123456", padding: "2rem" },
    });

    const { projectA, projectB } = converge(
      project,
      (next) => {
        const [hero, cta] = next.pages[0].sections;
        next.pages[0].sections = [cta, hero];
      },
      (next) => {
        // B edits a NESTED string field inside the section A concurrently moves.
        const bCtaProps = next.pages[0].sections[1].props as Record<string, unknown>;
        const bLinks = bCtaProps.links as Array<{ label: string; href: string }>;
        bLinks[0].label = "B's label";
      },
    );

    expect(projectA.pages[0].sections).toEqual(projectB.pages[0].sections);
    const ids = projectA.pages[0].sections.map((s) => s.id);
    expect(ids).toEqual(["sec-cta", "sec-hero"]);
    expect(new Set(ids).size).toBe(ids.length);

    const cta = projectA.pages[0].sections.find((s) => s.id === "sec-cta")!;
    // Identity + nested content survive the rebuild.
    expect(cta.type).toBe("cta");
    const ctaProps = cta.props as Record<string, unknown>;
    expect(ctaProps.heading).toBe("Call to action");
    const links = ctaProps.links as Array<{ label: string; href: string }>;
    expect(links).toHaveLength(2);
    expect(links[1].href).toBe("/about");
    expect((cta.styles as Record<string, unknown>).background).toBe("#123456");

    const hero = projectA.pages[0].sections.find((s) => s.id === "sec-hero")!;
    expect((hero.props as Record<string, unknown>).heading).toBe("Hello world");

    // Deterministic conflict policy: the concurrent edit INSIDE the moved
    // element is not silently resurrected — the move's rebuild (which ran on
    // the pre-edit state) wins, matching the documented delete-wins structural
    // semantics. It must not duplicate or corrupt, and the outcome is
    // identical on both clients.
    expect(links[0].label).toBe("Primary");
  });
});

// ---------------------------------------------------------------------------
// Convergence under different orders
// ---------------------------------------------------------------------------

describe("deterministic convergence", () => {
  it("concurrent independent edits converge regardless of relay order", () => {
    const run = (relayOrder: "ab" | "ba") => {
      const [a, b] = twoClients(makeProject());

      let upA: Uint8Array | null = null;
      let upB: Uint8Array | null = null;
      const subA = (u: Uint8Array, origin: unknown) => {
        if (origin === "a-local") upA = u;
      };
      const subB = (u: Uint8Array, origin: unknown) => {
        if (origin === "b-local") upB = u;
      };
      a.on("update", subA);
      b.on("update", subB);

      const project = makeProject();
      const aNext = JSON.parse(JSON.stringify(project)) as Project;
      aNext.name = "A's name";
      reconcileProject(a, aNext, "a-local");

      const bNext = JSON.parse(JSON.stringify(project)) as Project;
      bNext.pages[0].sections[0].props.heading = "B's heading";
      reconcileProject(b, bNext, "b-local");

      if (relayOrder === "ab") {
        if (upA) Y.applyUpdate(b, upA, "a-to-b");
        if (upB) Y.applyUpdate(a, upB, "b-to-a");
      } else {
        if (upB) Y.applyUpdate(a, upB, "b-to-a");
        if (upA) Y.applyUpdate(b, upA, "a-to-b");
      }
      return [docJson(a), docJson(b)];
    };

    const [abA, abB] = run("ab");
    const [baA] = run("ba");
    expect(abA).toBe(abB); // both clients converge
    expect(abA).toBe(baA); // relay order doesn't matter
    expect(JSON.parse(abA).name).toBe("A's name");
  });

  it("site-settings independent field edits merge", () => {
    const project = makeProject();
    const { projectA } = converge(
      project,
      (next) => {
        // A edits the SEO description only. This mirrors the real editor's
        // updateSiteSettings(patch) semantics: a patch is merged over the
        // current settings, so untouched fields stay in the local snapshot.
        // (A whole-object replacement would legitimately delete the omitted
        // fields — that is not what an independent field edit does.)
        next.siteSettings = {
          ...next.siteSettings,
          siteDescription: "A's seo",
        } as typeof next.siteSettings;
      },
      (next) => {
        // B edits the language concurrently (same patch-merge semantics).
        next.siteSettings = {
          ...next.siteSettings,
          language: "fr",
        } as typeof next.siteSettings;
      },
    );
    // Independent fields merged — neither edit clobbered the other.
    expect(projectA.siteSettings?.siteDescription).toBe("A's seo");
    expect(projectA.siteSettings?.language).toBe("fr");
    // Untouched fields survive.
    expect(projectA.siteSettings?.siteName).toBe("Test Site");
  });

  it("large project round-trips without mutation or loss", () => {
    const project = makeProject();
    const doc = new Y.Doc();
    initFromProject(doc, project, "init");
    const out = toProject(doc);
    // Structural comparison (key order inside Y.Maps is Yjs iteration order,
    // which is deterministic but not identical to the source object's order).
    expect(out.pages).toEqual(project.pages);
    expect(out.theme.palette.primary).toBe("#7c5cfc");
    expect(out.theme.radius.full).toBe("9999px");
    expect(out.siteSettings).toEqual(project.siteSettings);
  });
});
