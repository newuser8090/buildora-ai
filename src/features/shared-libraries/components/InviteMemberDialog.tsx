"use client";

// ---------------------------------------------------------------------------
// Private Shared Libraries (Phase P6) — invite member dialog
//
// Invites by email with an explicit permission (viewer / editor). Email
// delivery is NOT configured in P6 — invitations appear in-app for the
// invited user's account. This is stated plainly instead of pretending an
// email was sent.
// ---------------------------------------------------------------------------

import { useRef, useState } from "react";
import { X, Loader2, Mail } from "lucide-react";
import { getCloudProvider } from "@/features/cloud-sync/providers/provider-factory";
import { SharedLibraryService } from "../services/shared-library-service";
import { useSharedLibrariesUiStore } from "../store/shared-libraries-ui-store";
import { useFocusTrap } from "@/features/auth/components/useFocusTrap";
import type { SharedLibraryRole } from "@/features/cloud-sync/types";

export interface InviteMemberDialogProps {
  onInvited: () => void;
}

export function InviteMemberDialog({ onInvited }: InviteMemberDialogProps) {
  const inviteDialog = useSharedLibrariesUiStore((s) => s.inviteDialog);
  const close = useSharedLibrariesUiStore((s) => s.closeInvite);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<SharedLibraryRole>("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useFocusTrap(!!inviteDialog, dialogRef);

  if (!inviteDialog) return null;

  const handleInvite = async () => {
    if (busy) return;
    const trimmed = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      setError("Please enter a valid email address.");
      return;
    }
    setBusy(true);
    setError(null);
    const provider = getCloudProvider();
    if (!provider) {
      setError("Cloud backup isn't configured for this app yet.");
      setBusy(false);
      return;
    }
    const service = new SharedLibraryService(provider);
    const result = await service.invite(inviteDialog.libraryId, trimmed, role);
    setBusy(false);
    if (result.ok) {
      setSent(true);
      setEmail("");
      onInvited();
    } else {
      setError(result.error.message);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-title"
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-elevated"
      >
        <div className="flex items-start justify-between">
          <h2 id="invite-title" className="text-lg font-semibold text-text-primary">
            Invite someone
          </h2>
          <button
            onClick={close}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-base hover:text-text-primary"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {sent ? (
          <div className="mt-5">
            <p className="text-sm text-text-muted">
              Invitation sent. They&apos;ll see it under Shared libraries next time they sign in.
            </p>
            <button
              onClick={close}
              className="mt-5 flex h-10 w-full items-center justify-center rounded-lg bg-accent text-sm font-medium text-white transition-colors hover:bg-accent-hover"
              type="button"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <p className="text-xs leading-relaxed text-text-muted">
              Invitations are delivered in-app for now (email delivery isn&apos;t set up yet). The
              person you invite needs an account with this email.
            </p>
            <div>
              <label htmlFor="invite-email" className="mb-1.5 block text-sm font-medium text-text-primary">
                Their email
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-dim" />
                <input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="friend@example.com"
                  className="h-10 w-full rounded-lg border border-border bg-base pl-9 pr-3 text-sm text-text-primary placeholder:text-text-dim/50 transition-all focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20"
                />
              </div>
            </div>
            <div>
              <span className="mb-1.5 block text-sm font-medium text-text-primary">Permission</span>
              <div className="grid grid-cols-2 gap-2">
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm transition-colors ${
                    role === "viewer" ? "border-accent/50 bg-accent/5 text-text-primary" : "border-border text-text-muted hover:bg-base"
                  }`}
                >
                  <input
                    type="radio"
                    name="invite-role"
                    checked={role === "viewer"}
                    onChange={() => setRole("viewer")}
                    className="sr-only"
                  />
                  <span>
                    <span className="block text-xs font-medium">Can view</span>
                    <span className="block text-[11px]">See and copy pieces</span>
                  </span>
                </label>
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm transition-colors ${
                    role === "editor" ? "border-accent/50 bg-accent/5 text-text-primary" : "border-border text-text-muted hover:bg-base"
                  }`}
                >
                  <input
                    type="radio"
                    name="invite-role"
                    checked={role === "editor"}
                    onChange={() => setRole("editor")}
                    className="sr-only"
                  />
                  <span>
                    <span className="block text-xs font-medium">Can edit</span>
                    <span className="block text-[11px]">View, copy, add pieces</span>
                  </span>
                </label>
              </div>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              onClick={() => void handleInvite()}
              disabled={busy}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-white transition-all hover:bg-accent-hover disabled:opacity-60"
              type="button"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Send invitation
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
