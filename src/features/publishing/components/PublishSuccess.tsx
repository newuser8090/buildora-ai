"use client";

// ---------------------------------------------------------------------------
// PublishSuccess — post-publish experience (Phase P7)
//
// "Your site is live" (or "Demo site is ready" for the mock provider — never
// falsely claims public internet availability). Actions: open site, copy
// link, preview, publish updates, view history.
// ---------------------------------------------------------------------------

import { useCallback, useState } from "react";
import { CheckCircle2, ExternalLink, Copy, Eye, RefreshCw, History } from "lucide-react";
import { usePublishingStore } from "../store/publishing-store";
import { usePublishing } from "../hooks/usePublishing";
import { usePreviewStore } from "@/features/preview/store/preview-store";

export function PublishSuccess() {
  const result = usePublishingStore((s) => s.lastResult);
  const openHistory = usePublishingStore((s) => s.openHistory);
  const { publish } = usePublishing();
  const openPreview = usePreviewStore((s) => s.openPreview);

  const [copied, setCopied] = useState(false);
  const [republishing, setRepublishing] = useState(false);

  const url = result?.ok ? result.deployment.url : undefined;
  const isMock = result?.ok ? result.deployment.providerId === "mock" : false;

  const copyLink = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable — ignore.
    }
  }, [url]);

  const republish = useCallback(async () => {
    if (republishing) return;
    setRepublishing(true);
    try {
      await publish(result?.ok ? result.deployment.providerId : "mock");
    } finally {
      setRepublishing(false);
    }
  }, [publish, result, republishing]);

  return (
    <div
      className="flex flex-col items-center gap-4 py-2 text-center"
      data-testid="publish-success"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15">
        <CheckCircle2 className="h-7 w-7 text-emerald-500" />
      </div>
      <div>
        <h3 className="text-lg font-semibold text-text-primary">
          {isMock ? "Demo site is ready." : "Your site is live."}
        </h3>
        <p className="mx-auto mt-1 max-w-xs text-xs text-text-dim">
          {isMock
            ? "This is a practice publish — your site is not on the public internet. Open it to see how it works."
            : "Your website files are ready. Open the site or copy the link to share it."}
        </p>
      </div>

      {url && (
        <div className="flex w-full items-center gap-2 rounded-lg border border-border/60 bg-base px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-left text-xs text-text-muted">
            {url}
          </span>
          <button
            onClick={copyLink}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
            type="button"
            data-testid="publish-copy-link"
          >
            {copied ? (
              <span className="text-emerald-500">Copied!</span>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy
              </>
            )}
          </button>
        </div>
      )}

      <div className="grid w-full grid-cols-2 gap-2">
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="publish-open-site"
            className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-white transition-all hover:bg-accent-hover"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open site
          </a>
        )}
        <button
          onClick={() => openPreview("/")}
          className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
          type="button"
        >
          <Eye className="h-3.5 w-3.5" />
          Preview
        </button>
        <button
          onClick={republish}
          disabled={republishing}
          className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary disabled:opacity-50"
          type="button"
          data-testid="publish-updates"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${republishing ? "animate-spin" : ""}`} />
          Publish updates
        </button>
        <button
          onClick={openHistory}
          className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
          type="button"
        >
          <History className="h-3.5 w-3.5" />
          History
        </button>
      </div>

      <div className="mt-1 w-full rounded-lg border border-border/60 bg-base p-3 text-left">
        <p className="text-[11px] font-semibold text-text-primary">
          After you publish
        </p>
        <ul className="mt-1.5 flex flex-col gap-1 text-[11px] text-text-dim">
          <li>• Open the live site and test the navigation</li>
          <li>• Try it on your phone</li>
          <li>• Share the link</li>
          <li>• Check your contact links and forms</li>
          <li>• Publish again after any changes</li>
        </ul>
      </div>
    </div>
  );
}
