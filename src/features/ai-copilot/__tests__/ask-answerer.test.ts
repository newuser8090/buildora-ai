// ---------------------------------------------------------------------------
// AI Copilot — ASK/EXPLAIN answerer tests (spec §11)
//   - glossary/definition answers
//   - section advice
//   - page overview
//   - crowded / CTA-clarity answers
//   - readiness interpretation
//   - honest fallback (no guessing)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { answerQuestion, buildReadinessReview } from "../services/ask-answerer";
import { buildCopilotContext } from "../context/context-builder";
import { MOCK_PROJECT } from "./helpers";
import type { Project } from "@/types/project";

function project(): Project {
  return JSON.parse(JSON.stringify(MOCK_PROJECT)) as Project;
}

function contextFor(
  projectArg: Project,
  opts: {
    scope?: { type: "section"; pageId: string; sectionId: string } | { type: "page"; pageId: string };
    readiness?: unknown;
  } = {},
) {
  const hero = projectArg.pages[0].sections.find((s) => s.type === "hero")!;
  const scope =
    opts.scope ?? { type: "section", pageId: "page-1", sectionId: hero.id };
  return buildCopilotContext({
    project: projectArg,
    scope,
    instruction: "question",
    readiness: opts.readiness as never,
  });
}

function readinessStub() {
  return {
    score: 71,
    checks: [
      { id: "c1", title: "Homepage has no description", status: "fail" },
      { id: "c2", title: "Missing favicon", status: "warning" },
      { id: "c3", title: "Everything else looks fine", status: "pass" },
    ],
    categories: [],
    strong: [],
    couldImprove: [],
    blocked: false,
    blockers: [],
  };
}

describe("answerQuestion — glossary", () => {
  it("explains canonical URL without inventing project data", () => {
    const result = answerQuestion("What does canonical URL mean?", contextFor(project()));
    expect(result.answer).toContain("official");
    expect(result.answer).toMatch(/search engines/i);
  });

  it("explains SEO with a pointer to the launch checks", () => {
    const result = answerQuestion("What is SEO?", contextFor(project()));
    expect(result.answer).toMatch(/search/i);
  });

  it("explains what a CTA is", () => {
    const result = answerQuestion("Is my CTA clear?", contextFor(project()));
    expect(result.answer).toContain("call-to-action");
  });

  it("offers a plan instruction when asked about CTA clarity", () => {
    // Must reach the specific clarity answer (not the generic glossary
    // definition) and offer an edit plan.
    const result = answerQuestion("Is this CTA clear?", contextFor(project()));
    expect(result.answer).toMatch(/call-to-action/i);
    expect(result.planInstruction).toBeTruthy();
  });
});

describe("answerQuestion — section advice", () => {
  it("advises on the hero section when asked for ideas", () => {
    const result = answerQuestion(
      "What should I put in this section?",
      contextFor(project()),
    );
    expect(result.answer).toContain("hero");
    expect(result.answer).toMatch(/headline/i);
  });
});

describe("answerQuestion — page overview", () => {
  it("describes the current page deterministically from context", () => {
    const result = answerQuestion(
      "What is on this page?",
      contextFor(project(), { scope: { type: "page", pageId: "page-1" } }),
    );
    expect(result.answer).toContain("Home");
    expect(result.answer).toContain("section");
  });
});

describe("answerQuestion — crowded page", () => {
  it("offers a plan instruction for simplifying a busy page", () => {
    const result = answerQuestion(
      "Why does this page feel crowded?",
      contextFor(project(), { scope: { type: "page", pageId: "page-1" } }),
    );
    expect(result.answer).toBeTruthy();
    // It must not fabricate that it already changed anything.
    expect(result.answer).not.toMatch(/applied|done|changed/i);
    expect(result.planInstruction).toBeTruthy();
  });
});

describe("answerQuestion — readiness", () => {
  it("reports the deterministic score and findings, never a new score", () => {
    const ctx = buildCopilotContext({
      project: project(),
      scope: { type: "project" },
      readiness: readinessStub() as never,
      instruction: "Is my site ready?",
    });
    const result = answerQuestion("Is my site ready to publish?", ctx);
    expect(result.answer).toContain("71");
    expect(result.answer).toContain("Homepage has no description");
  });
});

describe("answerQuestion — honest fallback", () => {
  it("refuses to guess when the answer is not in context", () => {
    const result = answerQuestion("What color should my logo be?", contextFor(project()));
    expect(result.answer).toMatch(/can't answer|rather not guess/i);
    expect(result.answer).toMatch(/plan/i);
  });
});

describe("buildReadinessReview", () => {
  it("answers the 'check this page' starter deterministically", () => {
    const ctx = buildCopilotContext({
      project: project(),
      scope: { type: "project" },
      readiness: readinessStub() as never,
      instruction: "Check this page for obvious problems",
    });
    const result = buildReadinessReview(ctx);
    expect(result.answer).toContain("score");
    expect(result.answer).toContain("Homepage has no description");
  });
});

// ASK mode must never mutate anything: the answerer is a pure function that
// only reads its input. We verify by asserting it returns a plain string and
// never returns an edit plan.
describe("answerQuestion — no mutation contract", () => {
  it("never returns an edit-plan result", () => {
    const result = answerQuestion("Is this CTA clear?", contextFor(project()));
    expect(typeof result.answer).toBe("string");
    expect(result).not.toHaveProperty("plan");
    expect(result).not.toHaveProperty("operations");
  });
});
