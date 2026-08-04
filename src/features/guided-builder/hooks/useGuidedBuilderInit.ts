// ---------------------------------------------------------------------------
// useGuidedBuilderInit — syncs the guided store from persisted prefs after
// mount. Prevents SSR hydration mismatches (mode-dependent UI stays on the
// safe standard rendering until the browser prefs are loaded).
// ---------------------------------------------------------------------------

"use client";

import { useEffect } from "react";
import { useGuidedBuilderStore } from "../store/guided-builder-store";

export function useGuidedBuilderInit(): void {
  useEffect(() => {
    useGuidedBuilderStore.getState().init();
  }, []);
}
