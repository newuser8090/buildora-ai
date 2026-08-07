"use client";

// ---------------------------------------------------------------------------
// SiteSettingsDialog — beginner-first site settings (Phase P7)
//
// Tabs: Basics · Search & sharing · Site icon · Advanced.
// Edits accumulate in a local draft and commit ONCE via the editor store's
// updateSiteSettings (one undo/history entry, autosave flows normally).
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { Globe, Search, ImageIcon, Settings2, X } from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useSiteSettingsUiStore, type SiteSettingsTab } from "../store/site-settings-ui-store";
import type { SiteSettings } from "../types";
import { GeneralSiteSettings } from "./GeneralSiteSettings";
import { SearchPreviewSettings } from "./SearchPreviewSettings";
import { SiteIconPicker } from "./SiteIconPicker";
import { AdvancedSeoSettings } from "./AdvancedSeoSettings";

const TABS: { id: SiteSettingsTab; label: string; icon: typeof Globe }[] = [
  { id: "basics", label: "Basics", icon: Globe },
  { id: "search", label: "Search & sharing", icon: Search },
  { id: "icon", label: "Site icon", icon: ImageIcon },
  { id: "advanced", label: "Advanced", icon: Settings2 },
];

export function SiteSettingsDialog() {
  const open = useSiteSettingsUiStore((s) => s.dialogOpen);

  // Unmounts the inner form while closed, so its draft state re-seeds from
  // the project on every open (no setState-in-effect needed).
  if (!open) return null;
  return <SiteSettingsDialogInner />;
}

function SiteSettingsDialogInner() {
  const initialTab = useSiteSettingsUiStore((s) => s.initialTab);
  const closeDialog = useSiteSettingsUiStore((s) => s.closeDialog);
  const project = useEditorStore((s) => s.project);
  const updateSiteSettings = useEditorStore((s) => s.updateSiteSettings);

  const [tab, setTab] = useState<SiteSettingsTab>(initialTab);
  const [draft, setDraft] = useState<SiteSettings | null>(() =>
    project.siteSettings
      ? (JSON.parse(JSON.stringify(project.siteSettings)) as SiteSettings)
      : { siteName: project.name || "" },
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDialog();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDialog]);

  if (!draft) return null;

  const patchDraft = (patch: Partial<SiteSettings>) => {
    setDraft({ ...draft, ...patch });
  };

  const handleSave = () => {
    updateSiteSettings(draft);
    closeDialog();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="site-settings-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeDialog();
      }}
    >
      <div className="mx-4 flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-secondary shadow-elevated">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2
              id="site-settings-title"
              className="text-sm font-semibold text-text-primary"
            >
              Site settings
            </h2>
            <p className="mt-0.5 text-xs text-text-dim">
              How your website appears to visitors, search engines, and social
              apps.
            </p>
          </div>
          <button
            onClick={closeDialog}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary"
            aria-label="Close site settings"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border px-5 pt-3" role="tablist">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`flex h-9 items-center gap-1.5 rounded-t-lg px-3 text-xs font-medium transition-colors ${
                tab === id
                  ? "border-b-2 border-accent text-text-primary"
                  : "text-text-dim hover:text-text-primary"
              }`}
              type="button"
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {tab === "basics" && (
            <GeneralSiteSettings draft={draft} onChange={patchDraft} />
          )}
          {tab === "search" && (
            <SearchPreviewSettings draft={draft} onChange={patchDraft} />
          )}
          {tab === "icon" && (
            <SiteIconPicker draft={draft} onChange={patchDraft} />
          )}
          {tab === "advanced" && (
            <AdvancedSeoSettings draft={draft} onChange={patchDraft} />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
          <button
            onClick={closeDialog}
            className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95"
            type="button"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            data-testid="site-settings-save"
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
