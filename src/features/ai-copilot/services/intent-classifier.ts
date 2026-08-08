// ---------------------------------------------------------------------------
// AI Copilot — deterministic intent classifier (Phase P10, spec §11)
//
// Distinguishes ASK/EXPLAIN from EDIT using plain-language heuristics only.
// No provider call, no ML. When intent is ambiguous and a mutation could be
// destructive, the caller prefers explanation over mutation.
//
// Quick actions are explicit buttons and bypass this classifier.
// ---------------------------------------------------------------------------

export type CopilotIntent =
  | { kind: "ask" }
  | { kind: "plan-edit" }
  | { kind: "readiness-review" };

// Question starters (question mark is the strongest signal).
const QUESTION_STARTERS = [
  "what",
  "why",
  "how",
  "when",
  "where",
  "who",
  "which",
  "is",
  "are",
  "can",
  "could",
  "should",
  "does",
  "do i",
  "do you",
  "explain",
  "tell me",
  "help me understand",
  "what does",
  "what is",
  "what's",
  "meaning of",
];

const EXPLAIN_PHRASES = [
  "what does",
  "what is",
  "what's",
  "meaning",
  "explain",
  "definition",
  "why does",
  "why is",
  "how do",
  "how does",
  "how to",
  "is it",
  "is this",
  "does this",
  "should i",
  "should we",
  "can you",
];

const READINESS_PHRASES = [
  "check this page",
  "check the page",
  "check my page",
  "check this website",
  "check my website",
  "any problems",
  "any issues",
  "anything wrong",
  "obvious problems",
  "is this ready",
  "is my site ready",
  "is my website ready",
  "review this page",
  "review my page",
  "review this website",
  "review my website",
  "how ready",
  "what should i fix",
  "is my page ready",
];

const EDIT_EXCLUSIONS = [
  "make it shorter",
  "make this shorter",
  "make it longer",
  "make this longer",
  "rewrite",
  "improve the call to action",
  "improve the cta",
];

/**
 * Classify a Copilot instruction. Returns "ask" for questions and review
 * requests, "readiness-review" for explicit site-check requests, and
 * "plan-edit" otherwise.
 */
export function classifyCopilotIntent(instruction: string): CopilotIntent {
  const text = instruction.trim().toLowerCase();

  if (!text) return { kind: "plan-edit" };

  // Explicit edit commands always win even when phrased as a sentence.
  if (EDIT_EXCLUSIONS.some((p) => text.includes(p))) return { kind: "plan-edit" };

  // Readiness review is an ASK-style action over the deterministic engine.
  if (READINESS_PHRASES.some((p) => text.includes(p))) return { kind: "readiness-review" };

  const endsWithQuestion = text.endsWith("?");
  const startsWithQuestion = QUESTION_STARTERS.some((starter) =>
    new RegExp(`^${starter}\\b`).test(text),
  );
  const containsExplain = EXPLAIN_PHRASES.some((phrase) => text.includes(phrase));

  if (endsWithQuestion || startsWithQuestion || containsExplain) {
    return { kind: "ask" };
  }

  return { kind: "plan-edit" };
}
