"use client";

import { useCallback, useEffect } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useChatStore } from "@/features/chat/store/chat-store";
import { useInlineEditingStore } from "../store/inline-editing-store";
import { runInlineSuggestion, InlineSuggestionClientError } from "../services/inline-suggestion-service";
import { getStringValueAtPath, resolveDescriptor } from "../registry/editable-field-registry";
import type {
  EditableFieldDescriptor,
  InlineAiError,
  InlineAiSuggestion,
  InlineSuggestionInput,
} from "../types";

// ---------------------------------------------------------------------------
// Chat summary builders
// ---------------------------------------------------------------------------

function buildSuggestionReadySummary(suggestion: InlineAiSuggestion, source: string): string {
  const providerNote =
    source === "rule-based"
      ? " I used Buildora's local engine because Gemini was unavailable."
      : "";
  return `Here's a suggested rewrite for this ${suggestion.fieldPath.join(".")}:\n“${suggestion.suggestedValue}”${suggestion.explanation ? `\n\n${suggestion.explanation}` : ""}${providerNote}`;
}

function buildAppliedSummary(suggestion: InlineAiSuggestion): string {
  return `Applied the suggested change to this ${suggestion.fieldPath.join(".")}.`;
}

function buildRejectedSummary(): string {
  return "No changes made — the suggestion was rejected.";
}

function buildStaleSummary(): string {
  return "This text changed since the suggestion was created, so I didn't apply it. Regenerate the suggestion or discard it.";
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useInlineEdit() {
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  const selectField = useCallback(
    (field: EditableFieldDescriptor | null, anchor?: HTMLElement | null) => {
      // Clicking a field also selects its section (spec §5).
      if (field) {
        const store = useEditorStore.getState();
        store.selectSection(field.sectionId);
        // Keep the page in sync with the field's page.
        if (store.selectedPageId !== field.pageId) {
          store.selectPage(field.pageId);
        }
      }
      useInlineEditingStore.getState().selectField(field, anchor ?? null);
    },
    [],
  );

  const clearField = useCallback(() => {
    useInlineEditingStore.getState().clearField();
  }, []);

  // -------------------------------------------------------------------------
  // Manual inline editing
  // -------------------------------------------------------------------------

  const beginEditing = useCallback(() => {
    useInlineEditingStore.getState().beginEditing();
  }, []);

  const setDraftValue = useCallback((value: string) => {
    useInlineEditingStore.getState().setDraftValue(value);
  }, []);

  /** Save a manual draft — one history entry, or a no-op when unchanged. */
  const saveDraft = useCallback(async (): Promise<InlineAiError | null> => {
    const state = useInlineEditingStore.getState();
    const field = state.selectedField;
    if (!field) return null;

    const result = useEditorStore
      .getState()
      .updateEditableFieldValue(field, state.draftValue);
    if (!result.ok) {
      useInlineEditingStore.getState().setError(result.error);
      return result.error;
    }
    if (!result.changed) {
      // No-op — cancel editing without a history entry.
      useInlineEditingStore.getState().cancelEditing();
      return null;
    }
    // Refresh the descriptor so re-editing starts from the applied value.
    useInlineEditingStore.getState().applyComplete(state.draftValue);
    return null;
  }, []);

  const cancelEditing = useCallback(() => {
    useInlineEditingStore.getState().cancelEditing();
  }, []);

  // -------------------------------------------------------------------------
  // AI suggestions
  // -------------------------------------------------------------------------

  const suggest = useCallback(
    async (instruction: string) => {
      const store = useInlineEditingStore.getState();
      const field = store.selectedField;
      if (!field) return;

      // Serial — no overlapping requests.
      if (store.mode === "suggesting" || store.mode === "applying") return;
      if (!instruction.trim()) return;

      store.beginSuggesting(instruction);
      const token = store.nextRequestToken();
      addMessage({ role: "user", content: instruction, status: "complete" });
      addMessage({ role: "assistant", content: "", status: "pending" });
      const pendingId = [...useChatStore.getState().messages]
        .reverse()
        .find((m) => m.status === "pending")?.id;

      // Build a capped surrounding context digest for the provider.
      const editor = useEditorStore.getState();
      const page = editor.project.pages.find((p) => p.id === field.pageId);
      const section = page?.sections.find((s) => s.id === field.sectionId);
      const surroundingContext = section
        ? JSON.stringify(section.props).slice(0, 6000)
        : undefined;

      const input: InlineSuggestionInput = {
        instruction,
        projectId: editor.project.id,
        baseRevision: editor.revision,
        pageId: field.pageId,
        sectionId: field.sectionId,
        sectionType: field.sectionType,
        fieldPath: field.fieldPath,
        fieldKind: field.kind,
        currentValue: field.currentValue,
        surroundingContext,
        variant: store.instructionHistory.filter((h) => h === instruction).length,
      };

      try {
        const result = await runInlineSuggestion(input);
        // Stale async response (field cleared / reset) — ignore.
        if (token !== useInlineEditingStore.getState().requestToken) return;
        useInlineEditingStore.getState().setSuggestion(result.suggestion);
        if (pendingId) {
          updateMessage(pendingId, {
            content: buildSuggestionReadySummary(result.suggestion, result.source),
            status: "complete",
          });
        }
      } catch (err) {
        if (token !== useInlineEditingStore.getState().requestToken) return;
        const error: InlineAiError =
          err instanceof InlineSuggestionClientError
            ? { code: err.code as InlineAiError["code"], message: err.message }
            : {
                code: "INLINE_SUGGESTION_FAILED",
                message:
                  err instanceof Error
                    ? err.message
                    : "I couldn't produce a suggestion. Please try again.",
              };
        useInlineEditingStore.getState().setError(error);
        if (pendingId) {
          updateMessage(pendingId, { content: error.message, status: "error" });
        }
      }
    },
    [addMessage, updateMessage],
  );

  // -------------------------------------------------------------------------
  // Accept / reject / regenerate
  // -------------------------------------------------------------------------

  /** Stale policy — every check must pass before a suggestion can apply. */
  const isSuggestionStale = useCallback(
    (suggestion: InlineAiSuggestion): InlineAiError | null => {
      const editor = useEditorStore.getState();

      if (editor.project.id !== suggestion.projectId) {
        return {
          code: "INLINE_PROJECT_MISMATCH",
          message: "This suggestion was created for a different project.",
        };
      }
      if (editor.revision !== suggestion.baseRevision) {
        return {
          code: "INLINE_REVISION_MISMATCH",
          message: "This text changed since the suggestion was created.",
        };
      }
      const page = editor.project.pages.find((p) => p.id === suggestion.pageId);
      const section = page?.sections.find((s) => s.id === suggestion.sectionId);
      if (!section) {
        return {
          code: "INLINE_FIELD_NOT_FOUND",
          message: "This field no longer exists.",
        };
      }
      const current = getStringValueAtPath(section.props, suggestion.fieldPath);
      if (current !== suggestion.originalValue) {
        return {
          code: "INLINE_SUGGESTION_STALE",
          message: "This text changed since the suggestion was created.",
        };
      }
      return null;
    },
    [],
  );

  /** Apply the current suggestion — one validated history entry. */
  const acceptSuggestion = useCallback(async () => {
    const store = useInlineEditingStore.getState();
    const suggestion = store.currentSuggestion;
    const field = store.selectedField;
    if (!suggestion || !field || store.mode === "applying") return;

    const stale = isSuggestionStale(suggestion);
    if (stale) {
      useInlineEditingStore.getState().setStale();
      addMessage({
        role: "assistant",
        content: buildStaleSummary(),
        status: "complete",
      });
      return;
    }

    useInlineEditingStore.getState().setApplying();
    const result = useEditorStore
      .getState()
      .updateEditableFieldValue(field, suggestion.suggestedValue);

    if (!result.ok) {
      useInlineEditingStore.getState().setError(result.error);
      return;
    }

    // Refresh the descriptor so re-editing starts from the applied value.
    useInlineEditingStore.getState().applyComplete(suggestion.suggestedValue);
    addMessage({
      role: "assistant",
      content: buildAppliedSummary(suggestion),
      status: "complete",
    });
  }, [addMessage, isSuggestionStale]);

  const rejectSuggestion = useCallback(() => {
    useInlineEditingStore.getState().rejectSuggestion();
    addMessage({
      role: "assistant",
      content: buildRejectedSummary(),
      status: "complete",
    });
  }, [addMessage]);

  const regenerate = useCallback(async () => {
    const store = useInlineEditingStore.getState();
    const instruction = store.instructionHistory[store.instructionHistory.length - 1];
    if (!instruction) return Promise.resolve();
    return suggest(instruction);
  }, [suggest]);

  // -------------------------------------------------------------------------
  // Reset on project/page/section changes
  // -------------------------------------------------------------------------

  useEffect(() => {
    const unsub = useEditorStore.subscribe((state, prev) => {
      const current = useInlineEditingStore.getState();
      if (!current.selectedField) return;

      // Project switched → reset everything.
      if (state.activeProjectId !== prev.activeProjectId) {
        useInlineEditingStore.getState().reset();
        return;
      }
      // Page switched → clear field selection.
      if (state.selectedPageId !== prev.selectedPageId) {
        useInlineEditingStore.getState().clearField();
        return;
      }
      // Section deleted → clear field selection.
      if (
        current.selectedField &&
        state.project.pages
          .flatMap((p) => p.sections)
          .every((s) => s.id !== current.selectedField!.sectionId)
      ) {
        useInlineEditingStore.getState().clearField();
      }
    });
    return unsub;
  }, []);

  // -------------------------------------------------------------------------
  // Reactive snapshot
  // -------------------------------------------------------------------------

  const selectedField = useInlineEditingStore((s) => s.selectedField);
  const mode = useInlineEditingStore((s) => s.mode);
  const draftValue = useInlineEditingStore((s) => s.draftValue);
  const currentSuggestion = useInlineEditingStore((s) => s.currentSuggestion);
  const instructionHistory = useInlineEditingStore((s) => s.instructionHistory);
  const error = useInlineEditingStore((s) => s.error);
  const anchorEl = useInlineEditingStore((s) => s.anchorEl);

  return {
    selectField,
    clearField,
    beginEditing,
    setDraftValue,
    saveDraft,
    cancelEditing,
    suggest,
    acceptSuggestion,
    rejectSuggestion,
    regenerate,
    selectedField,
    mode,
    draftValue,
    currentSuggestion,
    instructionHistory,
    error,
    anchorEl,
    isBusy: mode === "suggesting" || mode === "applying",
  };
}

// Re-export the resolver for components that need the live current value.
export { resolveDescriptor };
