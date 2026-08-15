"use client";

// ---------------------------------------------------------------------------
// useCommittedDraft (Phase P22-C) — transient local input state
//
// Text entry and slider/color gestures never write to the store or history
// per keystroke/pixel. The control keeps a LOCAL draft while the user types
// or drags, and calls `commit` once at the end of the interaction (blur /
// Enter / pointer-up). The draft is re-synced whenever the external value
// changes (e.g. a remote collaborator or an undo lands).
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";

export function useCommittedDraft<T>(externalValue: T): {
  draft: T;
  setDraft: (next: T) => void;
  resetDraft: () => void;
  /** True when the draft differs from the external value (event handlers only). */
  isDirtyRef: React.MutableRefObject<boolean>;
} {
  const [draft, setDraftState] = useState<T>(externalValue);
  const dirtyRef = useRef(false);

  // Re-sync when the external value changes (unless the user is mid-gesture).
  useEffect(() => {
    if (!dirtyRef.current) {
      setDraftState(externalValue);
    }
  }, [externalValue]);

  const setDraft = (next: T) => {
    dirtyRef.current = true;
    setDraftState(next);
  };

  const resetDraft = () => {
    dirtyRef.current = false;
    setDraftState(externalValue);
  };

  return {
    draft,
    setDraft,
    resetDraft,
    isDirtyRef: dirtyRef,
  };
}
