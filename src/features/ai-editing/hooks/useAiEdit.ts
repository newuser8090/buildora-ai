"use client";

import { useState, useCallback } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useChatStore } from "@/features/chat/store/chat-store";
import { runAiEdit, buildEditSummary } from "../services/edit-service";
import type { EditTarget } from "../types";

// ---------------------------------------------------------------------------
// useAiEdit — hook that drives an AI edit (mode: "modify")
//
// Mirrors useGeneration: user + pending assistant messages in the chat,
// generation gating via the editor store, and a summary on completion. The
// edited props are applied through updateSectionProps, which records a single
// undoable history entry per edit.
// ---------------------------------------------------------------------------

export function useAiEdit() {
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSource, setLastSource] = useState<"gemini" | "rule-based" | null>(null);

  const updateSectionProps = useEditorStore((s) => s.updateSectionProps);
  const setGenerating = useEditorStore((s) => s.setGenerating);
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);

  const edit = useCallback(
    async (prompt: string, target: EditTarget) => {
      setError(null);
      setLastSource(null);

      // 1. Add the user message immediately
      addMessage({ role: "user", content: prompt, status: "complete" });

      // 2. Add a pending assistant message
      addMessage({ role: "assistant", content: "", status: "pending" });

      const storeMessages = useChatStore.getState().messages;
      const pendingMsg = [...storeMessages]
        .reverse()
        .find((m) => m.status === "pending");
      const pendingId = pendingMsg?.id;
      if (!pendingId) return;

      setIsEditing(true);
      setGenerating(true);

      try {
        const result = await runAiEdit(prompt, target);

        // Apply each edit for the target section. Props merge, so fields the
        // AI didn't return (e.g. asset refs) are preserved.
        let changedCount = 0;
        for (const item of result.edits) {
          if (item.type === target.type) {
            const applied = { ...target.props, ...item.props };
            if (JSON.stringify(applied) !== JSON.stringify(target.props)) {
              changedCount += 1;
            }
            updateSectionProps(target.sectionId, item.props);
          }
        }

        setLastSource(result.source);
        updateMessage(pendingId, {
          content: buildEditSummary(target, result, changedCount),
          status: "complete",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Edit failed";
        setError(msg);
        updateMessage(pendingId, {
          content: msg || "I couldn't edit that section. Please try again.",
          status: "error",
        });
      } finally {
        setIsEditing(false);
        setGenerating(false);
      }
    },
    [updateSectionProps, setGenerating, addMessage, updateMessage],
  );

  return { edit, isEditing, error, lastSource };
}
