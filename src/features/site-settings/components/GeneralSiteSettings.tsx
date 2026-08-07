"use client";

// ---------------------------------------------------------------------------
// GeneralSiteSettings — Basics tab: site name, description, language
// ---------------------------------------------------------------------------

import type { SiteSettings } from "../types";

export interface GeneralSiteSettingsProps {
  draft: SiteSettings;
  onChange: (patch: Partial<SiteSettings>) => void;
}

export function GeneralSiteSettings({
  draft,
  onChange,
}: GeneralSiteSettingsProps) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <label
          htmlFor="site-settings-name"
          className="mb-1.5 block text-xs font-medium text-text-muted"
        >
          Site name
        </label>
        <input
          id="site-settings-name"
          data-testid="site-settings-name"
          value={draft.siteName ?? ""}
          onChange={(e) => onChange({ siteName: e.target.value })}
          maxLength={120}
          placeholder="e.g. Acme Bakery"
          className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-dim/50 transition-colors focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/10"
        />
        <p className="mt-1 text-[11px] text-text-dim">
          Shown in the browser tab and on your site.
        </p>
      </div>

      <div>
        <label
          htmlFor="site-settings-description"
          className="mb-1.5 block text-xs font-medium text-text-muted"
        >
          What is your site about?
        </label>
        <textarea
          id="site-settings-description"
          data-testid="site-settings-description"
          value={draft.siteDescription ?? ""}
          onChange={(e) => onChange({ siteDescription: e.target.value })}
          maxLength={500}
          rows={3}
          placeholder="A short sentence describing your website."
          className="w-full resize-none rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-dim/50 transition-colors focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/10"
        />
        <p className="mt-1 text-[11px] text-text-dim">
          Used as a fallback description until you write a search one.
        </p>
      </div>

      <div>
        <label
          htmlFor="site-settings-language"
          className="mb-1.5 block text-xs font-medium text-text-muted"
        >
          Language
        </label>
        <select
          id="site-settings-language"
          data-testid="site-settings-language"
          value={draft.language ?? "en"}
          onChange={(e) => onChange({ language: e.target.value })}
          className="h-9 w-full rounded-lg border border-border bg-base px-3 text-sm text-text-primary transition-colors focus:border-accent/40 focus:outline-none"
        >
          <option value="en">English</option>
          <option value="fr">French</option>
          <option value="de">German</option>
          <option value="es">Spanish</option>
          <option value="it">Italian</option>
          <option value="pt">Portuguese</option>
          <option value="nl">Dutch</option>
          <option value="ja">Japanese</option>
          <option value="zh">Chinese</option>
        </select>
      </div>
    </div>
  );
}
