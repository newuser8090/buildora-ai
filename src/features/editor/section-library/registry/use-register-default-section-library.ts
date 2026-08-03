"use client";

import { useEffect } from "react";
import { registerDefaultSectionLibrary } from "./register-default-section-library";

/**
 * Client hook that registers the default section library exactly once.
 * Must be rendered once inside a client boundary (EditorProvider), BEFORE
 * any UI reads the registry — this avoids the dialog rendering an empty
 * library on first open.
 */
export function useRegisterDefaultSectionLibrary() {
  useEffect(() => {
    registerDefaultSectionLibrary();
  }, []);
}
