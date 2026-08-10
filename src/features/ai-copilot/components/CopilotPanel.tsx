"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Loader2, MessageSquarePlus, Send, Sparkles, X } from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useWorkspaceAccessStore } from "@/features/workspaces/store/workspace-access-store";
import { useCopilotStore } from "../store/copilot-store";
import { useCopilot } from "../hooks/useCopilot";
import { ScopeBadge, buildScopeOptions } from "./ScopeBadge";
import { PlanReview } from "./PlanReview";
import { ElementSuggestionCard } from "./ElementSuggestionCard";
import { ChangeSummaryCard } from "./ChangeSummaryCard";
import { QuickActions } from "./QuickActions";
import { StarterPrompts } from "./StarterPrompts";
import { StyleNotesSection } from "./StyleNotesSection";
import type { AiEditOperation } from "@/features/ai-editing/plan-types";
import { cn } from "@/utils/cn";

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function CopilotPanel() {
  const copilot = useCopilot();
  const {
    open,
    status,
    scopeChoice,
    messages,
    planState,
    elementSuggestion,
    error,
    appliedSummary,
    lastRequest,
    styleNotes,
    memoryRestored,
    selectedField,
    readiness,
    closePanel,
    setScopeChoice,
    setSelectedOperationIds,
    sendMessage,
    applyPlan,
    runElementQuickAction,
    applyElementSuggestionAction,
    rejectElementSuggestion,
    undoLast,
    regenerate,
    clearConversation,
    canUndo,
  } = copilot;

  // Phase P11 — style note actions (bounded, local-first).
  const addStyleNote = useCallback((note: string) => {
    useCopilotStore.getState().addStyleNote(note);
  }, []);
  const removeStyleNote = useCallback((note: string) => {
    useCopilotStore.getState().removeStyleNote(note);
  }, []);
  const clearStyleNotes = useCallback(() => {
    useCopilotStore.getState().clearStyleNotes();
  }, []);

  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  // Phase P14 — collaboration read-only state (viewer / blocked-by-lease /
  // offline). ASK stays available; edit requests are rejected by the service.
  const accessMode = useWorkspaceAccessStore((s) => s.access.mode);
  const accessReason = useWorkspaceAccessStore((s) => s.access.reason);
  const readOnly = accessMode === "readonly";

  // Live editor context for the scope badge + quick actions.
  const project = useEditorStore((s) => s.project);
  const selectedPageId = useEditorStore((s) => s.selectedPageId);
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);

  const selectedSection = selectedSectionId
    ? project.pages.flatMap((p) => p.sections).find((s) => s.id === selectedSectionId)
    : undefined;

  // If the user explicitly scoped to selected text and that selection is gone,
  // fall back to auto so the indicator and the actual scope never diverge.
  useEffect(() => {
    const choice = useCopilotStore.getState().scopeChoice;
    if (!selectedField && choice !== "auto" && choice.type === "element") {
      setScopeChoice("auto");
    }
  }, [selectedField, setScopeChoice]);

  const scopeOptions = useMemo(
    () =>
      buildScopeOptions({
        project,
        selectedPageId,
        selectedSectionId,
        selectedField,
      }),
    [project, selectedPageId, selectedSectionId, selectedField],
  );

  const activeScope = useMemo(() => {
    if (scopeChoice !== "auto") return scopeChoice;
    return (
      scopeOptions.find((o) => o.value.type === "section")?.value ??
      scopeOptions.find((o) => o.value.type === "element")?.value ??
      scopeOptions.find((o) => o.value.type === "page")?.value ??
      scopeOptions[0]?.value ?? { type: "project" }
    );
  }, [scopeChoice, scopeOptions]);

  const busy = status === "planning" || status === "applying";

  // ---- Focus management: capture on mount, restore on unmount ----
  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    const raf = window.setTimeout(() => textareaRef.current?.focus(), 30);
    return () => {
      window.clearTimeout(raf);
      prevFocusRef.current?.focus();
      prevFocusRef.current = null;
    };
  }, [open]);

  // ---- Escape closes the panel ----
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closePanel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, closePanel]);

  // ---- Auto-scroll to the latest message ----
  const messagesLength = messages.length;
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messagesLength, status]);

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    void sendMessage(text);
  }, [draft, busy, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const toggleOperation = useCallback(
    (op: AiEditOperation) => {
      const current = planState?.selectedOperationIds ?? [];
      const next = new Set(current);
      if (next.has(op.id)) next.delete(op.id);
      else next.add(op.id);
      setSelectedOperationIds(Array.from(next));
    },
    [planState?.selectedOperationIds, setSelectedOperationIds],
  );

  if (!open) return null;

  const pendingVisible = status === "planning";
  const hasConversation = messages.length > 0;

  return (
    <aside
      data-testid="copilot-panel"
      role="complementary"
      aria-label="AI Copilot"
      className="fixed bottom-14 right-3 top-16 z-40 flex w-[370px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-secondary shadow-elevated"
    >
      {/* ---- Header ---- */}
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/10">
          <Bot className="h-4 w-4 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-text-primary">AI Copilot</h2>
          <p className="truncate text-[11px] text-text-dim">
            Ask questions or describe changes — you approve everything.
          </p>
        </div>
        <button
          type="button"
          data-testid="copilot-new-conversation"
          onClick={clearConversation}
          disabled={!hasConversation && !planState && !error}
          title="Start a new conversation"
          aria-label="Start a new conversation"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary disabled:opacity-30"
        >
          <MessageSquarePlus className="h-4 w-4" />
        </button>
        <button
          type="button"
          data-testid="copilot-close"
          onClick={closePanel}
          title="Close (Esc)"
          aria-label="Close AI Copilot"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ---- Phase P14: read-only notice ---- */}
      {readOnly && (
        <div
          role="status"
          data-testid="copilot-readonly-notice"
          className="border-b border-border bg-yellow-500/[0.08] px-4 py-2.5 text-[11px] leading-relaxed text-yellow-600 dark:text-yellow-400"
        >
          {accessReason === "being-edited"
            ? "Someone else is editing this project right now. I can answer questions and suggest changes, but nothing can be applied until they finish."
            : accessReason === "offline"
              ? "You're offline, so shared projects are read-only. Ask me anything — changes need a connection."
              : "This project is read-only for you. I can answer questions and suggest changes, but a workspace editor must apply them."}
        </div>
      )}

      {/* ---- Scope indicator ---- */}
      <div className="border-b border-border px-4 py-2.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-text-dim/70">
            Acting on
          </span>
          {readiness && (
            <span className="text-[10px] text-text-dim">
              Readiness {readiness.score}
            </span>
          )}
        </div>
        <ScopeBadge value={activeScope} options={scopeOptions} onChange={setScopeChoice} />
      </div>

      {/* ---- Scrollable content ---- */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4" style={{ minHeight: 0 }}>
        {memoryRestored && hasConversation && (
          <div
            data-testid="copilot-memory-restored"
            className="mb-3 rounded-xl border border-border bg-card/60 px-3 py-2 text-[11px] leading-relaxed text-text-dim"
          >
            Restored your saved conversation from this project.
          </div>
        )}
        {!hasConversation && !planState && !elementSuggestion && (
          <div className="mb-4">
            <p className="mb-3 text-[13px] leading-relaxed text-text-muted">
              Hi! I can help you improve this website. Describe a change, ask a
              question, or pick one of these to start.
            </p>
            <StarterPrompts busy={busy} onSelect={(p) => void sendMessage(p)} />
          </div>
        )}

        {/* Conversation */}
        <div className="flex flex-col gap-2.5">
          {messages.map((msg) => {
            const isUser = msg.role === "user";
            const isError = msg.role === "assistant" && msg.kind === "error";
            return (
              <div
                key={msg.id}
                data-testid={isUser ? "copilot-msg-user" : "copilot-msg-assistant"}
                className={cn("flex", isUser ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed",
                    isUser
                      ? "bg-accent/10 text-text-primary"
                      : isError
                        ? "bg-red-500/10 text-red-300"
                        : "bg-card text-text-muted",
                  )}
                >
                  {msg.content}
                </div>
              </div>
            );
          })}

          {pendingVisible && (
            <div className="flex justify-start" data-testid="copilot-thinking">
              <div className="flex items-center gap-2 rounded-2xl bg-card px-3.5 py-2.5 text-[13px] text-text-dim">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                Thinking…
              </div>
            </div>
          )}
        </div>

        {/* Pinned cards (plan / suggestion / summary / error) */}
        {(status === "awaiting-approval" || status === "applying") && planState && (
          <div className="mt-3">
            <PlanReview
              plan={planState.plan}
              diffs={planState.diffs}
              selectedOperationIds={planState.selectedOperationIds}
              warnings={planState.warnings}
              applying={status === "applying"}
              onToggleOperation={toggleOperation}
              onApply={applyPlan}
              onRegenerate={regenerate}
              onCancel={() => {
                setSelectedOperationIds([]);
                clearConversation();
              }}
            />
          </div>
        )}

        {(status === "awaiting-approval" || status === "applying") && elementSuggestion && (
          <div className="mt-3">
            <ElementSuggestionCard
              suggestion={elementSuggestion.suggestion}
              field={elementSuggestion.field}
              applying={status === "applying"}
              onApply={applyElementSuggestionAction}
              onReject={rejectElementSuggestion}
            />
          </div>
        )}

        {status === "completed" && appliedSummary && appliedSummary.applied > 0 && (
          <div className="mt-3">
            <ChangeSummaryCard summary={appliedSummary} canUndo={canUndo} onUndo={undoLast} />
          </div>
        )}

        {status === "failed" && error && (
          <div
            role="alert"
            data-testid="copilot-error"
            className="mt-3 flex flex-col gap-2.5 rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-3.5"
          >
            <p className="text-[13px] leading-relaxed text-red-300">{error.message}</p>
            <div className="flex items-center gap-2">
              {error.retryable && lastRequest && (
                <button
                  type="button"
                  data-testid="copilot-retry"
                  onClick={regenerate}
                  disabled={busy}
                  className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-white transition-all hover:bg-accent-hover active:scale-95 disabled:opacity-40"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Try again
                </button>
              )}
              <button
                type="button"
                data-testid="copilot-error-dismiss"
                onClick={clearConversation}
                className="flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
              >
                Start over
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ---- Quick actions + composer ---- */}
      <div className="border-t border-border px-4 py-3">
        <QuickActions
          elementLabel={selectedField?.label ?? null}
          sectionType={selectedSection?.type ?? null}
          hasPage={(project.pages?.length ?? 0) > 0}
          busy={busy}
          readOnly={readOnly}
          onElementAction={(a) => void runElementQuickAction(a)}
          onSectionAction={(a) => void sendMessage(a.instruction)}
          onPageAction={(a) => void sendMessage(a.instruction)}
        />

        <div className="relative">
          <textarea
            ref={textareaRef}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            data-testid="copilot-input"
            placeholder={
              selectedField
                ? `Ask AI to improve “${selectedField.label}”…`
                : "Ask a question or describe a change…"
            }
            aria-label="Ask the AI Copilot"
            disabled={busy}
            className="w-full resize-none rounded-2xl border border-border bg-base px-4 py-3 pr-12 text-sm text-text-primary placeholder:text-text-dim transition-all duration-200 focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/10 disabled:opacity-50"
            style={{ maxHeight: "140px" }}
          />
          <button
            type="button"
            data-testid="copilot-send"
            onClick={handleSend}
            disabled={busy || !draft.trim()}
            aria-label="Send message"
            className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-white transition-all duration-200 hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-2 text-center text-[10px] text-text-dim/60">
          Changes are suggested first and applied only after you approve them.
        </p>
      </div>

      {/* ---- Phase P11: style memory ---- */}
      <StyleNotesSection
        notes={styleNotes}
        onAdd={addStyleNote}
        onRemove={removeStyleNote}
        onClearAll={clearStyleNotes}
      />

      {/* ---- Status announcements for screen readers ---- */}
      <div aria-live="polite" className="sr-only" data-testid="copilot-aria-live">
        {status === "planning"
          ? "The AI Copilot is thinking"
          : status === "awaiting-approval"
            ? "A suggestion is ready for your review"
            : status === "applying"
              ? "Applying your approved changes"
              : status === "completed"
                ? "Changes applied"
                : status === "failed"
                  ? "Something went wrong"
                  : ""}
      </div>
    </aside>
  );
}
