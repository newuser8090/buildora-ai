"use client";

// ---------------------------------------------------------------------------
// Private Shared Libraries (Phase P6) — panel
//
// Shows "Owned by me" and "Shared with me" libraries plus pending
// invitations. Beginner copy: "Share a private box of saved pieces."
// Offline: previously cached previews remain visible and are labelled.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Plus, Loader2, Users, Inbox, WifiOff, Check } from "lucide-react";
import { useAuth } from "@/features/auth/useAuth";
import { getCloudProvider } from "@/features/cloud-sync/providers/provider-factory";
import { SharedLibraryService } from "../services/shared-library-service";
import {
  getCachedListing,
  setCachedListing,
  setCachedInvitations,
} from "../services/shared-library-cache";
import { SHARED_LIBRARY_TAGLINE, roleLabel } from "../types";
import { useSharedLibrariesUiStore } from "../store/shared-libraries-ui-store";
import { SharedLibraryCard } from "./SharedLibraryCard";
import { CreateSharedLibraryDialog } from "./CreateSharedLibraryDialog";
import { ManageSharedLibraryDialog } from "./ManageSharedLibraryDialog";
import { SharedLibraryDetailsDialog } from "./SharedLibraryDetailsDialog";
import { useFocusTrap } from "@/features/auth/components/useFocusTrap";
import type { CloudSharedLibrary, CloudLibraryInvitation } from "@/features/cloud-sync/types";

export function SharedLibrariesPanel() {
  const open = useSharedLibrariesUiStore((s) => s.panelOpen);
  const closePanel = useSharedLibrariesUiStore((s) => s.closePanel);
  const openCreate = useSharedLibrariesUiStore((s) => s.openCreate);
  const refreshTick = useSharedLibrariesUiStore((s) => s.refreshTick);
  const { user } = useAuth();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const [owned, setOwned] = useState<CloudSharedLibrary[]>([]);
  const [shared, setShared] = useState<CloudSharedLibrary[]>([]);
  const [invitations, setInvitations] = useState<CloudLibraryInvitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [deleting, setDeleting] = useState<CloudSharedLibrary | null>(null);
  const [leaving, setLeaving] = useState<CloudSharedLibrary | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  useFocusTrap(open, dialogRef);

  // Render-phase reset when the panel opens (never sync setState in an effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setLoading(true);
      setError(null);
      setOffline(false);
    }
  }

  const fetchPanelData = useCallback(async () => {
    if (!user) return null;
    const provider = getCloudProvider();
    if (!provider) return { notConfigured: true } as const;
    const service = new SharedLibraryService(provider);
    const listingResult = await service.list();
    const invitationsResult = await service.listInvitations();
    return { listingResult, invitationsResult };
  }, [user]);

  const applyPanelData = useCallback(
    (payload: Exclude<Awaited<ReturnType<typeof fetchPanelData>>, null>) => {
      if ("notConfigured" in payload) {
        setLoading(false);
        setError("Cloud backup isn't configured for this app yet.");
        return;
      }
      const { listingResult, invitationsResult } = payload;
      if (listingResult.ok && invitationsResult.ok) {
        setOwned(listingResult.value.owned);
        setShared(listingResult.value.shared);
        setInvitations(invitationsResult.value);
        setOffline(false);
        if (user) {
          setCachedListing(user.id, listingResult.value);
          setCachedInvitations(user.id, invitationsResult.value);
        }
      } else {
        // Offline: fall back to the per-user cache, labelled as cached.
        const cached = user ? getCachedListing(user.id) : null;
        if (cached) {
          setOwned(cached.owned);
          setShared(cached.shared);
          setOffline(true);
        } else {
          // At least one request failed — surface the failing one's message.
          const failed = listingResult.ok ? invitationsResult : listingResult;
          setError(
            failed.ok
              ? "Couldn't load shared libraries. Check your connection and try again."
              : (failed.error?.message ?? "Couldn't load shared libraries."),
          );
        }
      }
      setLoading(false);
    },
    [user],
  );

  // Results are applied through a .then callback — no synchronous setState
  // inside the effect body.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchPanelData().then((payload) => {
      if (cancelled || !payload) return;
      applyPanelData(payload);
    });
    return () => {
      cancelled = true;
    };
  }, [open, fetchPanelData, applyPanelData, refreshTick]);

  /** Event-handler reload (post-action refresh). */
  const reload = useCallback(async () => {
    const payload = await fetchPanelData();
    if (payload) applyPanelData(payload);
  }, [fetchPanelData, applyPanelData]);

  if (!open) return null;

  const confirmAction = (library: CloudSharedLibrary) => {
    if (actionBusy) return;
    setActionBusy(true);
    const provider = getCloudProvider();
    if (!provider) return;
    const service = new SharedLibraryService(provider);
    const task = deleting
      ? service.delete(library.id)
      : service.leave(library.id);
    void task.then((result) => {
      setActionBusy(false);
      setDeleting(null);
      setLeaving(null);
      if (!result.ok) setError(result.error.message);
      void reload();
    });
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closePanel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shared-libraries-title"
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-card shadow-elevated"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 id="shared-libraries-title" className="text-lg font-semibold text-text-primary">
              Shared libraries
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">{SHARED_LIBRARY_TAGLINE}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => openCreate()}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-white transition-all hover:bg-accent-hover"
              type="button"
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
            <button
              onClick={closePanel}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-base hover:text-text-primary"
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          {offline && (
            <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300">
              <WifiOff className="h-3.5 w-3.5" />
              You&apos;re offline — showing previously loaded libraries. Access is re-checked when
              you&apos;re back online.
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          {loading && owned.length === 0 && shared.length === 0 ? (
            <p className="flex items-center gap-2 py-8 text-center text-sm text-text-dim">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading shared libraries…
            </p>
          ) : (
            <>
              {invitations.length > 0 && (
                <section aria-label="Invitations">
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-dim">
                    <Inbox className="h-3.5 w-3.5" /> Invitations for you
                  </h3>
                  <div className="space-y-2">
                    {invitations.map((invitation) => (
                      <div
                        key={invitation.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-border bg-base px-4 py-3"
                        data-testid="invitation-row"
                      >
                        <div>
                          <p className="text-sm font-medium text-text-primary">{invitation.libraryName}</p>
                          <p className="text-xs text-text-muted">
                            {roleLabel(invitation.role)} · expires{" "}
                            {new Date(invitation.expiresAt).toLocaleDateString()}
                          </p>
                        </div>
                        <InvitationAcceptButton invitationId={invitation.id} onDone={() => void reload()} />
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section aria-label="Owned by me">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-dim">
                  <Users className="h-3.5 w-3.5" /> Owned by me
                </h3>
                {owned.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-text-dim">
                    No shared libraries yet. Create one to share a private box of saved pieces.
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {owned.map((library) => (
                      <SharedLibraryCard
                        key={library.id}
                        library={library}
                        isOwner
                        onDelete={(lib) => setDeleting(lib)}
                        onLeave={() => undefined}
                      />
                    ))}
                  </div>
                )}
              </section>

              <section aria-label="Shared with me">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-dim">
                  <Users className="h-3.5 w-3.5" /> Shared with me
                </h3>
                {shared.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-text-dim">
                    Nothing shared with you yet.
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {shared.map((library) => (
                      <SharedLibraryCard
                        key={library.id}
                        library={library}
                        isOwner={false}
                        onDelete={() => undefined}
                        onLeave={(lib) => setLeaving(lib)}
                      />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-6 py-3 text-xs text-text-dim">
          <Check className="h-3.5 w-3.5 text-emerald-400" />
          Private by default — nothing here is shared publicly.
        </div>
      </div>

      {/* Confirmation dialogs */}
      {deleting && (
        <ConfirmLibraryAction
          title={`Delete "${deleting.name}"?`}
          message="Members lose access, and this library can't be restored. Pieces you already copied to your own library stay yours."
          confirmLabel="Delete library"
          destructive
          busy={actionBusy}
          onConfirm={() => confirmAction(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
      {leaving && (
        <ConfirmLibraryAction
          title={`Leave "${leaving.name}"?`}
          message="You'll lose access to this library. Nothing you've copied to your own library changes."
          confirmLabel="Leave library"
          busy={actionBusy}
          onConfirm={() => confirmAction(leaving)}
          onCancel={() => setLeaving(null)}
        />
      )}

      <CreateSharedLibraryDialog onCreated={() => void reload()} />
      <ManageSharedLibraryDialog onChanged={() => void reload()} />
      <SharedLibraryDetailsDialog onChanged={() => void reload()} />
    </div>
  );
}

function InvitationAcceptButton({ invitationId, onDone }: { invitationId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accept = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const provider = getCloudProvider();
    if (!provider) return;
    const service = new SharedLibraryService(provider);
    const result = await service.acceptInvitation(invitationId);
    setBusy(false);
    if (result.ok) {
      onDone();
    } else {
      setError(result.error.message);
    }
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={() => void accept()}
        disabled={busy}
        className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-white transition-all hover:bg-accent-hover disabled:opacity-50"
        type="button"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        Accept
      </button>
      {error && <span className="text-[11px] text-red-400">{error}</span>}
    </div>
  );
}

function ConfirmLibraryAction(props: {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="alertdialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-elevated">
        <h3 className="text-lg font-semibold text-text-primary">{props.title}</h3>
        <p className="mt-2 text-sm text-text-muted">{props.message}</p>
        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            onClick={props.onCancel}
            className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-colors hover:bg-base hover:text-text-primary"
            type="button"
          >
            Cancel
          </button>
          <button
            onClick={props.onConfirm}
            disabled={props.busy}
            className={`flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium text-white transition-colors disabled:opacity-50 ${
              props.destructive ? "bg-red-600 hover:bg-red-500" : "bg-accent hover:bg-accent-hover"
            }`}
            type="button"
          >
            {props.busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}