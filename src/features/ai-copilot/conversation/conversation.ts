// ---------------------------------------------------------------------------
// AI Copilot — conversation model (Phase P10, spec §5)
//
// Session-only, bounded. Follow-ups ("make it shorter", "do the same on the
// About page") are resolved using the bounded conversation tail PLUS the
// live editor state. There is no autonomous memory system.
//
// A previous plan is NEVER reused: every follow-up produces a fresh plan
// against the current project (the planner always sees current state), so a
// stale plan can never be applied. The plan apply path additionally guards
// with the editor store's revision check.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import type { FieldPathSegment } from "@/features/inline-editing/types";
import type { AiEditScope } from "@/features/ai-editing/plan-types";
import type { CopilotMessage, CopilotScope } from "../types";
import { COPILOT_LIMITS } from "../constants";

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export const MAX_MESSAGES = COPILOT_LIMITS.maxMessages;

/** Trim to the bound, always dropping the oldest message first. */
export function trimConversation(messages: CopilotMessage[]): CopilotMessage[] {
  if (messages.length <= MAX_MESSAGES) return messages;
  return messages.slice(messages.length - MAX_MESSAGES);
}

/** New conversation = empty list. (Store also clears plan/error.) */
export function emptyConversation(): CopilotMessage[] {
  return [];
}

// ---------------------------------------------------------------------------
// Last-plan context — the most recent edit-plan or applied message
// ---------------------------------------------------------------------------

export interface LastPlanContext {
  scope: AiEditScope | null;
  pageId?: string;
  sectionId?: string;
  opLabels: string[];
  instruction?: string;
}

export function findLastPlanContext(messages: CopilotMessage[]): LastPlanContext | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    if (msg.kind !== "edit-plan" && msg.kind !== "applied") continue;
    return {
      scope: msg.metadata?.scope ?? null,
      pageId: msg.metadata?.pageId,
      sectionId: msg.metadata?.sectionId,
      opLabels: msg.metadata?.opLabels ?? [],
      instruction: msg.content,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Follow-up target resolution
// ---------------------------------------------------------------------------

export interface ResolveFollowUpInput {
  instruction: string;
  project: Project;
  selectedPageId?: string | null;
  selectedSectionId?: string | null;
  selectedField?: {
    pageId: string;
    sectionId: string;
    fieldPath: FieldPathSegment[];
  } | null;
  messages: CopilotMessage[];
}

export interface ResolveFollowUpResult {
  /** The scope the follow-up should run against. */
  scope: CopilotScope;
  /** The instruction to send to the planner (may be augmented with context). */
  instruction: string;
  /** True when the target came from the conversation rather than live state. */
  resolvedFromConversation: boolean;
}

/** Resolve a page by plain-language name ("About page", "homepage"). */
function resolvePage(project: Project, keyword: string) {
  const lower = keyword.toLowerCase().trim().replace(/\s+/g, " ");
  const pages = project.pages ?? [];
  if (lower === "homepage" || lower === "home page" || lower === "home") {
    return pages[0];
  }
  const exact = pages.find((p) => p.title.toLowerCase().trim() === lower);
  if (exact) return exact;
  return pages.find(
    (p) => p.title.toLowerCase().includes(lower) || lower.includes(p.title.toLowerCase()),
  );
}

const PAGE_REFERENCE_RE =
  /(?:on|to|for|the|in|across)?\s*(?:the\s+)?([a-z0-9][\w\s-]{1,40}?)\s+page/i;

/** "homepage" / "home page" / "home" as a direct page reference. */
const HOME_REFERENCE_RE = /\bhome\s?page\b|\bhome\b/i;

const SAME_REFERENCE_RE = /\b(same|similarly|like that|similar|again|too)\b/i;

/**
 * Resolve what a follow-up message targets. Priority:
 *   1. explicit page reference in the instruction
 *   2. live section selection
 *   3. the last plan/applied message's section target (if it still exists)
 *   4. the last plan/applied message's page target
 *   5. project scope
 */
export function resolveFollowUpTarget(input: ResolveFollowUpInput): ResolveFollowUpResult {
  const { instruction, project, messages } = input;
  const pages = project.pages ?? [];

  // 1. Explicit page reference. "homepage"/"home" are direct references even
  //    without a " page" suffix (common in natural language).
  const pageMatch = instruction.match(PAGE_REFERENCE_RE);
  if (pageMatch && !/this|current/i.test(pageMatch[1])) {
    const page = resolvePage(project, pageMatch[1]);
    if (page) {
      return { scope: { type: "page", pageId: page.id }, instruction, resolvedFromConversation: false };
    }
  }
  if (HOME_REFERENCE_RE.test(instruction) && !/this|current/i.test(instruction)) {
    const page = resolvePage(project, "homepage");
    if (page) {
      return { scope: { type: "page", pageId: page.id }, instruction, resolvedFromConversation: false };
    }
  }

  const last = findLastPlanContext(messages);
  const augment = (text: string) => (last ? augmentSameReference(text, last) : text);

  // 2. Live section selection wins when present and still exists. Same-style
  //    references are still augmented with the previous instruction so the
  //    planner understands "make it the same style".
  if (input.selectedSectionId) {
    const exists = pages
      .flatMap((p) => p.sections)
      .some((s) => s.id === input.selectedSectionId);
    if (exists) {
      const pageId = pages.find((p) => p.sections.some((s) => s.id === input.selectedSectionId))?.id;
      if (pageId) {
        return {
          scope: { type: "section", pageId, sectionId: input.selectedSectionId },
          instruction: augment(instruction),
          resolvedFromConversation: false,
        };
      }
    }
  }

  // 3. The last plan/applied message targeted a section and it still exists.
  if (last?.sectionId && last.scope?.type === "section") {
    const exists = pages.flatMap((p) => p.sections).some((s) => s.id === last.sectionId);
    if (exists) {
      const pageId = last.scope.pageId;
      const pageStillExists = pages.some((p) => p.id === pageId);
      if (pageStillExists) {
        return {
          scope: { type: "section", pageId, sectionId: last.sectionId },
          instruction: augment(instruction),
          resolvedFromConversation: true,
        };
      }
    }
  }

  // 4. The last plan/applied message targeted a page and it still exists.
  if (last?.scope?.type === "page" && last.pageId) {
    if (pages.some((p) => p.id === last.pageId)) {
      return {
        scope: { type: "page", pageId: last.pageId },
        instruction: augment(instruction),
        resolvedFromConversation: true,
      };
    }
  }

  // 5. Project scope.
  return { scope: { type: "project" }, instruction, resolvedFromConversation: false };
}

/**
 * When a follow-up references the previous change ("same", "like that"),
 * append the previous instruction so both providers can honor the intent.
 */
function augmentSameReference(instruction: string, last: LastPlanContext): string {
  if (!SAME_REFERENCE_RE.test(instruction)) return instruction;
  const reference = last.instruction ?? "";
  const trimmed = reference.replace(/^(I prepared|Applied)\s+.*/, "").trim();
  const previous = trimmed && trimmed !== instruction ? trimmed : "the previous change";
  return `${instruction} (Apply the same kind of change as before: ${previous})`;
}

// ---------------------------------------------------------------------------
// Instruction hygiene (shared with the service)
// ---------------------------------------------------------------------------

/** Trim + cap the instruction before it is sent anywhere. */
export function sanitizeInstruction(raw: string, max = 3000): string {
  const trimmed = raw.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}
