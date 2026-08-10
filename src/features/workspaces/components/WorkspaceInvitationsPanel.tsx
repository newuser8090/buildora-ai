"use client";

// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) — WorkspaceInvitationsPanel
//
// Shows the current user's pending workspace invitations (recipient-scoped —
// the server only ever returns invitations addressed to this account). Accept
// adds the user to the workspace; ignore just dismisses the entry client-side.
// ---------------------------------------------------------------------------

import { useCallback, useState } from "react";
import { X, UserPlus, Mail, Loader2, Check } from "lucide-react";
import { useWorkspaceDashboardStore } from "../store/workspace-dashboard-store";
import { getWorkspaceProvider, WorkspaceService } from "../services/workspace-service";

export interface WorkspaceInvitationsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function WorkspaceInvitationsPanel({ open, onClose }: WorkspaceInvitationsPanelProps) {
  const invitations = useWorkspaceDashboardStore((s) => s.invitations);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accept = useCallback(async (invitationId: string) => {
    const provider = getWorkspaceProvider();
    if (!provider) return;
    setBusy(invitationId);
    setError(null);
    const service = new WorkspaceService(provider);
    const result = await service.acceptInvitation(invitationId);
    if (result.ok) {
      useWorkspaceDashboardStore
        .getState()
        .setInvitations(invitations.filter((i) => i.id !== invitationId));
      // Refresh the workspace list so the accepted workspace appears
      // immediately (recipient just joined).
      const listing = await service.listWorkspaces();
      if (listing.ok) {
        useWorkspaceDashboardStore
          .getState()
          .setWorkspaces(listing.value.owned, listing.value.shared);
      }
    } else {
      setError(result.error.message);
    }
    setBusy(null);
  }, [invitations]);

  const dismiss = useCallback((invitationId: string) => {
    useWorkspaceDashboardStore
      .getState()
      .setInvitations(invitations.filter((i) => i.id !== invitationId));
  }, [invitations]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-invitations-title"
      data-testid="workspace-invitations-panel"
    >
      <div className="flex max-h-[80dvh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-card shadow-elevated">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10">
              <Mail className="h-4 w-4 text-accent" />
            </div>
            <div>
              <h2 id="workspace-invitations-title" className="text-base font-semibold text-text-primary">
                Workspace invitations
              </h2>
              <p className="mt-0.5 text-xs text-text-muted">
                Accept an invitation to start collaborating.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close invitations"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {error && (
            <p role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400" data-testid="workspace-invite-accept-error">
              {error}
            </p>
          )}
          {invitations.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <UserPlus className="h-8 w-8 text-text-dim" />
              <p className="text-sm text-text-muted">No pending invitations.</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="rounded-xl border border-border bg-base p-4"
                  data-testid={`workspace-invite-${invitation.id}`}
                >
                  <p className="text-sm font-medium text-text-primary">{invitation.workspaceName}</p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    You&apos;re invited as a{" "}
                    <span className="font-medium capitalize text-text-primary">{invitation.role}</span>.
                    Invitations expire after 14 days.
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => void accept(invitation.id)}
                      disabled={busy === invitation.id}
                      data-testid={`workspace-accept-invite-${invitation.id}`}
                      className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                      type="button"
                    >
                      {busy === invitation.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      Accept
                    </button>
                    <button
                      onClick={() => dismiss(invitation.id)}
                      disabled={busy === invitation.id}
                      className="flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary disabled:opacity-50"
                      type="button"
                    >
                      Ignore
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
