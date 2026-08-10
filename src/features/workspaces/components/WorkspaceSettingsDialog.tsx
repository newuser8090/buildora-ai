"use client";

// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) — WorkspaceSettingsDialog
//
// The canonical management surface. Supports:
//   - create a workspace (no workspace selected)
//   - rename / delete the workspace (owner)
//   - invite members by email with a role (owner)
//   - change a member's role / remove a member (owner)
//   - leave a workspace (non-owners)
//   - pending invitation management (owner)
//
// Beginner-friendly language; no raw IDs exposed. All operations go through
// the service layer and the server enforces permissions authoritatively.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import {
  X,
  Plus,
  Users,
  Shield,
  Trash2,
  LogOut,
  Mail,
  Loader2,
  UserMinus,
  UserPlus,
  Check,
  AlertTriangle,
} from "lucide-react";
import { getWorkspaceProvider, WorkspaceService } from "../services/workspace-service";
import { useWorkspaceDashboardStore } from "../store/workspace-dashboard-store";
import { canManageWorkspace } from "../permissions/workspace-permissions";
import { MAX_WORKSPACE_NAME_LENGTH } from "../constants";
import type { Workspace, WorkspaceInvitation, WorkspaceMember, WorkspaceRole } from "../types";
import { cn } from "@/utils/cn";

export interface WorkspaceSettingsDialogProps {
  open: boolean;
  /** null = create mode; otherwise the workspace to manage. */
  workspace: Workspace | null;
  onClose: () => void;
  /** Called after successful create / rename / delete / leave. */
  onChange: () => void;
}

type RoleOption = "editor" | "viewer";

/**
 * The outer shell renders nothing when closed and mounts the management
 * surface fresh on every open. The inner component is keyed by the managed
 * workspace id, so ALL dialog state (name, members, invitations, errors,
 * loading) derives from props at mount — no reset/loading-from-effect hacks.
 */
export function WorkspaceSettingsDialog({
  open,
  workspace,
  onClose,
  onChange,
}: WorkspaceSettingsDialogProps) {
  if (!open) return null;
  return (
    <WorkspaceSettingsDialogInner
      key={workspace?.id ?? "create"}
      workspace={workspace}
      onClose={onClose}
      onChange={onChange}
    />
  );
}

interface WorkspaceSettingsDialogInnerProps {
  /** null = create mode; otherwise the workspace to manage. */
  workspace: Workspace | null;
  onClose: () => void;
  /** Called after successful create / rename / delete / leave. */
  onChange: () => void;
}

function WorkspaceSettingsDialogInner({
  workspace,
  onClose,
  onChange,
}: WorkspaceSettingsDialogInnerProps) {
  const store = useWorkspaceDashboardStore;
  const owned = useWorkspaceDashboardStore((s) => s.owned);
  const shared = useWorkspaceDashboardStore((s) => s.shared);

  const [name, setName] = useState(workspace?.name ?? "");
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  // Manage mode starts in the loading state (data is fetched on mount below);
  // create mode has no remote data to load.
  const [loading, setLoading] = useState(workspace !== null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Create form state
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<RoleOption>("editor");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  // Confirmation state
  const [confirm, setConfirm] = useState<"delete" | "leave" | "remove" | null>(null);
  const [confirmMemberId, setConfirmMemberId] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const isOwner = workspace ? canManageWorkspace(workspace.memberRole ?? "viewer") : true;

  // Load members + pending invitations once per mount (manage mode only).
  // State commits happen only after the awaited fetches — never synchronously
  // in the effect body, so no cascading renders. The inner component remounts
  // on every open, so this always reflects the latest server state.
  useEffect(() => {
    if (!workspace) {
      // Create mode: focus the name field.
      const timer = setTimeout(() => nameInputRef.current?.focus(), 30);
      return () => clearTimeout(timer);
    }
    let cancelled = false;
    void (async () => {
      const provider = getWorkspaceProvider();
      if (!provider) {
        // No backend → nothing to load; never leave the loading spinner stuck.
        setLoading(false);
        return;
      }
      const service = new WorkspaceService(provider);
      const [memberResult, inviteResult] = await Promise.all([
        service.listMembers(workspace.id),
        service.listWorkspaceInvitations(workspace.id),
      ]);
      if (cancelled) return;
      if (memberResult.ok) setMembers(memberResult.value);
      else setError(memberResult.error.message);
      if (inviteResult.ok) setInvitations(inviteResult.value);
      setLoading(false);
    })();
    const timer = setTimeout(() => closeRef.current?.focus(), 30);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workspace]);

  // Escape closes (never during a busy operation). The inner component is only
  // mounted while the dialog is open, so no `open` guard is needed here.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy && !creating && !inviting) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, creating, inviting, onClose]);

  // Refreshes members/invitations after a mutation. Only ever invoked from
  // event handlers (never from an effect), so the synchronous loading flip is
  // safe — there is no cascading-render concern on that call path.
  const reload = useCallback(async () => {
    if (!workspace) return;
    const provider = getWorkspaceProvider();
    if (!provider) return;
    const service = new WorkspaceService(provider);
    setLoading(true);
    setError(null);
    const [memberResult, inviteResult] = await Promise.all([
      service.listMembers(workspace.id),
      service.listWorkspaceInvitations(workspace.id),
    ]);
    setLoading(false);
    if (memberResult.ok) setMembers(memberResult.value);
    else setError(memberResult.error.message);
    if (inviteResult.ok) setInvitations(inviteResult.value);
  }, [workspace]);

  // -------------------------------------------------------------------------
  // Create workspace
  // -------------------------------------------------------------------------

  const handleCreate = useCallback(async () => {
    if (creating) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setCreateError("Give your workspace a name.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    const provider = getWorkspaceProvider();
    if (!provider) {
      setCreateError("Workspaces aren't set up for this app yet.");
      setCreating(false);
      return;
    }
    const service = new WorkspaceService(provider);
    const result = await service.createWorkspace(trimmed);
    if (!result.ok) {
      setCreateError(result.error.message);
      setCreating(false);
      return;
    }
    store.getState().setSelectedWorkspaceId(result.value.id);
    onChange();
    onClose();
  }, [name, creating, store, onChange, onClose]);

  // -------------------------------------------------------------------------
  // Rename
  // -------------------------------------------------------------------------

  const handleRename = useCallback(async () => {
    if (!workspace || busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give your workspace a name.");
      return;
    }
    setBusy("rename");
    setError(null);
    const provider = getWorkspaceProvider();
    if (!provider) {
      setBusy(null);
      return;
    }
    const service = new WorkspaceService(provider);
    const result = await service.updateWorkspace(workspace.id, { name: trimmed });
    if (result.ok) {
      setSuccess("Workspace name updated.");
      onChange();
    } else {
      setError(result.error.message);
    }
    setBusy(null);
  }, [workspace, name, busy, onChange]);

  // -------------------------------------------------------------------------
  // Invite
  // -------------------------------------------------------------------------

  const handleInvite = useCallback(async () => {
    if (!workspace || inviting) return;
    const email = inviteEmail.trim();
    if (!email) {
      setInviteError("Enter the email of the person you'd like to invite.");
      return;
    }
    setInviting(true);
    setInviteError(null);
    const provider = getWorkspaceProvider();
    if (!provider) {
      setInviting(false);
      return;
    }
    const service = new WorkspaceService(provider);
    const result = await service.inviteMember(workspace.id, email, inviteRole);
    if (result.ok) {
      setInviteEmail("");
      setSuccess(`Invitation sent to ${email}.`);
      await reload();
    } else {
      setInviteError(result.error.message);
    }
    setInviting(false);
  }, [workspace, inviteEmail, inviteRole, inviting, reload]);

  // -------------------------------------------------------------------------
  // Role change / remove / revoke invite / leave / delete
  // -------------------------------------------------------------------------

  const handleRoleChange = useCallback(
    async (memberUserId: string, role: WorkspaceRole) => {
      if (!workspace || busy) return;
      setBusy(`role-${memberUserId}`);
      setError(null);
      const provider = getWorkspaceProvider();
      if (!provider) {
        setBusy(null);
        return;
      }
      const service = new WorkspaceService(provider);
      const result = await service.changeMemberRole(workspace.id, memberUserId, role);
      if (result.ok) {
        setSuccess("Member role updated.");
        await reload();
      } else {
        setError(result.error.message);
      }
      setBusy(null);
    },
    [workspace, busy, reload],
  );

  const handleRemoveMember = useCallback(async () => {
    if (!workspace || !confirmMemberId) return;
    setBusy(`remove-${confirmMemberId}`);
    setError(null);
    const provider = getWorkspaceProvider();
    if (!provider) {
      setBusy(null);
      return;
    }
    const service = new WorkspaceService(provider);
    const result = await service.removeMember(workspace.id, confirmMemberId);
    if (result.ok) {
      setSuccess("Member removed — they lose access immediately.");
      await reload();
    } else {
      setError(result.error.message);
    }
    setBusy(null);
    setConfirm(null);
    setConfirmMemberId(null);
  }, [workspace, confirmMemberId, reload]);

  const handleRevokeInvitation = useCallback(
    async (invitationId: string) => {
      if (!workspace || busy) return;
      setBusy(`inv-${invitationId}`);
      const provider = getWorkspaceProvider();
      if (!provider) {
        setBusy(null);
        return;
      }
      const service = new WorkspaceService(provider);
      const result = await service.revokeInvitation(invitationId);
      if (result.ok) {
        setSuccess("Invitation cancelled.");
        await reload();
      } else {
        setError(result.error.message);
      }
      setBusy(null);
    },
    [workspace, busy, reload],
  );

  const handleLeave = useCallback(async () => {
    if (!workspace || busy) return;
    setBusy("leave");
    setError(null);
    const provider = getWorkspaceProvider();
    if (!provider) {
      setBusy(null);
      return;
    }
    const service = new WorkspaceService(provider);
    const result = await service.leaveWorkspace(workspace.id);
    if (result.ok) {
      store.getState().clearWorkspaceContext(workspace.id);
      onChange();
      onClose();
    } else {
      setError(result.error.message);
    }
    setBusy(null);
    setConfirm(null);
  }, [workspace, busy, store, onChange, onClose]);

  const handleDelete = useCallback(async () => {
    if (!workspace || busy) return;
    setBusy("delete");
    setError(null);
    const provider = getWorkspaceProvider();
    if (!provider) {
      setBusy(null);
      return;
    }
    const service = new WorkspaceService(provider);
    const result = await service.deleteWorkspace(workspace.id);
    if (result.ok) {
      store.getState().clearWorkspaceContext(workspace.id);
      onChange();
      onClose();
    } else {
      setError(result.error.message);
    }
    setBusy(null);
    setConfirm(null);
  }, [workspace, busy, store, onChange, onClose]);

  const allWorkspaces = [...owned, ...shared];

  // Effective workspace to display: the managed one, or (create mode) none.
  const managedWorkspace = workspace;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-settings-title"
      data-testid="workspace-settings-dialog"
    >
      <div className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-elevated">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10">
              <Users className="h-4 w-4 text-accent" />
            </div>
            <div>
              <h2 id="workspace-settings-title" className="text-base font-semibold text-text-primary">
                {managedWorkspace ? "Workspace settings" : "New workspace"}
              </h2>
              <p className="mt-0.5 text-xs text-text-muted">
                {managedWorkspace
                  ? "Manage members, invites, and this workspace."
                  : "A shared space where you can work together on projects."}
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close workspace settings"
            data-testid="workspace-settings-close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!managedWorkspace ? (
            /* ------------------------------------------------ Create mode */
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="ws-name" className="text-xs font-medium text-text-primary">
                  Workspace name
                </label>
                <input
                  ref={nameInputRef}
                  id="ws-name"
                  type="text"
                  value={name}
                  maxLength={MAX_WORKSPACE_NAME_LENGTH}
                  onChange={(e) => {
                    setName(e.target.value);
                    setCreateError(null);
                  }}
                  placeholder="e.g. Acme Design Team"
                  data-testid="workspace-create-name"
                  className="h-9 w-full rounded-lg border border-border bg-base px-3 text-sm text-text-primary placeholder:text-text-dim/50 transition-all duration-200 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20"
                />
              </div>
              {createError && (
                <p role="alert" className="text-xs text-red-400" data-testid="workspace-create-error">
                  {createError}
                </p>
              )}
              <p className="text-[11px] leading-relaxed text-text-muted">
                You&apos;ll be the owner. You can invite editors and viewers from the
                workspace settings afterwards.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={onClose}
                  className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
                  type="button"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleCreate()}
                  disabled={creating || !name.trim()}
                  data-testid="workspace-create-button"
                  className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                  type="button"
                >
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Create workspace
                </button>
              </div>
            </div>
          ) : (
            /* ----------------------------------------------- Manage mode */
            <div className="flex flex-col gap-6">
              {/* Name */}
              <section aria-label="Workspace name" className="flex flex-col gap-2">
                <label htmlFor="ws-name-manage" className="text-xs font-medium text-text-primary">
                  Workspace name
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="ws-name-manage"
                    type="text"
                    value={name}
                    maxLength={MAX_WORKSPACE_NAME_LENGTH}
                    onChange={(e) => {
                      setName(e.target.value);
                      setError(null);
                      setSuccess(null);
                    }}
                    disabled={!isOwner}
                    data-testid="workspace-rename-input"
                    className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-base px-3 text-sm text-text-primary transition-all duration-200 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20 disabled:opacity-60"
                  />
                  {isOwner && (
                    <button
                      onClick={() => void handleRename()}
                      disabled={busy !== null || !name.trim() || name.trim() === workspace.name}
                      data-testid="workspace-rename-button"
                      className="flex h-9 items-center gap-1.5 rounded-lg bg-accent/10 px-3 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
                      type="button"
                    >
                      {busy === "rename" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      Save
                    </button>
                  )}
                </div>
              </section>

              {/* Feedback */}
              {success && (
                <p
                  role="status"
                  className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400"
                  data-testid="workspace-settings-success"
                >
                  {success}
                </p>
              )}
              {error && (
                <p role="alert" className="text-xs text-red-400" data-testid="workspace-settings-error">
                  {error}
                </p>
              )}

              {/* Invite */}
              {isOwner && (
                <section aria-label="Invite members" className="flex flex-col gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-text-dim">
                    Invite people
                  </h3>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="relative min-w-0 flex-1">
                      <Mail className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-dim" />
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => {
                          setInviteEmail(e.target.value);
                          setInviteError(null);
                        }}
                        placeholder="teammate@email.com"
                        aria-label="Email to invite"
                        data-testid="workspace-invite-email"
                        className="h-9 w-full rounded-lg border border-border bg-base pl-9 pr-3 text-sm text-text-primary placeholder:text-text-dim/50 transition-all duration-200 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20"
                      />
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-text-muted">
                      <span className="sr-only">Role</span>
                      <select
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as RoleOption)}
                        aria-label="Role for invited person"
                        data-testid="workspace-invite-role"
                        className="h-9 rounded-lg border border-border bg-base px-2 text-sm text-text-primary focus:border-accent/40 focus:outline-none"
                      >
                        <option value="editor">Editor — can edit</option>
                        <option value="viewer">Viewer — can view only</option>
                      </select>
                    </label>
                    <button
                      onClick={() => void handleInvite()}
                      disabled={inviting || !inviteEmail.trim()}
                      data-testid="workspace-invite-button"
                      className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                      type="button"
                    >
                      {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                      Invite
                    </button>
                  </div>
                  {inviteError && (
                    <p role="alert" className="text-xs text-red-400" data-testid="workspace-invite-error">
                      {inviteError}
                    </p>
                  )}
                  <p className="text-[11px] text-text-muted">
                    They&apos;ll accept from their account — invitations expire after 14 days.
                  </p>
                </section>
              )}

              {/* Pending invitations */}
              {isOwner && invitations.length > 0 && (
                <section aria-label="Pending invitations" className="flex flex-col gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-text-dim">
                    Pending invitations
                  </h3>
                  <ul className="flex flex-col gap-1.5">
                    {invitations.map((inv) => (
                      <li
                        key={inv.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-base px-3 py-2"
                        data-testid="workspace-pending-invite"
                      >
                        <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
                          {inv.recipientEmail}
                        </span>
                        <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium capitalize text-accent">
                          {inv.role}
                        </span>
                        <button
                          onClick={() => void handleRevokeInvitation(inv.id)}
                          disabled={busy === `inv-${inv.id}`}
                          className="flex h-7 items-center rounded-md px-2 text-[11px] font-medium text-text-dim transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
                          type="button"
                          data-testid={`workspace-revoke-invite-${inv.id}`}
                        >
                          {busy === `inv-${inv.id}` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            "Cancel"
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Members */}
              {isOwner && (
                <section aria-label="Members" className="flex flex-col gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-text-dim">
                    Members
                  </h3>
                  {loading ? (
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading members…
                    </div>
                  ) : members.length === 0 ? (
                    <p className="text-xs text-text-muted">
                      No members yet — invite someone to collaborate.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {members.map((member) => (
                        <li
                          key={member.userId}
                          className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-base px-3 py-2"
                          data-testid={`workspace-member-${member.email}`}
                        >
                          <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
                            {member.email}
                          </span>
                          <label className="flex items-center gap-1.5 text-xs">
                            <span className="sr-only">Role for {member.email}</span>
                            <select
                              value={member.role}
                              onChange={(e) =>
                                void handleRoleChange(
                                  member.userId,
                                  e.target.value as WorkspaceRole,
                                )
                              }
                              disabled={busy === `role-${member.userId}`}
                              aria-label={`Role for ${member.email}`}
                              data-testid={`workspace-role-${member.email}`}
                              className="h-7 rounded-md border border-border bg-base px-1.5 text-[11px] text-text-primary focus:border-accent/40 focus:outline-none disabled:opacity-50"
                            >
                              <option value="editor">Editor</option>
                              <option value="viewer">Viewer</option>
                            </select>
                          </label>
                          <button
                            onClick={() => {
                              setConfirm("remove");
                              setConfirmMemberId(member.userId);
                            }}
                            disabled={busy !== null}
                            aria-label={`Remove ${member.email}`}
                            data-testid={`workspace-remove-${member.email}`}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
                            type="button"
                          >
                            <UserMinus className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {/* Non-owner info */}
              {!isOwner && (
                <section aria-label="Your role" className="rounded-lg border border-border/60 bg-base p-3">
                  <p className="text-xs leading-relaxed text-text-muted">
                    You&apos;re a <span className="font-medium capitalize text-text-primary">{workspace.memberRole}</span> in
                    this workspace. Editors can edit projects; viewers can view.
                    Only the owner can manage members.
                  </p>
                </section>
              )}

              {/* Leave / Delete */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/10">
                    <Shield className="h-3 w-3 text-accent" />
                  </span>
                  <span className="text-xs text-text-muted">
                    {allWorkspaces.find((w) => w.id === workspace.id)?.memberCount ?? 1} member
                    {(allWorkspaces.find((w) => w.id === workspace.id)?.memberCount ?? 1) === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {!isOwner && (
                    <button
                      onClick={() => setConfirm("leave")}
                      data-testid="workspace-leave-button"
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
                      type="button"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Leave workspace
                    </button>
                  )}
                  {isOwner && (
                    <button
                      onClick={() => setConfirm("delete")}
                      data-testid="workspace-delete-button"
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-red-500/30 px-3 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10"
                      type="button"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete workspace
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation */}
      {confirm && managedWorkspace && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="workspace-confirm-title"
          data-testid="workspace-confirm-dialog"
        >
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-elevated">
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-red-500/10">
                <AlertTriangle className="h-4 w-4 text-red-400" />
              </span>
              <div>
                <h4 id="workspace-confirm-title" className="text-sm font-semibold text-text-primary">
                  {confirm === "delete"
                    ? "Delete this workspace?"
                    : confirm === "leave"
                      ? "Leave this workspace?"
                      : "Remove this member?"}
                </h4>
                <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
                  {confirm === "delete"
                    ? `"${managedWorkspace.name}" and all its projects will be permanently deleted. This cannot be undone.`
                    : confirm === "leave"
                      ? "You'll lose access to this workspace and its projects. You can be invited back anytime."
                      : "They'll lose access to this workspace and its projects immediately."}
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setConfirm(null);
                  setConfirmMemberId(null);
                }}
                className="flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (confirm === "delete") void handleDelete();
                  else if (confirm === "leave") void handleLeave();
                  else void handleRemoveMember();
                }}
                data-testid="workspace-confirm-action"
                className={cn(
                  "flex h-8 items-center rounded-lg px-3 text-xs font-medium text-white transition-colors",
                  confirm === "remove" ? "bg-red-600 hover:bg-red-500" : "bg-accent hover:bg-accent-hover",
                )}
                type="button"
              >
                {busy === "delete" || busy === "leave" || busy === `remove-${confirmMemberId}` ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : confirm === "delete" ? (
                  "Delete workspace"
                ) : confirm === "leave" ? (
                  "Leave workspace"
                ) : (
                  "Remove member"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
