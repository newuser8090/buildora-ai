"use client";

// ---------------------------------------------------------------------------
// Private Shared Libraries (Phase P6) — manage dialog (owner)
//
// Owner-only: rename/describe the library, invite members, revoke pending
// invitations, and revoke member access. Permissions are clearly labelled.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Loader2, UserPlus, Shield, Pencil, Eye, Check, Trash2, Mail } from "lucide-react";
import { getCloudProvider } from "@/features/cloud-sync/providers/provider-factory";
import { SharedLibraryService } from "../services/shared-library-service";
import { useSharedLibrariesUiStore } from "../store/shared-libraries-ui-store";
import { roleLabel } from "../types";
import { InviteMemberDialog } from "./InviteMemberDialog";
import { useFocusTrap } from "@/features/auth/components/useFocusTrap";
import type { CloudLibraryInvitation, CloudSharedLibrary, SharedLibraryRole } from "@/features/cloud-sync/types";

export interface ManageSharedLibraryDialogProps {
  onChanged: () => void;
}

interface MemberRow {
  userId: string;
  email: string;
  role: SharedLibraryRole;
}

const ROLE_ICONS: Record<SharedLibraryRole, typeof Eye> = {
  viewer: Eye,
  editor: Pencil,
};

export function ManageSharedLibraryDialog({ onChanged }: ManageSharedLibraryDialogProps) {
  const manageDialog = useSharedLibrariesUiStore((s) => s.manageDialog);
  const closeManage = useSharedLibrariesUiStore((s) => s.closeManage);
  const openInvite = useSharedLibrariesUiStore((s) => s.openInvite);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const [library, setLibrary] = useState<CloudSharedLibrary | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invitations, setInvitations] = useState<CloudLibraryInvitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useFocusTrap(!!manageDialog, dialogRef);

  // Render-phase reset when the dialog opens (never sync setState in an effect).
  const [prevOpen, setPrevOpen] = useState(!!manageDialog);
  if (!!manageDialog !== prevOpen) {
    setPrevOpen(!!manageDialog);
    if (manageDialog) {
      setLoading(true);
      setError(null);
    }
  }

  const fetchManageData = useCallback(async () => {
    if (!manageDialog) return null;
    const provider = getCloudProvider();
    if (!provider) return { notConfigured: true } as const;
    const service = new SharedLibraryService(provider);
    const [detailsResult, invitationResult] = await Promise.all([
      service.details(manageDialog.libraryId),
      service.listLibraryInvitations(manageDialog.libraryId),
    ]);
    const listResult = await provider.listLibraryMembers(manageDialog.libraryId);
    return {
      detailsResult,
      invitationResult,
      listResult,
    };
  }, [manageDialog]);

  const applyManageData = useCallback(
    (payload: Exclude<Awaited<ReturnType<typeof fetchManageData>>, null>) => {
      if ("notConfigured" in payload) {
        setLoading(false);
        setError("Cloud backup isn't configured for this app yet.");
        return;
      }
      const { detailsResult, invitationResult, listResult } = payload;
      if (detailsResult.ok && detailsResult.value) {
        setLibrary(detailsResult.value.library);
      }
      setMembers(listResult);
      if (invitationResult.ok) {
        setInvitations(
          invitationResult.value.filter((i) => i.status === "pending"),
        );
      }
      setLoading(false);
    },
    [],
  );

  // Results are applied through a .then callback — no synchronous setState
  // inside the effect body.
  useEffect(() => {
    if (!manageDialog) return;
    let cancelled = false;
    void fetchManageData().then((payload) => {
      if (cancelled || !payload) return;
      applyManageData(payload);
    });
    return () => {
      cancelled = true;
    };
  }, [manageDialog, fetchManageData, applyManageData]);

  /** Event-handler reload (post revoke / invite refresh). */
  const reload = useCallback(async () => {
    const payload = await fetchManageData();
    if (payload) applyManageData(payload);
  }, [fetchManageData, applyManageData]);

  const handleRevokeMember = async (memberUserId: string) => {
    if (!manageDialog || revokingId) return;
    setRevokingId(memberUserId);
    const provider = getCloudProvider();
    if (!provider) return;
    const service = new SharedLibraryService(provider);
    const result = await service.revokeMember(manageDialog.libraryId, memberUserId);
    setRevokingId(null);
    if (result.ok) {
      await reload();
      onChanged();
    } else {
      setError(result.error.message);
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    if (revokingId) return;
    setRevokingId(invitationId);
    const provider = getCloudProvider();
    if (!provider) return;
    const service = new SharedLibraryService(provider);
    const result = await service.revokeInvitation(invitationId);
    setRevokingId(null);
    if (result.ok) {
      await reload();
      onChanged();
    } else {
      setError(result.error.message);
    }
  };

  if (!manageDialog) return null;

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeManage();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-title"
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-border bg-card shadow-elevated"
      >
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div>
            <h2 id="manage-title" className="text-lg font-semibold text-text-primary">
              Manage members
            </h2>
            <p className="mt-0.5 truncate text-xs text-text-muted">{library?.name ?? "Shared library"}</p>
          </div>
          <button
            onClick={closeManage}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-base hover:text-text-primary"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          {loading && members.length === 0 ? (
            <p className="flex items-center gap-2 py-6 text-center text-sm text-text-dim">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : (
            <>
              <section aria-label="Members">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-dim">
                  <Shield className="h-3.5 w-3.5" /> Members ({members.length})
                </h3>
                <div className="space-y-2">
                  {members.map((member) => {
                    const RoleIcon = ROLE_ICONS[member.role];
                    const isOwner = library?.ownerId === member.userId;
                    return (
                      <div
                        key={member.userId}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border bg-base px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-text-primary">
                            {member.email || "Account"}
                            {isOwner && <span className="ml-2 text-xs text-accent">Owner</span>}
                          </p>
                          <p className="flex items-center gap-1 text-xs text-text-dim">
                            <RoleIcon className="h-3 w-3" />
                            {roleLabel(member.role)}
                          </p>
                        </div>
                        {!isOwner && (
                          <button
                            onClick={() => void handleRevokeMember(member.userId)}
                            disabled={revokingId !== null}
                            className="flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                            type="button"
                          >
                            {revokingId === member.userId ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                            Revoke
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section aria-label="Pending invitations">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-dim">
                  <Mail className="h-3.5 w-3.5" /> Pending invitations
                </h3>
                {invitations.length === 0 ? (
                  <p className="text-sm text-text-dim">No pending invitations.</p>
                ) : (
                  <div className="space-y-2">
                    {invitations.map((invitation) => (
                      <div
                        key={invitation.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border bg-base px-3 py-2.5"
                      >
                        <div>
                          <p className="text-sm text-text-primary">{invitation.recipientEmail}</p>
                          <p className="text-xs text-text-dim">
                            {roleLabel(invitation.role)} · expires{" "}
                            {new Date(invitation.expiresAt).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          onClick={() => void handleRevokeInvitation(invitation.id)}
                          disabled={revokingId !== null}
                          className="flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                          type="button"
                        >
                          {revokingId === invitation.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                          Revoke
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <div className="flex items-center gap-2 border-t border-border pt-4">
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <p className="text-xs text-text-muted">
                  Revoked members lose access the next time they&apos;re online. Pieces they already
                  copied stay theirs.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="border-t border-border p-4">
          <button
            onClick={() => openInvite(manageDialog.libraryId)}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-white transition-all hover:bg-accent-hover"
            type="button"
          >
            <UserPlus className="h-4 w-4" />
            Invite someone
          </button>
        </div>
      </div>

      <InviteMemberDialog onInvited={() => void reload()} />
    </div>
  );
}
