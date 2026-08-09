"use client";

// ---------------------------------------------------------------------------
// ShareDialog — the ONE canonical share surface (Phase P12)
//
// Every entry point (TopNav Share, command palette, dashboard manage action)
// opens this dialog. It owns:
//   - the beginner "Create review link" flow + settings (feedback / name /
//     expiry)
//   - the management list (copy / revoke / regenerate)
//   - the owner review feedback panel (resolve / reopen / delete / jump)
//
// Gates: sharing requires a cloud backend (mock/supabase), connectivity, and
// a signed-in owner. Offline and signed-out states show beginner copy and a
// recovery path (the sign-in dialog opens in place).
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { X, Link2, MessageSquareText, WifiOff, ShieldAlert } from "lucide-react";
import { useAuth } from "@/features/auth/useAuth";
import { AuthDialog } from "@/features/auth/components/AuthDialog";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { shareBackendAvailable } from "../services/share-link-service";
import { useShareUiStore, type ShareDialogTab } from "../store/share-ui-store";
import { markPerf } from "@/features/perf/perf-instrumentation";
import { SHARE_PERF_MARKS } from "../constants";
import { ReviewLinksTab } from "./ReviewLinksTab";
import { ReviewFeedbackTab } from "./ReviewFeedbackTab";

const TABS: Array<{ id: ShareDialogTab; label: string; icon: typeof Link2 }> = [
  { id: "create", label: "Review links", icon: Link2 },
  { id: "feedback", label: "Review feedback", icon: MessageSquareText },
];

export function ShareDialog() {
  const open = useShareUiStore((s) => s.dialogOpen);
  const tab = useShareUiStore((s) => s.tab);
  const setTab = useShareUiStore((s) => s.setTab);
  const closeShareDialog = useShareUiStore((s) => s.closeShareDialog);
  const isHydrated = useEditorStore((s) => s.isHydrated);
  const project = useEditorStore((s) => s.project);

  const { status: authStatus } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Perf mark + focus management on open.
  useEffect(() => {
    if (!open) return;
    markPerf(SHARE_PERF_MARKS.dialogOpen);
    const timer = setTimeout(() => closeRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  // Escape closes (consistent with app dialogs).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeShareDialog();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, closeShareDialog]);

  // Online/offline tracking for the connectivity gate.
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (!open) return null;

  const configured = shareBackendAvailable();

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-dialog-title"
      data-testid="share-dialog"
    >
      <div className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-elevated">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id="share-dialog-title" className="text-base font-semibold text-text-primary">
              Share this website
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              {tab === "feedback" ? "Review feedback from people you shared with" : "Send a read-only review link to anyone"}
            </p>
          </div>
          <button
            ref={closeRef}
            onClick={closeShareDialog}
            aria-label="Close share dialog"
            data-testid="share-dialog-close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Gate: no cloud backend */}
          {!configured && (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <ShieldAlert className="h-8 w-8 text-text-dim" />
              <p className="max-w-xs text-sm text-text-muted">
                Review links aren&apos;t set up for this app yet. Please try again later.
              </p>
            </div>
          )}

          {/* Gate: offline */}
          {configured && !online && (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <WifiOff className="h-8 w-8 text-text-dim" />
              <p className="max-w-xs text-sm text-text-muted">
                You&apos;re offline. Reconnect to create or manage review links.
              </p>
            </div>
          )}

          {/* Gate: not signed in */}
          {configured && online && authStatus !== "signed-in" && (
            <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10">
                <Link2 className="h-6 w-6 text-accent" />
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary">Sign in to share this website</p>
                <p className="mt-1 max-w-xs text-xs text-text-muted">
                  Review links live with your account so you can manage them from anywhere.
                </p>
              </div>
              <button
                onClick={() => setAuthOpen(true)}
                className="flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                type="button"
              >
                Sign in
              </button>
            </div>
          )}

          {/* Content */}
          {configured && online && authStatus === "signed-in" && isHydrated && project.id && (
            <>
              {/* Tabs */}
              <div className="flex gap-1 border-b border-border px-4 pt-3" role="tablist" aria-label="Share options">
                {TABS.map((t) => {
                  const Icon = t.icon;
                  const active = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      role="tab"
                      aria-selected={active}
                      onClick={() => setTab(t.id)}
                      className={`flex h-9 items-center gap-1.5 rounded-t-lg border-b-2 px-3 text-xs font-medium transition-colors ${
                        active
                          ? "border-accent text-accent"
                          : "border-transparent text-text-dim hover:text-text-primary"
                      }`}
                      type="button"
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {t.label}
                    </button>
                  );
                })}
              </div>

              <div className="p-5">
                {tab === "feedback" ? (
                  <ReviewFeedbackTab />
                ) : (
                  <ReviewLinksTab projectId={project.id} />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* In-place sign-in (same pattern as the sync status control). */}
      <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} initialMode="sign-in" />
    </div>
  );
}
