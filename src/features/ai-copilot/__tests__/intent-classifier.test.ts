// ---------------------------------------------------------------------------
// AI Copilot — intent classifier tests (spec §11: ASK vs EDIT)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { classifyCopilotIntent } from "../services/intent-classifier";

describe("classifyCopilotIntent", () => {
  it("classifies questions ending with '?' as ask", () => {
    expect(classifyCopilotIntent("Why does this page feel crowded?").kind).toBe("ask");
    expect(classifyCopilotIntent("Is this CTA clear?").kind).toBe("ask");
    expect(classifyCopilotIntent("Should I add a pricing section?").kind).toBe("ask");
  });

  it("classifies question starters as ask even without a question mark", () => {
    expect(classifyCopilotIntent("what should I put in this section").kind).toBe("ask");
    expect(classifyCopilotIntent("explain what a canonical URL is").kind).toBe("ask");
    expect(classifyCopilotIntent("how do I improve the mobile layout").kind).toBe("ask");
  });

  it("classifies explain/definition phrases as ask", () => {
    expect(classifyCopilotIntent("What does canonical URL mean").kind).toBe("ask");
    expect(classifyCopilotIntent("tell me the meaning of SEO").kind).toBe("ask");
  });

  it("classifies explicit site-check requests as readiness-review", () => {
    expect(classifyCopilotIntent("Check this page for obvious problems").kind).toBe("readiness-review");
    expect(classifyCopilotIntent("Are there any problems with my website?").kind).toBe("readiness-review");
    expect(classifyCopilotIntent("Is my site ready to publish?").kind).toBe("readiness-review");
  });

  it("classifies edit commands as plan-edit", () => {
    expect(classifyCopilotIntent("Make this page feel more premium").kind).toBe("plan-edit");
    expect(classifyCopilotIntent("Rewrite the hero for a SaaS product").kind).toBe("plan-edit");
    expect(classifyCopilotIntent("Add a testimonials section below pricing").kind).toBe("plan-edit");
    expect(classifyCopilotIntent("Make the hero shorter").kind).toBe("plan-edit");
    expect(classifyCopilotIntent("Improve the call to action").kind).toBe("plan-edit");
  });

  it("edit commands win even when phrased like a sentence", () => {
    // "Make it shorter" is an edit, not a question.
    expect(classifyCopilotIntent("Make it shorter").kind).toBe("plan-edit");
    expect(classifyCopilotIntent("Improve the cta").kind).toBe("plan-edit");
  });

  it("empty input falls back to plan-edit (never crashes)", () => {
    expect(classifyCopilotIntent("").kind).toBe("plan-edit");
    expect(classifyCopilotIntent("   ").kind).toBe("plan-edit");
  });
});
