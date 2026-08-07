"use client";

// ---------------------------------------------------------------------------
// AdvancedSeoSettings — Advanced tab
//
// Beginner language first; the technical field names are never shown as-is.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { SiteSettings } from "../types";
import { resolveAsset } from "@/features/assets/services/asset-resolver";

export interface AdvancedSeoSettingsProps {
  draft: SiteSettings;
  onChange: (patch: Partial<SiteSettings>) => void;
}

export function AdvancedSeoSettings({
  draft,
  onChange,
}: AdvancedSeoSettingsProps) {
  const project = useEditorStore((s) => s.project);

  const patchSeo = (patch: Partial<NonNullable<SiteSettings["seo"]>>) => {
    onChange({ seo: { ...(draft.seo ?? {}), ...patch } });
  };
  const patchAppearance = (
    patch: Partial<NonNullable<SiteSettings["appearance"]>>,
  ) => {
    onChange({ appearance: { ...(draft.appearance ?? {}), ...patch } });
  };

  // Resolve the social image data URL for the "visible fallback" hint.
  const socialImageSrc = useMemo(() => {
    const ref = draft.social?.image;
    return ref ? resolveAsset(ref, project.assets).src : undefined;
  }, [draft.social?.image, project.assets]);

  const canonicalInvalid =
    draft.seo?.canonicalUrl && !/^https?:\/\//i.test(draft.seo.canonicalUrl);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <label
          htmlFor="site-settings-canonical"
          className="mb-1.5 block text-xs font-medium text-text-muted"
        >
          Main page address
        </label>
        <input
          id="site-settings-canonical"
          data-testid="site-settings-canonical"
          value={draft.seo?.canonicalUrl ?? ""}
          onChange={(e) => patchSeo({ canonicalUrl: e.target.value })}
          maxLength={500}
          placeholder="https://www.yoursite.com"
          className={`w-full rounded-lg border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-dim/50 transition-colors focus:outline-none focus:ring-2 focus:ring-accent/10 ${
            canonicalInvalid ? "border-red-500/50" : "border-border focus:border-accent/40"
          }`}
        />
        <p className="mt-1 text-[11px] text-text-dim">
          Tell search engines which address is the main version of your site.
          Leave blank to let us decide.
        </p>
        {canonicalInvalid && (
          <p className="mt-1 text-[11px] text-red-400">
            That address needs to start with https:// or http://
          </p>
        )}
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-text-muted">
          Show this site in search engines
        </label>
        <div className="flex items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
            <input
              type="radio"
              name="robots-index"
              checked={draft.seo?.robotsIndex !== false}
              onChange={() => patchSeo({ robotsIndex: true })}
              data-testid="site-settings-index-yes"
              className="h-4 w-4 accent-[var(--accent,#7c5cfc)]"
            />
            Yes
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
            <input
              type="radio"
              name="robots-index"
              checked={draft.seo?.robotsIndex === false}
              onChange={() => patchSeo({ robotsIndex: false })}
              data-testid="site-settings-index-no"
              className="h-4 w-4 accent-[var(--accent,#7c5cfc)]"
            />
            No — keep it hidden
          </label>
        </div>
        {draft.seo?.robotsIndex === false && (
          <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
            Your site is currently hidden from search engines.
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="site-settings-theme-color"
          className="mb-1.5 block text-xs font-medium text-text-muted"
        >
          Browser tab color
        </label>
        <div className="flex items-center gap-2">
          <input
            id="site-settings-theme-color"
            type="color"
            value={
              draft.appearance?.themeColor || "#ffffff"
            }
            onChange={(e) => patchAppearance({ themeColor: e.target.value })}
            className="h-9 w-12 cursor-pointer rounded-lg border border-border bg-base"
            data-testid="site-settings-theme-color"
          />
          <span className="text-xs text-text-dim">
            Shown in some mobile browsers around the page.
          </span>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-text-muted">
          Keywords
        </label>
        <input
          value={(draft.seo?.keywords ?? []).join(", ")}
          onChange={(e) =>
            patchSeo({
              keywords: e.target.value
                .split(",")
                .map((k) => k.trim())
                .filter(Boolean)
                .slice(0, 30),
            })
          }
          maxLength={500}
          placeholder="optional, comma separated"
          className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-dim/50 transition-colors focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/10"
        />
        <p className="mt-1 text-[11px] text-text-dim">
          Search engines mostly ignore keywords these days — this is optional.
        </p>
      </div>

      {socialImageSrc && (
        <p className="text-[11px] text-text-dim/70">
          Share image: loaded from your project images (no separate upload
          needed).
        </p>
      )}
    </div>
  );
}
