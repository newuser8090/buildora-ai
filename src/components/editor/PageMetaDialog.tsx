// ---------------------------------------------------------------------------
// PageMetaDialog — edit per-page SEO metadata (title + description)
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

  const [title, setTitle] = useState(page.meta?.title ?? "");
  const [description, setDescription] = useState(page.meta?.description ?? "");

  // Escape closes the dialog
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleSave = () => {
    updatePageMeta(page.id, { title, description });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="page-meta-title"
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-elevated">
        <h3
          id="page-meta-title"
          className="text-lg font-semibold text-text-primary"
        >
          Page settings
        </h3>
        <p className="mt-1 text-xs text-text-dim">
          SEO metadata for &ldquo;{page.title}&rdquo;. Used when exporting the
          site.
        </p>

        <div className="mt-5 flex flex-col gap-4">
          <div>
            <label
              htmlFor="page-meta-title-input"
              className="mb-1.5 block text-xs font-medium text-text-muted"
            >
              Meta title
            </label>
            <input
              id="page-meta-title-input"
              data-testid="page-meta-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder={page.title}
              autoFocus
              className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-dim/50 transition-colors focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/10"
            />
          </div>

          <div>
            <label
              htmlFor="page-meta-description-input"
              className="mb-1.5 block text-xs font-medium text-text-muted"
            >
              Meta description
            </label>
            <textarea
              id="page-meta-description-input"
              data-testid="page-meta-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="A short summary shown in search results."
              className="w-full resize-none rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-dim/50 transition-colors focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/10"
            />
          </div>
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
