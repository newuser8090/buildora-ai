// ---------------------------------------------------------------------------
// useTemplateGallery — gallery state: registration, search, category, sorting
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useEffect, useState } from "react";
import { templateRegistry } from "../registry/template-registry";
import { registerDefaultTemplates } from "../registry/register-default-templates";
import { filterTemplates, templateCategories } from "../utils/filter-templates";
import { sortTemplates, featuredTemplates } from "../utils/sort-templates";
import { getPersonalTemplateService } from "@/features/personal-templates/services/personal-template-service";
import { personalTemplateToBuildoraTemplate } from "@/features/personal-templates/convert/personal-template-converter";
import { markPerf } from "@/features/perf/perf-instrumentation";
import type { BuildoraTemplate, TemplateCategory } from "../types";

export interface TemplateGalleryState {
  templates: BuildoraTemplate[];
  featured: BuildoraTemplate[];
  categories: TemplateCategory[];
  search: string;
  category: TemplateCategory | "all";
  setSearch: (query: string) => void;
  setCategory: (category: TemplateCategory | "all") => void;
}

export function useTemplateGallery(): TemplateGalleryState {
  // Idempotent + Strict-Mode safe. Called during render (rather than in an
  // effect) so the built-in template set is guaranteed to exist when
  // templateRegistry.list() is read on the first render — even on a fresh
  // dashboard where nothing registered defaults yet.
  registerDefaultTemplates();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<TemplateCategory | "all">("all");

  // Phase P9: saved personal templates are merged into the same gallery so
  // search, category tabs, preview, and "Use" behave identically to built-ins.
  // Loaded asynchronously (local IndexedDB) — the list upgrades in place.
  const [personalTemplates, setPersonalTemplates] = useState<BuildoraTemplate[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await getPersonalTemplateService().listTemplates();
        if (!cancelled && result.ok) {
          setPersonalTemplates(
            result.templates.map(personalTemplateToBuildoraTemplate),
          );
        }
      } catch {
        // Gallery must never break because personal templates failed to load.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Phase P9 — transient gallery-load measurement (count is deterministic).
  // Recorded once per personal-template load (not per keystroke) via effect.
  const allTemplates = [...templateRegistry.list(), ...personalTemplates];
  useEffect(() => {
    try {
      markPerf("template-gallery-load", { count: allTemplates.length });
    } catch {
      // Instrumentation is best-effort.
    }
  }, [allTemplates.length]);
  const categories = templateCategories(allTemplates);

  const filtered = sortTemplates(
    filterTemplates(filterTemplates(allTemplates, { category }), { search }),
  );

  const featured = featuredTemplates(allTemplates);

  const handleSetSearch = useCallback((query: string) => {
    setSearch(query);
  }, []);

  const handleSetCategory = useCallback((next: TemplateCategory | "all") => {
    setCategory(next);
  }, []);

  return {
    templates: filtered,
    featured,
    categories,
    search,
    category,
    setSearch: handleSetSearch,
    setCategory: handleSetCategory,
  };
}
