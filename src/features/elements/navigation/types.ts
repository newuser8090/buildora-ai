// ---------------------------------------------------------------------------
// Navigation foundation (Phase P22-A) — typed navigation targets
//
// Users must never need to type `href="/about"`. The future "Navigate to…"
// picker writes a NavTarget; the resolver (navigation/resolve.ts) turns it
// into a concrete href using the EXISTING routing system (routes.ts).
//
// Pure model: no React, no DOM.
// ---------------------------------------------------------------------------

export type NavTarget =
  | { kind: "page"; pageId: string }
  | { kind: "section"; pageId?: string; sectionId: string }
  | { kind: "external"; url: string }
  | { kind: "email"; to: string }
  | { kind: "phone"; number: string }
  | { kind: "back" };

/** Human-readable label for a target (used by tests and future pickers). */
export function describeNavTarget(target: NavTarget): string {
  switch (target.kind) {
    case "page":
      return `Page ${target.pageId}`;
    case "section":
      return `Section ${target.sectionId}`;
    case "external":
      return target.url;
    case "email":
      return target.to;
    case "phone":
      return target.number;
    case "back":
      return "Back";
  }
}
