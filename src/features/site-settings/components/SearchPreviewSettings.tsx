"use client";

// ---------------------------------------------------------------------------
// SearchPreviewSettings — Search & sharing tab
//
// Beginner labels: "Google title", "Google description", "Social preview".
// Live previews are derived purely from the draft + project assets.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { SiteSettings } from "../types";
import { deriveGooglePreview, deriveSocialPreview } from "../engine/seo-preview";
import { GoogleResultCard, SocialShareCard } from "./SeoPreviewCards";
import { AssetPickerDialog } from "./AssetPickerDialog";

export interface SearchPreviewSettingsProps {
  draft: SiteSettings;
  onChange: (patch: Partial<SiteSettings>) => void;
}

export function SearchPreviewSettings({
  draft,
  onChange,
}: SearchPreviewSettingsProps) {
  const project = useEditorStore((s) => s.project);

  const googlePreview = useMemo(
    () => deriveGooglePreview(draft, project.name, `${draft.siteName || project.name || "mysite"}.example`),
    [draft, project.name],
  );
  const socialPreview = useMemo(
    () => deriveSocialPreview(draft, project.name, project.assets),
    [draft, project.name, project.assets],
  );

  const patchSeo = (patch: Partial<NonNullable<SiteSettings["seo"]>>) => {
    onChange({ seo: { ...(draft.seo ?? {}), ...patch } });
  };
  const patchSocial = (
    patch: Partial<NonNullable<SiteSettings["social"]>>,
  ) => {
    onChange({ social: { ...(draft.social ?? {}), ...patch } });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-5 lg:flex-row">
        {/* Search */}
        <div className="flex-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-dim">
            Search results
          </h3>
          <div className="mt-3 flex flex-col gap-4">
            <div>
              <label
                htmlFor="site-settings-seo-title"
                className="mb-1.5 block text-xs font-medium text-text-muted"
              >
                Google title
              </label>
              <input
                id="site-settings-seo-title"
                data-testid="site-settings-seo-title"
                value={draft.seo?.title ?? ""}
                onChange={(e) => patchSeo({ title: e.target.value })}
                maxLength={200}
                placeholder={draft.siteName || "Your site name"}
                className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-dim/50 transition-colors focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/10"
              />
            </div>
            <div>
              <label
                htmlFor="site-settings-seo-description"
                className="mb-1.5 block text-xs font-medium text-text-muted"
              >
                Google description
              </label>
              <textarea
                id="site-settings-seo-description"
                data-testid="site-settings-seo-description"
                value={draft.seo?.description ?? ""}
                onChange={(e) => patchSeo({ description: e.target.value })}
                maxLength={500}
                rows={3}
                placeholder="What would you like people to see in search results?"
                className="w-full resize-none rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-dim/50 transition-colors focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/10"
              />
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="flex w-full flex-col gap-3 lg:w-72">
          <GoogleResultCard preview={googlePreview} />
        </div>
      </div>

      <div className="h-px bg-border" />

      <div className="flex flex-col gap-5 lg:flex-row">
        {/* Social */}
        <div className="flex-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-dim">
            Social preview
          </h3>
          <p className="mt-1 text-[11px] text-text-dim">
            How your site looks when shared on social apps. Leave blank to use
            your search title and description.
          </p>
          <div className="mt-3 flex flex-col gap-4">
            <div>
              <label
                htmlFor="site-settings-social-title"
                className="mb-1.5 block text-xs font-medium text-text-muted"
              >
                Share title
              </label>
              <input
                id="site-settings-social-title"
                data-testid="site-settings-social-title"
                value={draft.social?.title ?? ""}
                onChange={(e) => patchSocial({ title: e.target.value })}
                maxLength={200}
                placeholder="Optional"
                className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-dim/50 transition-colors focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/10"
              />
            </div>
            <div>
              <label
                htmlFor="site-settings-social-description"
                className="mb-1.5 block text-xs font-medium text-text-muted"
              >
                Share description
              </label>
              <textarea
                id="site-settings-social-description"
                data-testid="site-settings-social-description"
                value={draft.social?.description ?? ""}
                onChange={(e) => patchSocial({ description: e.target.value })}
                maxLength={500}
                rows={2}
                placeholder="Optional"
                className="w-full resize-none rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-dim/50 transition-colors focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/10"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-text-muted">
                Share image
              </label>
              <AssetPickerDialog
                assetId={draft.social?.image?.assetId}
                title="Choose a share image"
                onSelect={(assetId) => patchSocial({ image: { assetId } })}
                onClear={() => patchSocial({ image: undefined })}
              />
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="flex w-full flex-col gap-3 lg:w-72">
          <SocialShareCard preview={socialPreview} />
        </div>
      </div>
    </div>
  );
}
