"use client";

import { useEditorStore } from "@/features/editor/store/editor-store";
import { useChatStore } from "@/features/chat/store/chat-store";
import { useInlineEditingStore } from "../store/inline-editing-store";

// ---------------------------------------------------------------------------
// applyEditedSuggestion — applies a manually edited suggestion value through
// the same one-validated-field-update path as accept. Used by the popover's
// "edit suggestion" flow (spec §13: Edit suggestion manually).
// ---------------------------------------------------------------------------

export async function applyEditedSuggestion(nextValue: string): Promise<void> {
  const store = useInlineEditingStore.getState();
  const field = store.selectedField;
  if (!field) return;

  store.setApplying();
  const result = useEditorStore
    .getState()
    .updateEditableFieldValue(field, nextValue);

  if (!result.ok) {
    useInlineEditingStore.getState().setError(result.error);
    return;
  }

  useInlineEditingStore.getState().applyComplete(nextValue);
  useChatStore.getState().addMessage({
    role: "assistant",
    content: `Applied your edited version of ${field.label.toLowerCase()}.`,
    status: "complete",
  });
}
