"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Bot,
  Send,
  Sparkles,
  Loader2,
  User,
  ChevronDown,
  Wand2,
  RefreshCw,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useGeneration } from "@/features/generation/hooks/useGeneration";
import { useAiEdit } from "@/features/ai-editing/hooks/useAiEdit";
import { useChatStore } from "@/features/chat/store/chat-store";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { sectionLabel } from "@/features/ai-editing/rules/rule-based-editor";
import type { EditTarget } from "@/features/ai-editing/types";
import {
  STAGE_INFO,
  STAGE_ORDER,
} from "@/features/generation/services/generation-service";

// Instruction used by the in-chip Regenerate quick action.
const REGENERATE_INSTRUCTION =
  "Rewrite this section's copy with fresh, high-quality content for the same purpose.";

// ---------------------------------------------------------------------------
// Example prompt cards
// ---------------------------------------------------------------------------

const examples = [
  "Create a landing page for an AI productivity startup",
  "Build a luxury restaurant website for Maison Bleu",
  "Design a portfolio for a product designer named Aanya",
  "Create an ecommerce homepage for a skincare brand called Lumiere",
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LeftSidebar() {
  const [input, setInput] = useState("");
  const { generate, isLoading, stage, completedStages } = useGeneration();
  const { edit, isEditing } = useAiEdit();
  const messages = useChatStore((s) => s.messages);

  // Selected section → edit target. When a section is selected, chat messages
  // route to the AI-editing (modify) flow instead of full regeneration.
  const project = useEditorStore((s) => s.project);
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);
  const clearSelection = useEditorStore((s) => s.clearSelection);

  const selectedSection = selectedSectionId
    ? project.pages.flatMap((p) => p.sections).find((s) => s.id === selectedSectionId)
    : undefined;

  const editTarget: EditTarget | null = selectedSection
    ? {
        kind: "section",
        sectionId: selectedSection.id,
        type: selectedSection.type,
        label: sectionLabel(selectedSection.type),
        props: selectedSection.props,
        context: {
          brandName: project.name.split(" — ")[0] || project.name,
        },
      }
    : null;

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const hasMessages = messages.length > 0;
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [showJumpButton, setShowJumpButton] = useState(false);

  // Track whether user is near the bottom of the chat
  const handleChatScroll = useCallback(() => {
    if (!chatContainerRef.current) return;
    const el = chatContainerRef.current;
    const threshold = 100;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setIsNearBottom(near);
    if (!near && hasMessages) {
      setShowJumpButton(true);
    } else {
      setShowJumpButton(false);
    }
  }, [hasMessages]);

  // Auto-scroll when near bottom
  const messagesLength = messages.length;
  const lastContent = messages[messagesLength - 1]?.content;

  useEffect(() => {
    if (isNearBottom && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messagesLength, lastContent, isNearBottom]);

  const isBusy = isLoading || isEditing;

  const handleSubmit = async () => {
    const prompt = input.trim();
    if (!prompt || isBusy) return;
    setInput("");
    if (editTarget) {
      await edit(prompt, editTarget);
    } else {
      await generate(prompt);
    }
  };

  const handleRegenerate = async () => {
    if (!editTarget || isBusy) return;
    await edit(REGENERATE_INSTRUCTION, editTarget);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleExampleClick = (text: string) => {
    setInput(text);
    textareaRef.current?.focus();
  };

  const scrollToBottom = () => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
      setIsNearBottom(true);
      setShowJumpButton(false);
    }
  };

  // Determine if generation is active
  const isGenerating = stage !== "idle" && stage !== "done" && stage !== "error";

  return (
    <aside data-testid="ai-sidebar" className="flex w-[320px] flex-shrink-0 flex-col border-r border-border bg-secondary" style={{ height: "100%" }}>
      {/* ---- Header ---- */}
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-4 flex-shrink-0">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10">
          <Bot className="h-4 w-4 text-accent" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-text-primary">
            AI Assistant
          </h2>
          <p className="text-xs text-text-dim">Describe your vision</p>
        </div>
      </div>

      {/* ---- Conversation area ---- */}
      <div
        ref={chatContainerRef}
        onScroll={handleChatScroll}
        className="flex-1 overflow-y-auto px-5 py-5"
        style={{ minHeight: 0 }}
      >
        <div className="flex flex-col gap-3" style={{ minHeight: 0 }}>
          {/* Welcome message + examples when no messages */}
          {!hasMessages && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="flex flex-col gap-4"
            >
              <div className="flex gap-3 pt-2">
                <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-card text-text-dim">
                  <Bot className="h-3.5 w-3.5" />
                </div>
                <div className="max-w-[85%] rounded-2xl bg-card px-4 py-2.5 text-sm leading-relaxed text-text-muted">
                  Hi! I&apos;m Buildora. Tell me what kind of website you want
                  to build, and I&apos;ll generate it for you.
                </div>
              </div>

              <div className="flex flex-col gap-2 pl-10">
                {examples.map((text) => (
                  <button
                    key={text}
                    onClick={() => handleExampleClick(text)}
                    className="w-full rounded-lg border border-border/50 bg-card/30 px-3.5 py-2.5 text-left text-xs text-text-dim transition-all duration-200 hover:border-accent/20 hover:bg-accent/[0.03] hover:text-accent active:scale-[0.98]"
                  >
                    {text}
                  </button>
                ))}
              </div>

              <p className="pl-10 text-[11px] text-text-dim/40">
                Describe the brand, style, audience, and colors for better
                results.
              </p>
            </motion.div>
          )}

          {/* Persistent chat messages */}
          {messages.map((msg, idx) => {
            const isUser = msg.role === "user";
            const isPending = msg.status === "pending";
            const isError = msg.status === "error";
            const isLast = idx === messages.length - 1;
            const dataTestId = isUser ? "chat-message-user" : "chat-message-assistant";

            return (
              <motion.div
                key={msg.id}
                data-testid={dataTestId}
                initial={isLast ? { opacity: 0, y: 8 } : undefined}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
              >
                {/* Avatar */}
                <div
                  className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${
                    isUser
                      ? "bg-accent/15 text-accent"
                      : isError
                        ? "bg-red-500/15 text-red-400"
                        : "bg-card text-text-dim"
                  }`}
                >
                  {isUser ? (
                    <User className="h-3.5 w-3.5" />
                  ) : (
                    <Bot className="h-3.5 w-3.5" />
                  )}
                </div>

                {/* Bubble */}
                <div
                  className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    isUser
                      ? "max-w-[85%] bg-accent/10 text-text-primary"
                      : isError
                        ? "max-w-[85%] bg-red-500/10 text-red-400"
                        : isPending
                          ? "w-full bg-card"
                          : "max-w-[88%] bg-card text-text-muted"
                  }`}
                >
                  {isPending && isGenerating ? (
                    <div className="flex flex-col gap-2.5">
                      <div className="flex items-center gap-2 text-text-muted">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                        <span className="text-xs font-medium text-accent">
                          Generating...
                        </span>
                      </div>

                      {/* Stage progress */}
                      <div data-testid="generation-progress" className="flex flex-col gap-1.5 pl-0.5">
                        {STAGE_ORDER.map((s) => {
                          const info =
                            STAGE_INFO[s as keyof typeof STAGE_INFO];
                          if (!info) return null;
                          const isActive = stage === s;
                          const isComplete = completedStages.has(s);

                          return (
                            <div
                              key={s}
                              className={`flex items-center gap-2 text-xs transition-all duration-300 ${
                                isComplete
                                  ? "text-accent/80"
                                  : isActive
                                    ? "text-text-primary"
                                    : "text-text-dim/30"
                              }`}
                            >
                              <span className="flex h-3.5 w-3.5 items-center justify-center">
                                {isComplete ? (
                                  <span className="text-[10px]">✓</span>
                                ) : isActive ? (
                                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                                ) : (
                                  <span className="h-1.5 w-1.5 rounded-full bg-text-dim/20" />
                                )}
                              </span>
                              <span>{info.label}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : isPending && !isGenerating ? (
                    <div className="flex items-center gap-2 text-text-muted">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                      Finalizing...
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap break-words">
                      {msg.content}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}

          {/* Auto-scroll anchor */}
          <div ref={chatEndRef} />
        </div>
      </div>

      {/* ---- Jump to latest button ---- */}
      <AnimatePresence>
        {showJumpButton && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="flex justify-center px-4 py-1 flex-none"
          >
            <button
              onClick={scrollToBottom}
              className="flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-xs text-text-dim shadow-sm transition-all duration-200 hover:text-accent active:scale-95"
            >
              <ChevronDown className="h-3 w-3" />
              Jump to latest
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---- Prompt composer ---- */}
      <div className="border-t border-border px-4 py-4 flex-none">
        {/* Edit-target chip — shown while a section is selected */}
        {editTarget && (
          <div
            data-testid="edit-target-chip"
            className="mb-3 flex items-center gap-2 rounded-xl border border-accent/25 bg-accent/[0.06] px-3 py-2"
          >
            <Wand2 className="h-3.5 w-3.5 shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
              Editing:{" "}
              <span className="font-medium text-accent">{editTarget.label}</span>
            </span>
            <button
              type="button"
              onClick={handleRegenerate}
              disabled={isBusy}
              data-testid="regenerate-section"
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/10 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RefreshCw className="h-3 w-3" />
              Regenerate
            </button>
            <button
              type="button"
              onClick={() => clearSelection()}
              disabled={isBusy}
              aria-label="Stop editing section"
              className="flex h-5 w-5 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-border hover:text-text-primary disabled:opacity-40"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <div className="relative">
          <textarea
            ref={textareaRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            data-testid="prompt-input"
            placeholder={
              editTarget
                ? `Describe how to edit the ${(editTarget.label ?? "section").toLowerCase()}...`
                : "Describe your website..."
            }
            disabled={isBusy}
            className="w-full resize-none rounded-2xl border border-border bg-base px-4 py-3 pr-12 text-sm text-text-primary placeholder:text-text-dim transition-all duration-200 focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/10 disabled:opacity-50"
            style={{ maxHeight: "160px" }}
            aria-label={editTarget ? "Edit instruction" : "Website description"}
          />
          <button
            onClick={handleSubmit}
            disabled={isBusy || !input.trim()}
            className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-white transition-all duration-200 hover:bg-accent-hover active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label={editTarget ? "Apply edit" : "Send message"}
          >
            {isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : editTarget ? (
              <Wand2 className="h-4 w-4" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>

        <button
          data-testid="generate-button"
          onClick={handleSubmit}
          disabled={isBusy || !input.trim()}
          className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-accent text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
          type="button"
        >
          {isBusy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {isEditing ? "Editing..." : "Generating..."}
            </>
          ) : editTarget ? (
            <>
              <Wand2 className="h-4 w-4" />
              Apply Edit
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Generate
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
