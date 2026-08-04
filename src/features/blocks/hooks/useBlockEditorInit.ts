"use client";

import { useEffect } from "react";
import { useBlockEditorStore } from "../store/block-editor-store";

/** Load block builder prefs (favorites) once after mount. */
export function useBlockEditorInit(): void {
  const init = useBlockEditorStore((s) => s.init);
  const hydrated = useBlockEditorStore((s) => s.hydrated);

  useEffect(() => {
    if (!hydrated) init();
  }, [hydrated, init]);
}
