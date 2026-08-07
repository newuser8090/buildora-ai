// ---------------------------------------------------------------------------
// PageMetaDialog — edit per-page SEO metadata (Phase J + Phase P7)
//
// Phase P7 adds beginner-labeled fields: "Google title", "Google description",
// "Social preview" (title/description/image), "Show this page in search
// engines", and an optional canonical override (advanced).
//
// Values are stored on Page.meta via the editor store (one history entry).
// Empty fields are dropped on save. Escape closes the dialog.
//
// The inner form is keyed by page id so its local state resets whenever the
// dialog opens for a different page (no state sync in effects).
// ---------------------------------------------------------------------------

"use client";

import { useEffect, useState } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { AssetPickerDialog } from "@/features/site-settings/components/AssetPickerDialog";
import type { Page } from "@/types/project";

export interface PageMetaDialogProps {
  page: Page | null;
  onClose: () => void;
}

export function PageMetaDialog({ page, onClose }: PageMetaDialogProps) {
  if (!page) return null;
  return <PageMetaForm key={page.id} page={page} onClose={onClose} />;
}

function PageMetaForm({ page, onClose }: { page: Page; onClose: () => void }) {
  const updatePageMeta = useEditorStore((s) => s.updatePageMeta);

  const [title, setTitle] = useState(page.meta?.seoTitle ?? page.meta?.title ?? "");
  const [description, setDescription] = useState(
    page.meta?.seoDescription ?? page.meta?.description ?? "",
  );
  const [socialTitle, setSocialTitle] = useState(page.meta?.socialTitle ?? "");
  const [socialDescription, setSocialDescription] = useState(
    page.meta?.socialDescription ?? "",
  );
  const [socialImageId, setSocialImageId] = useState(
    page.meta?.socialImage?.assetId ?? "",
  );
  const [index, setIndex] = useState(page.meta?.index !== false);
  const [canonicalUrl, setCanonicalUrl] = useState(
    page.meta?.canonicalUrl ?? "",
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Escape closes the dialog
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const canonicalInvalid =
    canonicalUrl.trim().length > 0 && !/^https?:\/\//i.test(canonicalUrl.trim());

  const handleSave = () => {
    updatePageMeta(page.id, {
      title,
      description,
      seoTitle: title,
      seoDescription: description,
      socialTitle,
      socialDescription,
      socialImage: socialImageId ? { assetId: socialImageId } : undefined,
      index,
      canonicalUrl,
    });
    onClose();
  };

  const inputClass =
    "w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-dim/50 transition-colors focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/10";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="page-meta-title"
    >
      <div className="max-h-[86vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-elevated">
        <h3
          id="page-meta-title"
          className="text-lg font-semibold text-text-primary"
        >
          Page settings
        </h3>
        <p className="mt-1 text-xs text-text-dim">
          Search and sharing info for &ldquo;{page.title}&rdquo;. Used when
          exporting the site.
        </p>

        <div className="mt-5 flex flex-col gap-4">
          <div>
            <label
              htmlFor="page-meta-title-input"
              className="mb-1.5 block text-xs font-medium text-text-muted"
            >
              Google title
            </label>
            <input
              id="page-meta-title-input"
              data-testid="page-meta-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder={page.title}
              autoFocus
              className={inputClass}
            />
            <p className="mt-1 text-[11px] text-text-dim">
              The title of this page in search results. Leave blank to use the
              page name.
            </p>
          </div>

          <div>
            <label
              htmlFor="page-meta-description-input"
              className="mb-1.5 block text-xs font-medium text-text-muted"
            >
              Google description
            </label>
            <textarea
              id="page-meta-description-input"
              data-testid="page-meta-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="A short summary shown in search results."
              className={`${inputClass} resize-none`}
            />
          </div>

          <div className="rounded-lg border border-border/60 bg-base/50 p-3">
            <label className="mb-1.5 block text-xs font-medium text-text-muted">
              Show this page in search engines
            </label>
            <div className="flex items-center gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
                <input
                  type="radio"
                  name={`page-index-${page.id}`}
                  checked={index}
                  onChange={() => setIndex(true)}
                  data-testid="page-meta-index-yes"
                  className="h-4 w-4 accent-[var(--accent,#7c5cfc)]"
                />
                Yes
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
                <input
                  type="radio"
                  name={`page-index-${page.id}`}
                  checked={!index}
                  onChange={() => setIndex(false)}
                  data-testid="page-meta-index-no"
                  className="h-4 w-4 accent-[var(--accent,#7c5cfc)]"
                />
                No — keep it hidden
              </label>
            </div>
            {!index && (
              <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                This page is currently hidden from search engines.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-muted">
              Social preview
            </label>
            <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-base/50 p-3">
              <input
                data-testid="page-meta-social-title"
                value={socialTitle}
                onChange={(e) => setSocialTitle(e.target.value)}
                maxLength={200}
                placeholder="Share title (optional)"
                className={inputClass}
              />
              <textarea
                data-testid="page-meta-social-description"
                value={socialDescription}
                onChange={(e) => setSocialDescription(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder="Share description (optional)"
                className={`${inputClass} resize-none`}
              />
              <AssetPickerDialog
                assetId={socialImageId || undefined}
                title="Choose a share image"
                onSelect={(id) => setSocialImageId(id)}
                onClear={() => setSocialImageId("")}
              />
            </div>
          </div>

          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-left text-[11px] font-medium text-text-dim underline hover:no-underline"
            type="button"
            aria-expanded={showAdvanced}
          >
            {showAdvanced ? "Hide" : "Show"} advanced settings
          </button>

          {showAdvanced && (
            <div className="flex flex-col gap-4 rounded-lg border border-border/60 bg-base/50 p-3">
              <div>
                <label
                  htmlFor="page-meta-canonical"
                  className="mb-1.5 block text-xs font-medium text-text-muted"
                >
                  Main address of this page
                </label>
                <input
                  id="page-meta-canonical"
                  data-testid="page-meta-canonical"
                  value={canonicalUrl}
                  onChange={(e) => setCanonicalUrl(e.target.value)}
                  maxLength={500}
                  placeholder="https://www.yoursite.com/this-page"
                  className={`${inputClass} ${
                    canonicalInvalid ? "!border-red-500/50" : ""
                  }`}
                />
                {canonicalInvalid && (
                  <p className="mt-1 text-[11px] text-red-400">
                    That address needs to start with https:// or http://
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            data-testid="page-meta-cancel"
            className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95"
            type="button"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            data-testid="page-meta-save"
            className="flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95"
            type="button"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
