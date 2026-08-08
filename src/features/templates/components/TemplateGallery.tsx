// ---------------------------------------------------------------------------
// TemplateGallery — browse, filter, and search starter templates
//
// Local filtering only (no persistence request per keystroke), deterministic
// sorting, a featured strip, an always-visible Blank option, and a no-results
// state. Cards are keyboard accessible and responsive.
// ---------------------------------------------------------------------------

"use client";

import { useMemo } from "react";
import type { BuildoraTemplate, TemplateCategory } from "../types";
import { TEMPLATE_CATEGORY_LABELS } from "../types";
import { useTemplateGallery } from "../hooks/useTemplateGallery";
import { TemplateCard } from "./TemplateCard";
import { cn } from "@/utils/cn";

export interface TemplateGalleryProps {
  selectedTemplateId?: string | null;
  onPreview: (template: BuildoraTemplate) => void;
  /** Selection action (wired to each card's Use action). */
  onUse: (template: BuildoraTemplate) => void;
  /** Expose the Use action on each card (defaults to true). */
  showUse?: boolean;
}

const CATEGORY_TABS: (TemplateCategory | "all")[] = [
  "all",
  "blank",
  "business",
  "portfolio",
  "commerce",
  "food",
  "landing-page",
  "event",
  "personal",
];

export function TemplateGallery({
  selectedTemplateId,
  onPreview,
  onUse,
  showUse = true,
}: TemplateGalleryProps) {
  const { templates, featured, categories, search, category, setSearch, setCategory } =
    useTemplateGallery();

  const availableCategories = useMemo(() => new Set(categories), [categories]);

  const tabs = CATEGORY_TABS.filter(
    (tab) => tab === "all" || tab === "blank" || availableCategories.has(tab),
  );

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Title */}
      <div>
        <h2 className="text-base font-semibold text-text-primary">Start a new project</h2>
        <p className="mt-0.5 text-xs text-text-muted">
          Pick a template to get a head start, or begin with a blank page.
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-dim">
          <SearchGlyph />
        </span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates..."
          aria-label="Search templates"
          className="h-9 w-full rounded-lg border border-border bg-base pl-9 pr-3 text-sm text-text-primary placeholder:text-text-dim/50 transition-all duration-200 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20"
        />
      </div>

      {/* Category tabs */}
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label="Filter templates by category"
      >
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setCategory(tab)}
            aria-pressed={category === tab}
            className={cn(
              "h-7 rounded-full border px-3 text-xs font-medium transition-all duration-200 focus-visible:outline-none",
              category === tab
                ? "border-accent bg-accent text-white"
                : "border-border bg-card text-text-muted hover:border-accent/40 hover:text-text-primary",
            )}
          >
            {tab === "all" ? "All" : TEMPLATE_CATEGORY_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Results */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {search.trim() === "" && category === "all" && featured.length > 0 && (
          <div className="mb-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-dim">
              Featured
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {featured.slice(0, 4).map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  selected={template.id === selectedTemplateId}
                  onPreview={onPreview}
                  onUse={onUse}
                  showUse={showUse}
                />
              ))}
            </div>
          </div>
        )}

        <div>
          {featured.length === 0 ||
          search.trim() !== "" ||
          category !== "all" ? (
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-dim">
              {category === "all" ? "All templates" : TEMPLATE_CATEGORY_LABELS[category]}
            </h3>
          ) : null}
          {templates.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {templates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  selected={template.id === selectedTemplateId}
                  onPreview={onPreview}
                  onUse={onUse}
                  showUse={showUse}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border py-10 text-center">
              <p className="text-sm font-medium text-text-primary">No templates found</p>
              <p className="mt-1 text-xs text-text-muted">
                Try a different search or category.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SearchGlyph() {
  return (
    <svg
      className="h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z"
      />
    </svg>
  );
}
