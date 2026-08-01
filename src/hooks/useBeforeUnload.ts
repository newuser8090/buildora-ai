// ---------------------------------------------------------------------------
// useBeforeUnload — warn users before leaving the page with unsaved changes
// ---------------------------------------------------------------------------

"use client";

import { useEffect } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";

/**
 * Registers a beforeunload handler when the editor has unsaved changes.
 * This only handles browser-level navigation (refresh, close, external link).
 * Application-controlled navigation is handled by TopNav/EditorProvider.
 */
export function useBeforeUnload() {
  const isDirty = useEditorStore((s) => s.isDirty);
  const isHydrated = useEditorStore((s) => s.isHydrated);

  useEffect(() => {
    if (!isHydrated || !isDirty) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      // Modern browsers show a generic confirmation dialog regardless of
      // the returnValue string. The string is for legacy browser support.
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty, isHydrated]);
}
