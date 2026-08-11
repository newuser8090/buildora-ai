// ---------------------------------------------------------------------------
// Phase P16 — collaborative undo scoping (Y.UndoManager + trackedOrigins)
//
// The core P16 undo guarantee: user A pressing undo reverts A's OWN recent
// collaborative actions and NEVER another collaborator's work. This is
// implemented with Y.UndoManager scoped to the client's local origin (only
// local-origin transactions are tracked). These tests exercise that primitive
// directly — the same wiring the session uses (trackedOrigins = local origin).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  initFromProject,
  toProject,
  reconcileProject,
} from "../crdt/collab-doc";
import { isRemoteOrigin, localOrigin, remoteOrigin } from "../types";
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

interface Session {
  doc: Y.Doc;
  undoManager: Y.UndoManager;
  local: string;
  /** Apply a local mutation (tracked); captures its incremental update. */
  localEdit(edit: (next: Project) => void): void;
  /** The last local incremental update (for relaying to peers). */
  lastLocalUpdate: Uint8Array | null;
  /** Apply a remote update (NOT tracked — must never enter local undo). */
  applyRemote(state: Uint8Array, fromClient: string): void;
  /** Apply a remote mutation as an incremental Yjs update relayed from B. */
  remoteEditFrom(peer: Session, edit: (next: Project) => void): void;
  /** Relay this client's last local incremental update to a peer. */
  relayLastLocalUpdateTo(peer: Session): void;
}

/**
 * Two clients sharing a CANONICAL base (architecture §14): A builds the
 * project and seeds it; B applies A's canonical state via applyUpdate — the
 * SAME structs. (Independently initialized docs would carry different struct
 * ids and DUPLICATE content on merge — that is exactly what the canonical
 * seed prevents.)
 */
function makePair(): { a: Session; b: Session } {
  const a = makeSession("client-a");
  const b = makeSessionFromCanonical("client-b", Y.encodeStateAsUpdate(a.doc));
  return { a, b };
}

function makeSession(clientId: string): Session {
  const doc = new Y.Doc();
  initFromProject(doc, makeProject(), "init");
  return buildSession(doc, clientId);
}

function makeSessionFromCanonical(clientId: string, canonical: Uint8Array): Session {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, canonical, "canonical");
  return buildSession(doc, clientId);
}

function buildSession(doc: Y.Doc, clientId: string): Session {
  const local = localOrigin(clientId);
  const undoManager = new Y.UndoManager(doc.getMap("project"), {
    trackedOrigins: new Set([local]),
    captureTimeout: 0,
  });
  const session: Session = {
    doc,
    undoManager,
    local,
    lastLocalUpdate: null,
    localEdit(edit) {
      // Capture the incremental update for THIS local transaction (listener
      // registered before the edit — mirrors the session's wiring).
      let captured: Uint8Array | null = null;
      const sub = (u: Uint8Array, origin: unknown) => {
        if (origin === local) captured = u;
      };
      doc.on("update", sub);
      const next = JSON.parse(JSON.stringify(toProject(doc))) as Project;
      edit(next);
      reconcileProject(doc, next, local);
      doc.off("update", sub);
      session.lastLocalUpdate = captured;
    },
    applyRemote(state, fromClient) {
      Y.applyUpdate(doc, state, remoteOrigin(fromClient));
    },
    remoteEditFrom(peer, edit) {
      // Capture peer's incremental local update and relay it here.
      peer.localEdit(edit);
      if (peer.lastLocalUpdate) {
        Y.applyUpdate(doc, peer.lastLocalUpdate, remoteOrigin(peer.local));
      }
    },
    relayLastLocalUpdateTo(peer) {
      if (this.lastLocalUpdate) {
        Y.applyUpdate(peer.doc, this.lastLocalUpdate, remoteOrigin(this.local));
      }
    },
  };
  return session;
}

const heading = (s: Session) =>
  toProject(s.doc).pages[0].sections[0].props.heading as string;

const eyebrow = (s: Session) =>
  toProject(s.doc).pages[0].sections[0].props.eyebrow as string;

describe("collaborative undo scoping", () => {
  it("A's undo reverts A's edit and leaves B's concurrent edit intact", () => {
    const { a, b } = makePair();

    // A and B edit the SAME text field concurrently.
    a.localEdit((next) => {
      next.pages[0].sections[0].props.heading = "Hello beautiful world";
    });
    b.localEdit((next) => {
      next.pages[0].sections[0].props.heading = "Hello world!";
    });

    // Exchange the incremental updates (listeners register before re-run).
    a.relayLastLocalUpdateTo(b);
    b.relayLastLocalUpdateTo(a);

    // Both converge to the merged text.
    expect(heading(a)).toBe(heading(b));
    expect(heading(a)).toContain("beautiful");
    expect(heading(a)).toContain("!");

    // A undoes — ONLY A's insert disappears; B's "!" survives.
    a.undoManager.undo();
    expect(heading(a)).toContain("!");
    expect(heading(a)).not.toContain("beautiful");

    // B's session is untouched by A's undo.
    expect(heading(b)).toContain("beautiful");
    expect(heading(b)).toContain("!");
  });

  it("B's undo after A's edit reverts only B's own work", () => {
    const { a, b } = makePair();

    a.localEdit((next) => {
      next.pages[0].sections[0].props.heading = "A's heading";
    });
    b.localEdit((next) => {
      next.pages[0].sections[0].props.eyebrow = "B's eyebrow";
    });

    // Converge both ways.
    a.relayLastLocalUpdateTo(b);
    b.relayLastLocalUpdateTo(a);

    expect(heading(a)).toBe("A's heading");
    expect(eyebrow(a)).toBe("B's eyebrow");

    // B undoes. In the real session the undo transaction is relayed to peers
    // (the session relays every non-remote transaction), so A must receive the
    // inverse update — B's undo then reverts B's eyebrow everywhere.
    let undoUpdate: Uint8Array | null = null;
    const subUndo = (u: Uint8Array, origin: unknown) => {
      if (!isRemoteOrigin(origin)) undoUpdate = u;
    };
    b.doc.on("update", subUndo);
    b.undoManager.undo();
    b.doc.off("update", subUndo);
    if (undoUpdate) {
      Y.applyUpdate(a.doc, undoUpdate, remoteOrigin("client-b-undo"));
    }
    expect(eyebrow(a)).toBe("Startup"); // B's undo reverts B's eyebrow
    expect(heading(a)).toBe("A's heading"); // A's work untouched
  });

  it("remote updates never pollute the local undo stack", () => {
    const { a, b } = makePair();

    // B edits remotely; A receives it but makes NO local change.
    a.remoteEditFrom(b, (next) => {
      next.name = "B renamed the site";
    });
    expect(toProject(a.doc).name).toBe("B renamed the site");
    // Undo stack must be empty (nothing local to undo).
    expect(a.undoManager.undoStack.length).toBe(0);
    expect(a.undoManager.canUndo()).toBe(false);
  });

  it("a local edit after remote updates is the ONLY tracked entry", () => {
    const { a, b } = makePair();

    a.remoteEditFrom(b, (next) => {
      next.name = "Remote rename";
    });
    a.localEdit((next) => {
      next.pages[0].sections[0].props.heading = "My heading";
    });
    expect(a.undoManager.undoStack.length).toBe(1);
    expect(toProject(a.doc).name).toBe("Remote rename");

    a.undoManager.undo();
    expect(heading(a)).toBe("Hello world"); // own edit reverted
    expect(toProject(a.doc).name).toBe("Remote rename"); // remote kept
  });

  it("an AI-style multi-op transaction undoes as one logical action", () => {
    const a = makeSession("client-a");
    // A plan may touch several fields — the session applies it in ONE local
    // transaction, so undo reverts the whole plan as a single unit.
    a.localEdit((next) => {
      next.pages[0].sections[0].props.heading = "AI new heading";
      next.pages[0].sections[0].props.eyebrow = "AI new eyebrow";
      next.siteSettings = {
        ...(next.siteSettings ?? { siteName: "Test Site" }),
        siteDescription: "AI seo",
      };
    });
    expect(a.undoManager.undoStack.length).toBe(1);

    a.undoManager.undo();
    expect(heading(a)).toBe("Hello world");
    expect(eyebrow(a)).toBe("Startup");
    expect(toProject(a.doc).siteSettings?.siteDescription).toBeUndefined();
  });

  it("redo restores only the local action (B's edit stays merged)", () => {
    const { a, b } = makePair();

    a.localEdit((next) => {
      next.pages[0].sections[0].props.heading = "A's heading";
    });
    b.localEdit((next) => {
      next.pages[0].sections[0].props.eyebrow = "B's eyebrow";
    });
    a.relayLastLocalUpdateTo(b);
    b.relayLastLocalUpdateTo(a);

    a.undoManager.undo();
    expect(heading(a)).toBe("Hello world");
    expect(eyebrow(a)).toBe("B's eyebrow");

    a.undoManager.redo();
    expect(heading(a)).toBe("A's heading");
    expect(eyebrow(a)).toBe("B's eyebrow");
  });
});
