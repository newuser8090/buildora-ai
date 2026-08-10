"use client";

// ---------------------------------------------------------------------------
// ReviewLinksTab — create + manage review links (Phase P12)
//
// Create: beginner settings (allow feedback, require name, expiry) → create →
// push the sanitized projection → show the link for copying. The raw token is
// returned exactly once and cached ONLY on this device so "Copy" keeps
// working from the manage list; the server never returns it again.
//
// Manage: active/expired/revoked links with created date, expiry, feedback
// count, last-opened (timestamp only), copy, regenerate (old link dies
// immediately) and revoke (immediate).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Plus, RefreshCw, ShieldOff, Loader2, Link2, Check } from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useWorkspaceAccessStore } from "@/features/workspaces/store/workspace-access-store";
import { recordWorkspaceActivity } from "@/features/workspaces/services/activity-bridge";
import { getShareProvider, ShareLinkService } from "../services/share-link-service";
import {
  cachedShareToken,
  cacheShareToken,
  removeCachedShareToken,
  setCachedShareIds,
} from "../services/share-local-cache";
import { buildShareProjection, serializeProjection } from "../projection/sanitize-share-projection";
import { shareErrorMessage } from "../errors";
import { EXPIRY_PRESETS, SHARE_PERF_MARKS, SHARE_ROUTE_PREFIX } from "../constants";
import { useShareUiStore } from "../store/share-ui-store";
import { notifyActionFeedback } from "@/features/feedback/action-feedback";
import { markPerf } from "@/features/perf/perf-instrumentation";
import type { ShareExpiryPreset, ShareLinkSummary, ShareLinkWithToken } from "../types";
import { copyTextToClipboard, formatDate, formatExpiryLabel, formatLastOpened } from "../utils/share-format";

function shareUrlOf(rawToken: string): string {
  return `${window.location.origin}${SHARE_ROUTE_PREFIX}${rawToken}`;
}

interface LinkRowProps {
  link: ShareLinkSummary;
  busy: boolean;
  onRegenerate: (id: string) => void;
  onRevoke: (id: string) => void;
}

function LinkRow({ link, busy, onRegenerate, onRevoke }: LinkRowProps) {
  const [copied, setCopied] = useState(false);
  const token = cachedShareToken(link.id);
  const url = token ? shareUrlOf(token) : null;
  const expired = formatExpiryLabel(link.expiresAt) === "Expired";
  const revoked = link.status === "revoked";
  const stateLabel = revoked ? "Stopped" : expired ? "Expired" : "Active";

  return (
    <li className="rounded-xl border border-border bg-base p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            revoked
              ? "bg-red-500/10 text-red-500"
              : expired
                ? "bg-yellow-500/10 text-yellow-600"
                : "bg-emerald-500/10 text-emerald-600"
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
          {stateLabel}
        </span>
        <span className="text-xs text-text-muted">
          Created {formatDate(link.createdAt)}
        </span>
        <span className="text-xs text-text-muted">· Expires {formatExpiryLabel(link.expiresAt)}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
        <span data-testid="share-feedback-count">
          {link.feedbackCount} {link.feedbackCount === 1 ? "comment" : "comments"}
        </span>
        <span data-testid="share-last-opened">{formatLastOpened(link.lastOpenedAt)}</span>
        <span>
          Feedback {link.feedbackEnabled ? "on" : "off"}
          {link.requireName ? " · name required" : ""}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {url ? (
          <button
            onClick={() => {
              void copyTextToClipboard(url).then((ok) => {
                if (ok) {
                  setCopied(true);
                  notifyActionFeedback("Review link copied");
                  setTimeout(() => setCopied(false), 1600);
                } else {
                  notifyActionFeedback("Select the link from your created card and copy it manually");
                }
              });
            }}
            disabled={busy}
            data-testid={`share-copy-${link.id}`}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-accent/10 px-3 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
            type="button"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy link"}
          </button>
        ) : (
          <span className="text-xs text-text-dim">
            Copy this link from the device that created it — or regenerate to make a fresh one.
          </span>
        )}
        {!revoked && (
          <button
            onClick={() => onRegenerate(link.id)}
            disabled={busy}
            data-testid={`share-regenerate-${link.id}`}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary disabled:opacity-50"
            type="button"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Regenerate
          </button>
        )}
        {!revoked && (
          <button
            onClick={() => onRevoke(link.id)}
            disabled={busy}
            data-testid={`share-revoke-${link.id}`}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-50"
            type="button"
          >
            <ShieldOff className="h-3.5 w-3.5" />
            Stop link
          </button>
        )}
      </div>
    </li>
  );
}

export function ReviewLinksTab({ projectId }: { projectId: string }) {
  const project = useEditorStore((s) => s.project);
  const revision = useEditorStore((s) => s.revision);
  const refreshTick = useShareUiStore((s) => s.refreshTick);
  const openShareDialog = useShareUiStore((s) => s.openShareDialog);

  const [links, setLinks] = useState<ShareLinkSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Create-form settings
  const [feedbackEnabled, setFeedbackEnabled] = useState(true);
  const [requireName, setRequireName] = useState(false);
  const [preset, setPreset] = useState<ShareExpiryPreset>("never");
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<ShareLinkWithToken | null>(null);

  // Confirmation state for destructive-ish actions
  const [confirm, setConfirm] = useState<{ type: "regenerate" | "revoke"; id: string } | null>(null);

  // Escape cancels the inline confirmation (consistent with app dialogs).
  useEffect(() => {
    if (!confirm) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirm(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirm]);

  const load = useCallback(async () => {
    const provider = getShareProvider();
    if (!provider) return;
    const service = new ShareLinkService(provider);
    setLoading(true);
    // NOTE: load() must NOT clear a pre-existing error here. A create that
    // just failed sets error before the mount load resolves; clearing it here
    // would wipe the banner the user is looking at. Action handlers clear
    // error when THEY start.
    const result = await service.list(projectId);
    if (result.ok) {
      setLinks(result.value);
      setCachedShareIds(
        projectId,
        result.value.filter((l) => l.status === "active").map((l) => l.id),
      );
    } else {
      setError(shareErrorMessage(result.error));
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    // requestAnimationFrame defers the state updates past the effect (the
    // codebase set-state-in-effect convention).
    const raf = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(raf);
  }, [load, refreshTick]);

  // Mark share_loaded when the list arrives (instrumentation).
  useEffect(() => {
    if (!loading) markPerf(SHARE_PERF_MARKS.loaded);
  }, [loading]);

  const handleCreate = useCallback(async () => {
    const provider = getShareProvider();
    if (!provider || creating) return;
    setCreating(true);
    setError(null);
    const service = new ShareLinkService(provider);
    const created = await service.create({
      projectId,
      feedbackEnabled,
      requireName: requireName && feedbackEnabled,
      preset,
    });
    if (!created.ok) {
      setError(shareErrorMessage(created.error));
      setCreating(false);
      return;
    }
    // Push the sanitized projection so the link renders immediately. A link
    // without a projection 404s for viewers ("This review link isn't
    // working"), so when the snapshot cannot be pushed we best-effort revoke
    // the just-made link and show an honest error — never a "ready" card
    // for a dead link.
    const projection = buildShareProjection(project);
    if (!projection.ok) {
      void service.revoke(created.value.link.id);
      setError(shareErrorMessage(projection.error));
      setCreating(false);
      return;
    }
    const pushed = await service.pushSnapshot(
      created.value.link.id,
      serializeProjection(projection.projection),
      revision,
    );
    if (!pushed.ok) {
      void service.revoke(created.value.link.id);
      setError(shareErrorMessage(pushed.error));
      setCreating(false);
      return;
    }
    cacheShareToken(created.value.link.id, created.value.rawToken);
    setCachedShareIds(
      projectId,
      [...links.filter((l) => l.status === "active").map((l) => l.id), created.value.link.id],
    );
    markPerf(SHARE_PERF_MARKS.created);
    setJustCreated(created.value);
    setCreating(false);
    // Phase P15 — activity: a new review link for a workspace project.
    recordWorkspaceActivity({
      workspaceId: useWorkspaceAccessStore.getState().workspaceId,
      projectId,
      type: "share.created",
    });
    await load();
  }, [projectId, feedbackEnabled, requireName, preset, project, revision, creating, links, load]);

  const handleRegenerate = useCallback(async (id: string) => {
    const provider = getShareProvider();
    if (!provider) return;
    setBusy(id);
    setError(null);
    const service = new ShareLinkService(provider);
    const result = await service.regenerate(id);
    if (result.ok) {
      removeCachedShareToken(id);
      cacheShareToken(id, result.value.rawToken);
      setJustCreated(result.value);
      notifyActionFeedback("New review link created — the old one stopped working.");
      // Phase P15 — activity: regenerating creates a fresh link.
      recordWorkspaceActivity({
        workspaceId: useWorkspaceAccessStore.getState().workspaceId,
        projectId,
        type: "share.created",
      });
      await load();
    } else {
      setError(shareErrorMessage(result.error));
    }
    setBusy(null);
    setConfirm(null);
  }, [projectId, load]);

  const handleRevoke = useCallback(async (id: string) => {
    const provider = getShareProvider();
    if (!provider) return;
    setBusy(id);
    setError(null);
    const service = new ShareLinkService(provider);
    const result = await service.revoke(id);
    if (result.ok) {
      removeCachedShareToken(id);
      notifyActionFeedback("Review link stopped.");
      // Phase P15 — activity: a workspace project's review link was revoked.
      recordWorkspaceActivity({
        workspaceId: useWorkspaceAccessStore.getState().workspaceId,
        projectId,
        type: "share.revoked",
      });
      await load();
    } else {
      setError(shareErrorMessage(result.error));
    }
    setBusy(null);
    setConfirm(null);
  }, [projectId, load]);

  const activeLinks = useMemo(() => links.filter((l) => l.status === "active"), [links]);
  const otherLinks = useMemo(() => links.filter((l) => l.status !== "active"), [links]);

  return (
    <div className="space-y-5">
      {/* Create form */}
      <section aria-label="Create a review link" className="rounded-xl border border-border bg-base p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10">
            <Plus className="h-4 w-4 text-accent" />
          </span>
          <h3 className="text-sm font-semibold text-text-primary">
            {activeLinks.length > 0 ? "Create another review link" : "Create a review link"}
          </h3>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3">
            <span className="text-xs text-text-primary">
              <span className="block font-medium">Allow feedback</span>
              <span className="mt-0.5 block text-[11px] text-text-muted">
                Viewers can leave comments
              </span>
            </span>
            <input
              type="checkbox"
              checked={feedbackEnabled}
              onChange={(e) => {
                setFeedbackEnabled(e.target.checked);
                if (!e.target.checked) setRequireName(false);
              }}
              aria-label="Allow feedback"
              data-testid="share-feedback-toggle"
              className="h-4 w-4 accent-[--accent]"
            />
          </label>

          <label
            className={`flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3 transition-opacity ${
              feedbackEnabled ? "" : "opacity-40"
            }`}
          >
            <span className="text-xs text-text-primary">
              <span className="block font-medium">Ask for their name</span>
              <span className="mt-0.5 block text-[11px] text-text-muted">
                Reviewers enter a display name with their comment
              </span>
            </span>
            <input
              type="checkbox"
              checked={requireName && feedbackEnabled}
              disabled={!feedbackEnabled}
              onChange={(e) => setRequireName(e.target.checked)}
              aria-label="Ask reviewers for their name"
              data-testid="share-require-name-toggle"
              className="h-4 w-4 accent-[--accent]"
            />
          </label>
        </div>

        <div className="mt-3">
          <label htmlFor="share-expiry" className="block text-xs font-medium text-text-primary">
            Expire link
          </label>
          <select
            id="share-expiry"
            value={preset}
            onChange={(e) => setPreset(e.target.value as ShareExpiryPreset)}
            data-testid="share-expiry-select"
            className="mt-1.5 h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs text-text-primary focus:border-accent/40 focus:outline-none sm:w-48"
          >
            {EXPIRY_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={() => void handleCreate()}
          disabled={creating}
          data-testid="share-create-button"
          className="mt-4 flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
          type="button"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
          {creating ? "Creating…" : "Create review link"}
        </button>
        <p className="mt-2 text-[11px] text-text-muted">
          The link shows the latest saved version of this website. Anyone with the link can view it —
          they cannot edit.
        </p>

        {/* Just-created / regenerated link with copy */}
        {justCreated && (
          <div
            className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3"
            data-testid="share-created-card"
          >
            <p className="text-xs font-medium text-emerald-700">
              Your review link is ready
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                readOnly
                value={justCreated.url}
                onFocus={(e) => e.target.select()}
                aria-label="Review link"
                data-testid="share-created-url"
                className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-card px-2.5 text-xs text-text-primary focus:outline-none"
              />
              <button
                onClick={() => {
                  void copyTextToClipboard(justCreated.url).then((ok) => {
                    if (ok) {
                      notifyActionFeedback("Review link copied");
                    } else {
                      notifyActionFeedback("Select the link and copy it with Ctrl+C (⌘+C on Mac)");
                    }
                  });
                }}
                data-testid="share-copy-created"
                className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
                type="button"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Error banner */}
      {error && (
        <div
          role="status"
          data-testid="share-error"
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600"
        >
          {error}
        </div>
      )}

      {/* Links list */}
      <section aria-label="Your review links">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-dim">
          Your review links
        </h3>
        {loading ? (
          <div className="mt-3 flex items-center gap-2 text-xs text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading review links…
          </div>
        ) : links.length === 0 ? (
          <p className="mt-3 text-xs text-text-muted">
            No review links yet. Create one above to share this website.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {activeLinks.map((link) => (
              <LinkRow
                key={link.id}
                link={link}
                busy={busy === link.id}
                onRegenerate={(id) => setConfirm({ type: "regenerate", id })}
                onRevoke={(id) => setConfirm({ type: "revoke", id })}
              />
            ))}
            {otherLinks.map((link) => (
              <LinkRow
                key={link.id}
                link={link}
                busy={busy === link.id}
                onRegenerate={(id) => setConfirm({ type: "regenerate", id })}
                onRevoke={(id) => setConfirm({ type: "revoke", id })}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Inline confirmation */}
      {confirm && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="share-confirm-title"
          data-testid="share-confirm-dialog"
        >
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-elevated">
            <h4 id="share-confirm-title" className="text-sm font-semibold text-text-primary">
              {confirm.type === "revoke"
                ? "Stop this review link?"
                : "Create a new link?"}
            </h4>
            <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
              {confirm.type === "revoke"
                ? "Anyone with this link will immediately lose access. You can create a new link anytime."
                : "A new link is created and the old one stops working immediately. Any comments stay attached."}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirm(null)}
                className="flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (confirm.type === "revoke") void handleRevoke(confirm.id);
                  else void handleRegenerate(confirm.id);
                }}
                data-testid="share-confirm-action"
                className={`flex h-8 items-center rounded-lg px-3 text-xs font-medium text-white transition-colors ${
                  confirm.type === "revoke"
                    ? "bg-red-600 hover:bg-red-500"
                    : "bg-accent hover:bg-accent-hover"
                }`}
                type="button"
              >
                {confirm.type === "revoke" ? "Stop link" : "Create new link"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feedback quick entry */}
      <p className="text-center text-[11px] text-text-muted">
        Want to read what reviewers said?{" "}
        <button
          onClick={() => openShareDialog("feedback")}
          className="font-medium text-accent underline-offset-2 hover:underline"
          type="button"
        >
          Open review feedback
        </button>
      </p>
    </div>
  );
}
