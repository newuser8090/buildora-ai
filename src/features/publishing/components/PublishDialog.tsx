"use client";

// ---------------------------------------------------------------------------
// PublishDialog — the beginner-facing publish flow (Phase P7)
//
// View states: publish (choose where), progress, success, failure, history.
// The publish button opens this dialog; it never deploys without context.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { Rocket, History, X, FileDown, Play } from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { usePublishingStore } from "../store/publishing-store";
import { usePublishing } from "../hooks/usePublishing";
import { getPublishingProviders } from "../providers";
import { PublishProgress } from "./PublishProgress";
import { PublishSuccess } from "./PublishSuccess";
import { PublishFailure } from "./PublishFailure";
import { DeploymentHistory } from "./DeploymentHistory";

export function PublishDialog() {
  const dialogOpen = usePublishingStore((s) => s.dialogOpen);
  const view = usePublishingStore((s) => s.view);
  const closeDialog = usePublishingStore((s) => s.closeDialog);
  const openHistory = usePublishingStore((s) => s.openHistory);
  const project = useEditorStore((s) => s.project);
  const { publish, publishStatus } = usePublishing();

  // The provider registry is static per environment (local-export always,
  // mock in dev), so the initial selection can be derived once. Prefer the
  // mock (demo) provider when available — it is the beginner-first default.
  const [selectedProvider, setSelectedProvider] = useState<string>(() => {
    const providers = getPublishingProviders();
    return providers.some((p) => p.id === "mock")
      ? "mock"
      : providers[0]?.id ?? "local-export";
  });
  const [publishing, setPublishing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!dialogOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && view !== "progress") closeDialog();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialogOpen, view, closeDialog]);

  const handlePublish = useCallback(async () => {
    if (publishing || !project.id) return;
    setPublishing(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await publish(selectedProvider, controller.signal);
    } finally {
      setPublishing(false);
      abortRef.current = null;
    }
  }, [publishing, project.id, publish, selectedProvider]);

  if (!dialogOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && view !== "progress") closeDialog();
      }}
    >
      <div className="mx-4 flex max-h-[86vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-secondary shadow-elevated">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15">
              <Rocket className="h-4 w-4 text-accent" />
            </div>
            <div>
              <h2
                id="publish-dialog-title"
                className="text-sm font-semibold text-text-primary"
              >
                {view === "history" ? "Publish history" : "Publish your site"}
              </h2>
              <p className="mt-0.5 text-xs text-text-dim">
                {view === "history"
                  ? "Every time you publish, a version is saved here."
                  : "Choose where your site should go."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {view !== "progress" && (
              <button
                onClick={openHistory}
                data-testid="publish-open-history"
                className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-text-dim transition-colors hover:bg-card hover:text-text-primary"
                type="button"
              >
                <History className="h-3.5 w-3.5" />
                History
              </button>
            )}
            <button
              onClick={closeDialog}
              disabled={view === "progress"}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary disabled:opacity-40"
              aria-label="Close publish dialog"
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {view === "progress" && <PublishProgress />}
          {view === "success" && <PublishSuccess />}
          {view === "failure" && <PublishFailure />}
          {view === "history" && <DeploymentHistory />}
          {view === "publish" && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-text-dim">
                {publishStatus === "changes-unpublished" ? (
                  <span className="font-medium text-amber-600 dark:text-amber-400">
                    You&apos;ve made changes since the last publish.
                  </span>
                ) : publishStatus === "published" ? (
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                    Your site is already live — you can still publish updates.
                  </span>
                ) : (
                  "This is your first publish."
                )}
              </p>

              {getPublishingProviders().map((provider) => (
                <label
                  key={provider.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                    selectedProvider === provider.id
                      ? "border-accent/50 bg-accent/5"
                      : "border-border/60 bg-base hover:border-border"
                  }`}
                >
                  <input
                    type="radio"
                    name="publish-provider"
                    value={provider.id}
                    checked={selectedProvider === provider.id}
                    onChange={() => setSelectedProvider(provider.id)}
                    className="mt-1 h-4 w-4 accent-[var(--accent,#7c5cfc)]"
                    data-testid={`provider-${provider.id}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-primary">
                      {provider.label}
                    </p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {provider.description}
                    </p>
                    {provider.id === "mock" && (
                      <p className="mt-1 text-[11px] font-medium text-accent">
                        For practice — your site is not placed on the public
                        internet.
                      </p>
                    )}
                    {provider.id === "local-export" && (
                      <p className="mt-1 text-[11px] text-text-dim">
                        Use these files with any hosting provider.
                      </p>
                    )}
                  </div>
                </label>
              ))}

              <button
                onClick={handlePublish}
                disabled={publishing}
                data-testid="publish-confirm"
                className="mt-1 flex h-10 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:opacity-50"
                type="button"
              >
                {publishing ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Publishing…
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    {selectedProvider === "local-export"
                      ? "Download website files"
                      : "Publish my site"}
                  </>
                )}
              </button>

              {selectedProvider === "local-export" && (
                <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-base p-3">
                  <FileDown className="mt-0.5 h-4 w-4 flex-shrink-0 text-text-dim" />
                  <p className="text-[11px] text-text-dim">
                    You&apos;ll get a ZIP file with your whole website. You can use
                    it with hosting providers like Vercel, Netlify, Cloudflare
                    Pages, or GitHub Pages — or keep it for later.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
