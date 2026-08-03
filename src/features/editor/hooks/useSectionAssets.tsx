// ---------------------------------------------------------------------------
// useSectionAssets — context-scoped asset source for section components
//
// Section components resolve uploaded assets against a project's asset list.
// In the live editor they read from the Zustand editor store (single source of
// truth). The read-only thumbnail preview must render from a SNAPSHOT without
// touching the live store, so it wraps sections in <SectionAssetProvider>.
//
// - No provider → falls back to the live editor store (editor behavior unchanged)
// - Provider present → uses the supplied snapshot assets (thumbnail rendering)
// ---------------------------------------------------------------------------

"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { Asset } from "@/features/assets/types";

const SectionAssetContext = createContext<Asset[] | null>(null);

export function SectionAssetProvider({
  assets,
  children,
}: {
  assets: Asset[];
  children: ReactNode;
}) {
  return (
    <SectionAssetContext.Provider value={assets}>
      {children}
    </SectionAssetContext.Provider>
  );
}

export function useSectionAssets(): Asset[] {
  // Always call BOTH hooks unconditionally to satisfy the Rules of Hooks — the
  // hook count must not vary between provider-present and provider-absent
  // renders (e.g. a section rendered in the editor and later in a thumbnail).
  const contextAssets = useContext(SectionAssetContext);
  const storeAssets = useEditorStore((state) => state.project.assets);
  return contextAssets !== null ? contextAssets : storeAssets;
}
