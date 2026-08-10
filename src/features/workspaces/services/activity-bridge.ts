// ---------------------------------------------------------------------------
// Phase P15 — activity bridge
//
// Fire-and-forget client bridge for product actions that live OUTSIDE the
// workspace server (publishing, review links, custom domains). The server
// always derives the actor from the session and validates the event type +
// metadata allow-list — a client can never forge an actor or inject an
// arbitrary event. Failures are swallowed (activity never breaks the action).
// ---------------------------------------------------------------------------

import { getWorkspaceProvider, WorkspaceService } from "./workspace-service";
import type { WorkspaceActivityMetadata, WorkspaceActivityType } from "../types";

export interface ActivityBridgeInput {
  /** The active workspace (null → personal project → no-op). */
  workspaceId: string | null;
  projectId: string;
  type: WorkspaceActivityType;
  metadata?: WorkspaceActivityMetadata;
}

export function recordWorkspaceActivity(input: ActivityBridgeInput): void {
  if (!input.workspaceId) return;
  const provider = getWorkspaceProvider();
  if (!provider) return;
  void new WorkspaceService(provider)
    .recordActivityEvent({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      type: input.type,
      metadata: input.metadata,
    })
    .catch(() => {
      // Activity is best-effort — never breaks the underlying action.
    });
}
