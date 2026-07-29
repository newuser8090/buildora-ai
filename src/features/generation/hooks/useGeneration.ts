"use client";

import { useState, useCallback } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useChatStore } from "@/features/chat/store/chat-store";
import {
  runGeneration,
  buildSummary,
  STAGE_ORDER,
  type GenerationStage,
} from "../services/generation-service";

// ---------------------------------------------------------------------------
// useGeneration — hook that wraps the generation pipeline
// ---------------------------------------------------------------------------

export function useGeneration() {
  const [stage, setStage] = useState<GenerationStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastSource, setLastSource] = useState<"gemini" | "rule-based" | null>(null);
  const [completedStages, setCompletedStages] = useState<Set<string>>(new Set());

  const initProject = useEditorStore((s) => s.initProject);
  const setGenerating = useEditorStore((s) => s.setGenerating);
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);

  const generate = useCallback(
    async (prompt: string) => {
      setError(null);
      setLastSource(null);
      setCompletedStages(new Set());

      // 1. Add user message immediately
      addMessage({ role: "user", content: prompt, status: "complete" });

      // 2. Add a pending assistant message
      addMessage({
        role: "assistant",
        content: "",
        status: "pending",
      });

      const storeMessages = useChatStore.getState().messages;
      const pendingMsg = [...storeMessages]
        .reverse()
        .find((m) => m.status === "pending");
      const pendingId = pendingMsg?.id;

      if (!pendingId) return;

      setGenerating(true);
      setStage("understanding");

      try {
        const stageUpdater = (s: GenerationStage) => {
          setStage(s);
          // Track completed stages
          if (s !== "idle" && s !== "done" && s !== "error") {
            const idx = STAGE_ORDER.indexOf(s);
            const completed = new Set(STAGE_ORDER.slice(0, Math.max(0, idx)));
            setCompletedStages(completed);
          }
        };

        const { project, plan, source } = await runGeneration(
          prompt,
          stageUpdater,
        );

        // Load the generated project into the editor
        initProject(project);

        setLastSource(source);
        setCompletedStages(new Set(STAGE_ORDER));

        // Update pending message to final summary
        const summary = buildSummary(plan, source);
        updateMessage(pendingId, {
          content: summary,
          status: "complete",
        });
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Generation failed";
        setError(msg);
        setStage("error");

        updateMessage(pendingId, {
          content: msg || "I couldn't generate that website. Please try again.",
          status: "error",
        });
      } finally {
        setGenerating(false);
        setTimeout(() => {
          setStage("idle");
          setCompletedStages(new Set());
        }, 500);
      }
    },
    [initProject, setGenerating, addMessage, updateMessage],
  );

  const isLoading = stage !== "idle" && stage !== "done" && stage !== "error";

  return {
    generate,
    isLoading,
    stage,
    completedStages,
    error,
    lastSource,
  };
}
