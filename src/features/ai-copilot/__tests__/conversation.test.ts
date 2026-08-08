// ---------------------------------------------------------------------------
// AI Copilot — conversation model tests (spec §5, §10)
//   - bounded retention (oldest pairs trimmed)
//   - clear conversation
//   - follow-up target resolution (page refs, live selection, last plan)
//   - instruction sanitization (trim + cap)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  MAX_MESSAGES,
  trimConversation,
  emptyConversation,
  findLastPlanContext,
  resolveFollowUpTarget,
  sanitizeInstruction,
} from "../conversation/conversation";
import { MOCK_PROJECT } from "./helpers";
import type { Project } from "@/types/project";
import type { AiEditScope } from "@/features/ai-editing/plan-types";
import type { CopilotMessage } from "../types";

function cloneProject(): Project {
  return JSON.parse(JSON.stringify(MOCK_PROJECT)) as Project;
}

function message(
  role: CopilotMessage["role"],
  content: string,
  overrides: Partial<CopilotMessage> = {},
): CopilotMessage {
  return {
    id: `m-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    createdAt: Date.now(),
    status: "complete",
    ...overrides,
  };
}

function editPlanMessage(content: string, scope: AiEditScope, opLabels: string[]): CopilotMessage {
  return message("assistant", content, {
    kind: "edit-plan",
    metadata: {
      scope,
      pageId: scope.type === "page" ? scope.pageId : scope.type === "section" ? scope.pageId : undefined,
      sectionId: scope.type === "section" ? scope.sectionId : undefined,
      opLabels,
    },
  });
}

/** A copy of the mock project with an extra "About" page added. */
function projectWithAboutPage(): Project {
  const project = cloneProject();
  project.pages = [
    ...project.pages,
    {
      id: "page-2",
      title: "About",
      slug: "/about",
      sections: [
        {
          id: "s-about-hero",
          type: "hero",
          order: 1,
          visible: true,
          props: { headline: "About us", subheadline: "We make things." },
          styles: {},
        },
      ],
    },
  ];
  return project;
}

describe("trimConversation — bounded retention", () => {
  it("keeps messages under the bound untouched", () => {
    const messages = Array.from({ length: MAX_MESSAGES }, (_, i) =>
      message("user", `m${i}`),
    );
    expect(trimConversation(messages)).toHaveLength(MAX_MESSAGES);
  });

  it("drops the oldest user/assistant pair when over the bound", () => {
    const messages = [
      message("user", "first"),
      message("assistant", "first reply"),
      ...Array.from({ length: MAX_MESSAGES }, (_, i) =>
        i % 2 === 0 ? message("user", `later-${i}`) : message("assistant", `later-reply-${i}`),
      ),
    ];
    const trimmed = trimConversation(messages);
    expect(trimmed.length).toBeLessThanOrEqual(MAX_MESSAGES);
    // The oldest pair (user "first") is gone.
    expect(trimmed.some((m) => m.content === "first")).toBe(false);
  });
});

describe("emptyConversation", () => {
  it("returns an empty list (new conversation)", () => {
    expect(emptyConversation()).toEqual([]);
  });
});

describe("findLastPlanContext", () => {
  it("returns the most recent edit-plan message's target", () => {
    const messages = [
      message("user", "rewrite"),
      editPlanMessage("Plan A", { type: "section", pageId: "page-1", sectionId: "s-hero" }, ["Hero rewritten"]),
      message("user", "shorter"),
      editPlanMessage("Plan B", { type: "page", pageId: "page-1" }, ["Hero shortened"]),
    ];
    const last = findLastPlanContext(messages);
    expect(last?.scope).toEqual({ type: "page", pageId: "page-1" });
    expect(last?.opLabels).toEqual(["Hero shortened"]);
  });

  it("returns null when no edit-plan/applied message exists", () => {
    expect(findLastPlanContext([message("user", "hi"), message("assistant", "hello")])).toBeNull();
  });

  it("ignores question messages", () => {
    const messages = [
      message("assistant", "what should I put here?", { kind: "question" }),
    ];
    expect(findLastPlanContext(messages)).toBeNull();
  });
});

describe("resolveFollowUpTarget", () => {
  const project = projectWithAboutPage();

  it("resolves an explicit page reference ('on the About page')", () => {
    const result = resolveFollowUpTarget({
      instruction: "do the same on the About page",
      project,
      messages: [],
    });
    expect(result.scope).toEqual({ type: "page", pageId: "page-2" });
    expect(result.resolvedFromConversation).toBe(false);
  });

  it("resolves 'homepage' to the first page", () => {
    const result = resolveFollowUpTarget({
      instruction: "make the homepage more premium",
      project,
      messages: [],
    });
    expect(result.scope).toEqual({ type: "page", pageId: "page-1" });
  });

  it("prefers live section selection over the conversation target", () => {
    const messages = [
      editPlanMessage("Plan A", { type: "section", pageId: "page-1", sectionId: "s-hero" }, []),
    ];
    const result = resolveFollowUpTarget({
      instruction: "make it shorter",
      project,
      selectedSectionId: "s-pricing",
      messages,
    });
    expect(result.scope).toEqual({ type: "section", pageId: "page-1", sectionId: "s-pricing" });
    expect(result.resolvedFromConversation).toBe(false);
  });

  it("falls back to the last plan's section when it still exists", () => {
    const messages = [
      editPlanMessage("Plan A", { type: "section", pageId: "page-1", sectionId: "s-hero" }, []),
    ];
    const result = resolveFollowUpTarget({
      instruction: "make it shorter",
      project,
      messages,
    });
    expect(result.scope).toEqual({ type: "section", pageId: "page-1", sectionId: "s-hero" });
    expect(result.resolvedFromConversation).toBe(true);
  });

  it("does NOT reuse a last-plan section that no longer exists", () => {
    const messages = [
      editPlanMessage("Plan A", { type: "section", pageId: "page-1", sectionId: "s-deleted" }, []),
    ];
    const result = resolveFollowUpTarget({
      instruction: "make it shorter",
      project,
      messages,
    });
    // Falls through to project scope.
    expect(result.scope.type).toBe("project");
  });

  it("falls back to the last plan's page when it still exists", () => {
    const messages = [
      editPlanMessage("Plan A", { type: "page", pageId: "page-1" }, []),
    ];
    const result = resolveFollowUpTarget({
      instruction: "keep the headline but change the button",
      project,
      messages,
    });
    expect(result.scope).toEqual({ type: "page", pageId: "page-1" });
    expect(result.resolvedFromConversation).toBe(true);
  });

  it("augments 'same' references with the previous instruction", () => {
    const messages = [
      editPlanMessage(
        "I prepared 2 proposed changes.",
        { type: "page", pageId: "page-1" },
        ["Hero rewritten", "CTA updated"],
      ),
    ];
    const result = resolveFollowUpTarget({
      instruction: "do the same on the About page",
      project,
      messages,
    });
    expect(result.scope).toEqual({ type: "page", pageId: "page-2" });
    // Explicit page ref does not need augmentation.
    expect(result.instruction).toBe("do the same on the About page");

    const same = resolveFollowUpTarget({
      instruction: "make it the same style",
      project,
      selectedSectionId: "s-hero",
      messages,
    });
    expect(same.instruction).toContain("same kind of change");
  });

  it("defaults to project scope when nothing matches", () => {
    const result = resolveFollowUpTarget({
      instruction: "improve the mobile layout",
      project,
      messages: [message("assistant", "hi", { kind: "question" })],
    });
    expect(result.scope).toEqual({ type: "project" });
  });
});

describe("sanitizeInstruction", () => {
  it("trims surrounding whitespace", () => {
    expect(sanitizeInstruction("  make it shorter  ")).toBe("make it shorter");
  });

  it("caps over-long instructions deterministically", () => {
    const long = "x".repeat(5000);
    const sanitized = sanitizeInstruction(long);
    expect(sanitized.length).toBeLessThanOrEqual(3001);
    expect(sanitized.endsWith("…")).toBe(true);
  });
});
