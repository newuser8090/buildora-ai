// ---------------------------------------------------------------------------
// Collaborative editing (Phase P16) — active session registry
//
// A tiny import-light indirection so maintenance-lock consumers (version
// restore / import flows) can reach the ACTIVE collaboration session without
// importing the session service (avoids cycles with the access hook). The
// session registers itself on start and unregisters on stop.
// ---------------------------------------------------------------------------

import type { CollabSession } from "./collab-session";

let active: CollabSession | null = null;

export function registerCollabSession(session: CollabSession | null): void {
  active = session;
}

export function getActiveCollabSession(): CollabSession | null {
  return active;
}
