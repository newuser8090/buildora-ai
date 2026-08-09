"use client";

// ---------------------------------------------------------------------------
// FeedbackSheet — anonymous viewer feedback (Phase P12)
//
// Lightweight, beginner-friendly: optional (or required, per share settings)
// display name + a bounded plain-text comment scoped to the current page.
// Submission is server-validated (active share, feedback enabled, rate
// limited). Success is confirmed in place. Comments render as React text
// nodes only — no HTML ever.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { X, Send, Check, Loader2 } from "lucide-react";
import { getShareProvider, ShareLinkService } from "../services/share-link-service";
import { shareErrorMessage } from "../errors";
import { COMMENT_BODY_MAX, COMMENT_NAME_MAX, SHARE_PERF_MARKS } from "../constants";
import { markPerf } from "@/features/perf/perf-instrumentation";
import type { PublicShareInfo } from "../types";

export interface FeedbackSheetProps {
  share: PublicShareInfo;
  /** The raw token from the URL — proves access server-side. */
  token: string;
  /** Current page id (comments are page-scoped). */
  pageId?: string;
  onClose: () => void;
}

export function FeedbackSheet({ share, token, pageId, onClose }: FeedbackSheetProps) {
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const canSubmit = body.trim().length > 0 && body.trim().length <= COMMENT_BODY_MAX && (!share.requireName || name.trim().length > 0);

  // Escape closes the sheet (consistent with the app's dialogs).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleSubmit = useCallback(async () => {
    const provider = getShareProvider();
    if (!provider || submitting) return;
    setSubmitting(true);
    setError(null);
    const service = new ShareLinkService(provider);
    const result = await service.submitComment(share.shareId, token, {
      pageId,
      authorName: share.requireName ? name.trim() : name.trim() || undefined,
      body: body.trim(),
    });
    setSubmitting(false);
    if (result.ok) {
      markPerf(SHARE_PERF_MARKS.feedbackSubmitted);
      setDone(true);
    } else {
      setError(shareErrorMessage(result.error));
    }
  }, [submitting, share.shareId, share.requireName, token, pageId, name, body]);

  if (done) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-success-title"
        data-testid="feedback-sheet"
      >
        <div className="w-full max-w-md rounded-t-2xl border border-border bg-card p-6 shadow-elevated sm:rounded-2xl">
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
              <Check className="h-6 w-6 text-emerald-600" />
            </span>
            <h3 id="feedback-success-title" className="text-sm font-semibold text-text-primary">
              Thanks — your feedback was sent
            </h3>
            <p className="text-xs text-text-muted">
              The site owner can now see your comment.
            </p>
            <button
              onClick={onClose}
              data-testid="feedback-done"
              className="mt-2 flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
              type="button"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-title"
      data-testid="feedback-sheet"
    >
      <div className="w-full max-w-md rounded-t-2xl border border-border bg-card p-5 shadow-elevated sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h3 id="feedback-title" className="text-sm font-semibold text-text-primary">
            Leave feedback
          </h3>
          <button
            onClick={onClose}
            aria-label="Close feedback"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {share.requireName && (
          <label className="mt-4 block">
            <span className="text-xs font-medium text-text-primary">Your name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, COMMENT_NAME_MAX))}
              maxLength={COMMENT_NAME_MAX}
              aria-label="Your name"
              data-testid="feedback-name"
              className="mt-1.5 h-9 w-full rounded-lg border border-border bg-base px-2.5 text-xs text-text-primary focus:border-accent/40 focus:outline-none"
            />
          </label>
        )}
        {!share.requireName && (
          <label className="mt-4 block">
            <span className="text-xs font-medium text-text-primary">Your name (optional)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, COMMENT_NAME_MAX))}
              maxLength={COMMENT_NAME_MAX}
              aria-label="Your name (optional)"
              data-testid="feedback-name"
              className="mt-1.5 h-9 w-full rounded-lg border border-border bg-base px-2.5 text-xs text-text-primary focus:border-accent/40 focus:outline-none"
            />
          </label>
        )}

        <label className="mt-4 block">
          <span className="text-xs font-medium text-text-primary">
            Feedback <span className="font-normal text-text-muted">({pageId ? "about this page" : "general"})</span>
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, COMMENT_BODY_MAX))}
            maxLength={COMMENT_BODY_MAX}
            rows={4}
            aria-label="Your feedback"
            data-testid="feedback-body"
            className="mt-1.5 w-full resize-none rounded-lg border border-border bg-base px-2.5 py-2 text-xs text-text-primary focus:border-accent/40 focus:outline-none"
            placeholder="What do you think?"
          />
          <span className="mt-1 block text-right text-[10px] text-text-dim">
            {body.length}/{COMMENT_BODY_MAX}
          </span>
        </label>

        {error && (
          <p role="status" data-testid="feedback-error" className="mt-2 text-xs text-red-500">
            {error}
          </p>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="flex h-9 items-center rounded-lg border border-border px-4 text-xs font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
            type="button"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit || submitting}
            data-testid="feedback-submit"
            className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            type="button"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Send feedback
          </button>
        </div>
      </div>
    </div>
  );
}
