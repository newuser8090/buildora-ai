// ---------------------------------------------------------------------------
// Collaborative editing (Phase P16) — transport factory
//
// Picks the collaboration transport from the cloud environment (same pattern
// as WorkspaceService / PresenceProvider):
//   - mock     → MockHttpCollabTransport (in-memory room behind /api/collab)
//   - supabase → SupabaseCollabTransport (Supabase Realtime Broadcast room)
//
// `exposeTestControls` is only honored in mock/dev — the realtime E2E specs
// use it to force disconnect/reconnect deterministically.
// ---------------------------------------------------------------------------

import { getCloudEnvironment } from "@/features/cloud-sync/cloud-environment";
import type { CollabTransport } from "./collab-transport";
import { MockHttpCollabTransport } from "./mock-http-collab-transport";

export function createCollabTransport(options?: {
  exposeTestControls?: boolean;
}): CollabTransport {
  const env = getCloudEnvironment();
  if (env.kind === "supabase") {
    // Lazy import so the Supabase client + realtime only load on that path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SupabaseCollabTransport } = require("./supabase-collab-transport") as typeof import("./supabase-collab-transport");
    return new SupabaseCollabTransport();
  }
  return new MockHttpCollabTransport({
    exposeTestControls: options?.exposeTestControls,
  });
}
