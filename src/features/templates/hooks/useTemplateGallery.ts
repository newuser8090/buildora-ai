// ---------------------------------------------------------------------------
// useTemplateGallery — gallery state: registration, search, category, sorting
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useState } from "react";
import { templateRegistry } from "../registry/template-registry";
import { registerDefaultTemplates } from "../registry/register-default-templates";
import { filterTemplates, templateCategories } from "../utils/filter-templates";
import { sortTemplates, featuredTemplates } from "../utils/sort-templates";
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

  // list() returns a fresh array and is cheap; inline reads avoid stale
  // memoization against the mutable registry singleton.
  const allTemplates = templateRegistry.list();
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
