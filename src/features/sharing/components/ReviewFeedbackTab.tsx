"use client";

// ---------------------------------------------------------------------------
// ReviewFeedbackTab — owner review feedback panel (Phase P12)
//
// One canonical review surface. Comments are grouped by page; each comment
// shows author (if supplied), date, plain-text body, and owner actions:
// resolve / reopen, delete (with confirmation), and jump to the page/section
// when it still exists. Comments on deleted sections show an honest
// "This section no longer exists." state — never silently re-attached.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Check, RotateCcw, Trash2, ArrowUpRight, MessageSquareText } from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { getShareProvider, ShareLinkService } from "../services/share-link-service";
import { shareErrorMessage } from "../errors";
import { useShareUiStore } from "../store/share-ui-store";
import type { ReviewComment } from "../types";
import { formatDate } from "../utils/share-format";

interface CommentWithShare extends ReviewComment {
  shareId: string;
}

export function ReviewFeedbackTab() {
  const project = useEditorStore((s) => s.project);
  const selectPage = useEditorStore((s) => s.selectPage);
  const selectSection = useEditorStore((s) => s.selectSection);
  const refreshTick = useShareUiStore((s) => s.refreshTick);
  const closeShareDialog = useShareUiStore((s) => s.closeShareDialog);

  const [comments, setComments] = useState<CommentWithShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Escape cancels the delete confirmation (consistent with app dialogs).
  useEffect(() => {
    if (!deleteTarget) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDeleteTarget(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteTarget]);

  const load = useCallback(async () => {
    const provider = getShareProvider();
    if (!provider) return;
    const service = new ShareLinkService(provider);
    setLoading(true);
    // NOTE: load() must NOT clear a pre-existing error here (same reason as
    // ReviewLinksTab — an action error must survive the mount load).
    const linksResult = await service.list(project.id);
    if (!linksResult.ok) {
      setError(shareErrorMessage(linksResult.error));
      setLoading(false);
      return;
    }
    const shareIds = linksResult.value.map((l) => l.id);
    const all: CommentWithShare[] = [];
    for (const shareId of shareIds) {
      const commentsResult = await service.listComments(shareId);
      if (commentsResult.ok) {
        for (const c of commentsResult.value) {
          all.push({ ...c, shareId });
        }
      }
    }
    all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    setComments(all);
    setLoading(false);
  }, [project.id]);

  useEffect(() => {
    // requestAnimationFrame defers the state updates past the effect (the
    // codebase set-state-in-effect convention).
    const raf = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(raf);
  }, [load, refreshTick]);

  const pageTitle = useCallback(
    (pageId: string | undefined): string | null => {
      if (!pageId) return null;
      return project.pages.find((p) => p.id === pageId)?.title ?? null;
    },
    [project.pages],
  );

  const sectionExists = useCallback(
    (pageId: string | undefined, sectionId: string | undefined): boolean => {
      if (!sectionId) return true; // page-level comment
      return project.pages
        .flatMap((p) => p.sections)
        .some((s) => s.id === sectionId);
    },
    [project.pages],
  );

  const grouped = useMemo(() => {
    const groups = new Map<string, CommentWithShare[]>();
    for (const c of comments) {
      const key = pageTitle(c.pageId) ?? "General";
      const list = groups.get(key) ?? [];
      list.push(c);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [comments, pageTitle]);

  const handleResolve = useCallback(async (comment: CommentWithShare, resolved: boolean) => {
    const provider = getShareProvider();
    if (!provider) return;
    setBusy(comment.id);
    setError(null);
    const service = new ShareLinkService(provider);
    const result = await service.setCommentResolved(comment.shareId, comment.id, resolved);
    if (result.ok) {
      setComments((prev) =>
        prev.map((c) =>
          c.id === comment.id
            ? { ...c, resolvedAt: resolved ? new Date().toISOString() : null }
            : c,
        ),
      );
    } else {
      setError(shareErrorMessage(result.error));
    }
    setBusy(null);
  }, []);

  const handleDelete = useCallback(async (comment: CommentWithShare) => {
    const provider = getShareProvider();
    if (!provider) return;
    setBusy(comment.id);
    setError(null);
    const service = new ShareLinkService(provider);
    const result = await service.deleteComment(comment.shareId, comment.id);
    if (result.ok) {
      setComments((prev) => prev.filter((c) => c.id !== comment.id));
    } else {
      setError(shareErrorMessage(result.error));
    }
    setBusy(null);
    setDeleteTarget(null);
  }, []);

  const handleJump = useCallback(
    (comment: CommentWithShare) => {
      const page = project.pages.find((p) => p.id === comment.pageId);
      if (!page) return; // page gone — nothing to jump to
      selectPage(page.id);
      if (comment.sectionId && sectionExists(comment.pageId, comment.sectionId)) {
        selectSection(comment.sectionId);
      }
      closeShareDialog();
    },
    [project.pages, selectPage, selectSection, sectionExists, closeShareDialog],
  );

  const unresolved = comments.filter((c) => !c.resolvedAt).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted" data-testid="review-feedback-summary">
          {comments.length === 0
            ? "No feedback yet."
            : `${comments.length} ${comments.length === 1 ? "comment" : "comments"} · ${unresolved} open`}
        </p>
      </div>

      {error && (
        <div
          role="status"
          data-testid="share-error"
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading feedback…
        </div>
      ) : grouped.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <MessageSquareText className="h-7 w-7 text-text-dim" />
          <p className="max-w-xs text-xs text-text-muted">
            Feedback from reviewers appears here. Make sure &quot;Allow feedback&quot; is on when you
            create a review link.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([title, list]) => (
            <section key={title} aria-label={`Feedback for ${title}`}>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-text-dim">
                {title}
              </h4>
              <ul className="mt-2 space-y-3">
                {list.map((comment) => {
                  const missingSection =
                    comment.sectionId && !sectionExists(comment.pageId, comment.sectionId);
                  const missingPage = comment.pageId
                    ? pageTitle(comment.pageId) === null
                    : false;
                  return (
                    <li
                      key={comment.id}
                      data-testid="review-comment"
                      className={`rounded-xl border p-3.5 ${
                        comment.resolvedAt
                          ? "border-border/60 bg-base opacity-70"
                          : "border-border bg-base"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-xs font-medium text-text-primary">
                          {comment.authorName || "Anonymous"}
                        </span>
                        <span className="text-[11px] text-text-muted">{formatDate(comment.createdAt)}</span>
                        {comment.resolvedAt && (
                          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                            Resolved
                          </span>
                        )}
                        {missingSection && (
                          <span className="rounded-full bg-yellow-500/10 px-2 py-0.5 text-[10px] font-medium text-yellow-600">
                            This section no longer exists
                          </span>
                        )}
                        {missingPage && (
                          <span className="rounded-full bg-yellow-500/10 px-2 py-0.5 text-[10px] font-medium text-yellow-600">
                            This page no longer exists
                          </span>
                        )}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-text-primary">
                        {comment.body}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {comment.pageId && pageTitle(comment.pageId) !== null && (
                          <button
                            onClick={() => handleJump(comment)}
                            className="flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-[11px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
                            type="button"
                          >
                            <ArrowUpRight className="h-3 w-3" />
                            {/* Page-level comment → jump to the page. Section
                                comment → jump to the section when it exists,
                                otherwise the page (with the honest
                                deleted-section badge above). */}
                            Jump to {comment.sectionId && !missingSection ? "section" : "page"}
                          </button>
                        )}
                        {comment.resolvedAt ? (
                          <button
                            onClick={() => void handleResolve(comment, false)}
                            disabled={busy === comment.id}
                            data-testid={`comment-reopen-${comment.id}`}
                            className="flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-[11px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary disabled:opacity-50"
                            type="button"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Reopen
                          </button>
                        ) : (
                          <button
                            onClick={() => void handleResolve(comment, true)}
                            disabled={busy === comment.id}
                            data-testid={`comment-resolve-${comment.id}`}
                            className="flex h-7 items-center gap-1 rounded-lg border border-emerald-500/40 px-2 text-[11px] font-medium text-emerald-600 transition-colors hover:bg-emerald-500/10 disabled:opacity-50"
                            type="button"
                          >
                            <Check className="h-3 w-3" />
                            Resolve
                          </button>
                        )}
                        <button
                          onClick={() => setDeleteTarget(comment.id)}
                          disabled={busy === comment.id}
                          data-testid={`comment-delete-${comment.id}`}
                          className="flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-[11px] font-medium text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                          type="button"
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="share-delete-comment-title"
          data-testid="share-delete-comment-dialog"
        >
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-elevated">
            <h4 id="share-delete-comment-title" className="text-sm font-semibold text-text-primary">
              Delete this comment?
            </h4>
            <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
              This removes the feedback. The reviewer isn&apos;t notified.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const target = comments.find((c) => c.id === deleteTarget);
                  if (target) void handleDelete(target);
                }}
                data-testid="share-delete-comment-confirm"
                className="flex h-8 items-center rounded-lg bg-red-600 px-3 text-xs font-medium text-white transition-colors hover:bg-red-500"
                type="button"
              >
                Delete comment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
