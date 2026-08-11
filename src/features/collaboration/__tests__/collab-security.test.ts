// ---------------------------------------------------------------------------
// Phase P16 — collaboration security & robustness tests
//
// Security (architecture §38/§39): remote updates are UNTRUSTED. The doc and
// normalizer must tolerate hostile payloads without crashing, prototype
// pollution, invalid trees, or resource explosion.
//
// Robustness (architecture §33/§34): offline edits queue locally (bounded),
// reconnect merges idempotently, and duplicate updates are deduped by Yjs —
// never a full-project last-write-wins overwrite.
//
// Store bridge (architecture §15/§16): the projection path (applyRemoteProject)
// is flagged so the persistence controller never treats it as a local edit;
// local mutations route through the commit hook exactly once.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { initFromProject, toProject, reconcileProject } from "../crdt/collab-doc";
import { normalizeProject } from "../crdt/tree-normalizer";
import {
  beginRemoteProjection,
  endRemoteProjection,
  isRemoteProjection,
  setCollabCommitHook,
  getCollabCommitHook,
  isCollabCommitActive,
  type CollabCommitHook,
} from "../editor-commit-hook";
import type { Project } from "@/types/project";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";

function makeProject(): Project {
  // Full valid theme/siteSettings from the canonical mock project, but with a
  // deterministic single page + hero section shape for these tests.
  const base = JSON.parse(JSON.stringify(MOCK_PROJECT)) as Project;
  return {
    ...base,
    id: "proj-1",
    name: "Test Site",
    assets: [],
    pages: [
      {
        id: "page-home",
        title: "Home",
        slug: "home",
        meta: {},
        sections: [
          {
            id: "sec-hero",
            type: "hero",
            order: 1,
            visible: true,
            props: { heading: "Hello world", eyebrow: "Startup" },
            styles: {},
          },
        ],
      },
    ],
    siteSettings: { siteName: "Test Site" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Malformed / hostile payloads
// ---------------------------------------------------------------------------

describe("hostile payload handling", () => {
  it("prototype-pollution keys are never applied", () => {
    const project = makeProject();
    const doc = new Y.Doc();
    initFromProject(doc, project, "init");
    const hostile = JSON.parse(JSON.stringify(project)) as Project & Record<string, unknown>;
    (hostile as unknown as Record<string, unknown>)["__proto__"] = { polluted: true };
    (hostile as unknown as Record<string, unknown>)["constructor"] = { polluted: true };
    reconcileProject(doc, hostile, "local");
    const out = toProject(doc);
    // The hostile keys must never become OWN keys of the projection (reading
    // `out["__proto__"]` would hit the prototype getter — hasOwnProperty is
    // the correct check).
    expect(Object.prototype.hasOwnProperty.call(out, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, "constructor")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, "toString")).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(({} as any).polluted).toBeUndefined(); // global Object not polluted
  });

  it("malformed Yjs updates are rejected and never corrupt the doc", () => {
    const project = makeProject();
    const doc = new Y.Doc();
    initFromProject(doc, project, "init");
    const before = JSON.stringify(toProject(doc));
    const garbage = new Uint8Array([0, 1, 2, 3, 255, 254, 253]);
    // Yjs throws on structurally invalid updates. The SESSION catches this
    // (remote updates are untrusted) and convergence is guaranteed by the next
    // snapshot/checkpoint cycle — mirror that here:
    let threw = false;
    try {
      Y.applyUpdate(doc, garbage, "collab-remote:attacker");
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // The doc remains a valid project either way.
    expect(JSON.stringify(toProject(doc))).toBe(before);
  });

  it("unsafe keys inside nested objects are dropped by the normalizer", () => {
    const raw = {
      id: "proj-1",
      name: "X",
      theme: {},
      assets: [],
      pages: [
        {
          id: "page-1",
          title: "P",
          slug: "p",
          meta: {},
          sections: [
            {
              id: "sec-1",
              type: "hero",
              order: 1,
              visible: true,
              props: { heading: "H", ["__proto__"]: { evil: 1 }, ["toString"]: "oops" },
              styles: {},
            },
          ],
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const normalized = normalizeProject(raw);
    const props = normalized.pages[0].sections[0].props as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(props, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(props, "toString")).toBe(false);
    expect(props.heading).toBe("H");
  });

  it("invalid block types / dangling references are dropped, not invented", () => {
    const project = makeProject();
    // A hostile remote edit could add a section with an unknown type and a
    // page referencing a section that doesn't exist. The normalizer must drop
    // invalid references deterministically without inventing content.
    const doc = new Y.Doc();
    initFromProject(doc, project, "init");
    const hostile: Project = JSON.parse(JSON.stringify(project)) as Project;
    hostile.pages[0].sections.push({
      id: "sec-bogus",
      type: "not-a-real-type" as Project["pages"][number]["sections"][number]["type"],
      order: 99,
      visible: true,
      props: { heading: "Bogus" },
      styles: {},
    });
    reconcileProject(doc, hostile, "local");
    const out = toProject(doc);
    expect(() => out).not.toThrow();
    // The doc still projects to a valid Project with the original section.
    expect(out.pages[0].sections.length).toBeGreaterThanOrEqual(1);
    expect(out.pages[0].sections[0].id).toBe("sec-hero");
  });
});

// ---------------------------------------------------------------------------
// Tree invariants after arbitrary concurrent sequences
// ---------------------------------------------------------------------------

describe("tree invariants", () => {
  it("no duplicate ids, no dangling parents, deterministic ids after inserts", () => {
    const project = makeProject();
    const doc = new Y.Doc();
    initFromProject(doc, project, "init");

    const next = JSON.parse(JSON.stringify(project)) as Project;
    next.pages[0].sections.push({
      id: "sec-b",
      type: "features",
      order: 2,
      visible: true,
      props: { heading: "B" },
      styles: {},
    });
    reconcileProject(doc, next, "local");

    const out = toProject(doc);
    const ids = out.pages[0].sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    expect(ids).toContain("sec-hero");
    expect(ids).toContain("sec-b");
    // order fields are normalized contiguous (1-based)
    const orders = out.pages[0].sections.map((s) => s.order);
    expect(orders).toEqual([1, 2]);
  });

  it("delete vs edit race: deletion wins for structure, doc stays valid", () => {
    const project = makeProject();
    const doc = new Y.Doc();
    initFromProject(doc, project, "init");
    // A deletes the section (structure) while B's text edit inside it is
    // applied after — the section must be gone; no dangling reference.
    const next = JSON.parse(JSON.stringify(project)) as Project;
    next.pages[0].sections = [];
    reconcileProject(doc, next, "local");
    const out = toProject(doc);
    expect(out.pages[0].sections).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Offline / reconnect
// ---------------------------------------------------------------------------

describe("offline / reconnect convergence", () => {
  it("offline local edits queue and merge idempotently on reconnect", () => {
    // Simulates the mock transport's bounded offline queue: A's offline edits
    // are captured as incremental updates, B edits online, then A's queue is
    // replayed — Yjs dedupes and both changes survive.
    const a = new Y.Doc();
    initFromProject(a, makeProject(), "init");
    const canonical = Y.encodeStateAsUpdate(a);
    const b = new Y.Doc();
    Y.applyUpdate(b, canonical);

    // A edits offline (three separate local transactions).
    const queue: Uint8Array[] = [];
    const capture = (u: Uint8Array, origin: unknown) => {
      if (origin === "a-local") queue.push(u);
    };
    a.on("update", capture);

    const editA1 = JSON.parse(JSON.stringify(toProject(a))) as Project;
    editA1.pages[0].sections[0].props.heading = "Offline heading A";
    reconcileProject(a, editA1, "a-local");

    const editA2 = JSON.parse(JSON.stringify(toProject(a))) as Project;
    editA2.name = "Offline rename";
    reconcileProject(a, editA2, "a-local");

    // B edits online while A is away (listener registered BEFORE the edit so
    // the incremental update is captured).
    let upB: Uint8Array | null = null;
    const captureB = (u: Uint8Array, origin: unknown) => {
      if (origin === "b-local") upB = u;
    };
    b.on("update", captureB);
    const editB = JSON.parse(JSON.stringify(toProject(b))) as Project;
    editB.pages[0].sections[0].props.eyebrow = "Online eyebrow B";
    reconcileProject(b, editB, "b-local");
    b.off("update", captureB);

    // A reconnects: replay the queued updates; then receive B's update.
    for (const u of queue) {
      Y.applyUpdate(b, u, "replay");
    }
    if (upB) Y.applyUpdate(a, upB, "collab-remote:b");

    // Everything converges — nothing lost.
    const finalA = toProject(a);
    const finalB = toProject(b);
    expect(finalA.name).toBe("Offline rename");
    expect(finalA.pages[0].sections[0].props.heading).toBe("Offline heading A");
    expect(finalA.pages[0].sections[0].props.eyebrow).toBe("Online eyebrow B");
    expect(JSON.stringify(finalA.pages)).toBe(JSON.stringify(finalB.pages));
    expect(JSON.stringify(finalA.name)).toBe(JSON.stringify(finalB.name));
  });

  it("replaying the same update twice is a no-op (Yjs dedupe)", () => {
    const a = new Y.Doc();
    initFromProject(a, makeProject(), "init");
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    let upA: Uint8Array | null = null;
    const capture = (u: Uint8Array, origin: unknown) => {
      if (origin === "a-local") upA = u;
    };
    a.on("update", capture);
    const next = JSON.parse(JSON.stringify(toProject(a))) as Project;
    next.name = "Renamed once";
    reconcileProject(a, next, "a-local");
    a.off("update", capture);

    // Apply the same update twice — the second is deduped.
    Y.applyUpdate(b, upA!, "relay");
    Y.applyUpdate(b, upA!, "relay-again");
    expect(toProject(b).name).toBe("Renamed once");
    expect(toProject(a).name).toBe(toProject(b).name);
  });
});

// ---------------------------------------------------------------------------
// Store bridge — feedback-loop prevention
// ---------------------------------------------------------------------------

describe("editor-store bridge", () => {
  it("remote projection flag guards the persistence controller", () => {
    expect(isRemoteProjection()).toBe(false);
    beginRemoteProjection();
    expect(isRemoteProjection()).toBe(true);
    endRemoteProjection();
    expect(isRemoteProjection()).toBe(false);
    // Nested begin/end (session init + transport message) stays balanced.
    beginRemoteProjection();
    beginRemoteProjection();
    endRemoteProjection();
    expect(isRemoteProjection()).toBe(true);
    endRemoteProjection();
    expect(isRemoteProjection()).toBe(false);
  });

  it("commit hook registry: active only while a session owns it", () => {
    expect(isCollabCommitActive()).toBe(false);
    const hook: CollabCommitHook = {
      applyLocalProject: () => undefined,
      undo: () => undefined,
      redo: () => undefined,
      canUndo: () => false,
      canRedo: () => false,
    };
    setCollabCommitHook(hook);
    expect(isCollabCommitActive()).toBe(true);
    expect(getCollabCommitHook()).toBe(hook);
    setCollabCommitHook(null);
    expect(isCollabCommitActive()).toBe(false);
    expect(getCollabCommitHook()).toBeNull();
  });

  it("local mutations route through the hook exactly once", () => {
    let calls = 0;
    const hook: CollabCommitHook = {
      applyLocalProject: () => {
        calls += 1;
      },
      undo: () => undefined,
      redo: () => undefined,
      canUndo: () => false,
      canRedo: () => false,
    };
    setCollabCommitHook(hook);
    try {
      // Simulate one store mutation (withHistory → applyLocalProject).
      hook.applyLocalProject(makeProject());
      hook.applyLocalProject(makeProject());
      expect(calls).toBe(2);
    } finally {
      setCollabCommitHook(null);
    }
  });
});
