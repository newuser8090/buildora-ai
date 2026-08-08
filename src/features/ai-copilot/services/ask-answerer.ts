// ---------------------------------------------------------------------------
// AI Copilot — ASK/EXPLAIN answerer (Phase P10, spec §11)
//
// Deterministic, client-side answers built ONLY from the bounded context and
// the deterministic readiness engine. Question responses never create editor
// history entries and never call a provider.
//
// Truthfulness: when the Copilot cannot answer from context, it says so and
// offers what it CAN do (readiness review, a draft, or a plan).
// ---------------------------------------------------------------------------

import type { CopilotContext } from "../context/context-builder";

// ---------------------------------------------------------------------------
// Small glossary — plain-language definitions for common website terms
// ---------------------------------------------------------------------------

const GLOSSARY: Array<{ keys: string[]; answer: string }> = [
  {
    keys: ["canonical url", "canonical"],
    answer:
      "A canonical URL is the \"official\" address for a page. If the same page could be reached at more than one address, the canonical URL tells search engines which one to treat as the real one, so your site isn't counted twice in search results.",
  },
  {
    keys: ["seo", "search engine", "google title", "meta description", "meta title", "description", "google"],
    answer:
      "SEO (search engine optimization) is about helping your site appear in search results. The two most important pieces are the search title (the headline shown in results) and the description (the short summary under it). Buildora checks both in the Launch Center.",
  },
  {
    keys: ["cta", "call to action", "button"],
    answer:
      "A call-to-action (CTA) is a button that invites a visitor to take the next step — like \"Start free\", \"Contact us\", or \"Buy now\". A clear CTA helps visitors know what to do, which is why Buildora suggests one on every page.",
  },
  {
    keys: ["favicon", "site icon", "icon"],
    answer:
      "A site icon (favicon) is the small square image shown in browser tabs and bookmarks. It makes your site look finished. You can add one in Site settings.",
  },
  {
    keys: ["hero", "hero section"],
    answer:
      "The hero is the first section visitors see at the top of a page. It usually has a headline, a short description, and a button. It sets the tone for the whole page, so it's worth making it clear and focused.",
  },
  {
    keys: ["responsive", "mobile", "phone view"],
    answer:
      "Responsive means a page automatically adjusts to fit any screen — phone, tablet, or desktop. Buildora's phone preview lets you check that nothing gets cut off or forces sideways scrolling.",
  },
  {
    keys: ["footer", "header", "menu", "nav"],
    answer:
      "The header is the top strip with your logo and menu. The footer is the strip at the bottom with links and copyright text. Together they help visitors find their way around and give your site a finished feel.",
  },
  {
    keys: ["placeholder", "lorem", "dummy"],
    answer:
      "Placeholder text is draft copy like \"lorem ipsum\" or \"Your text here\". Visitors can tell a page is unfinished when they see it, so Buildora's readiness check flags it. I can draft a plan to replace it with real content.",
  },
  {
    keys: ["noindex", "index", "hidden from search"],
    answer:
      "If a site is set to \"hidden from search engines\" (noindex), search engines are told not to list it. That's useful during building, but before launch you'll want it switched back on in Site settings → Search & sharing.",
  },
  {
    keys: ["load", "slow", "performance", "image size"],
    answer:
      "Large images are the most common cause of slow pages. Keeping images under about 2 MB each helps your site feel fast, especially on phones. Buildora's readiness check flags oversized images.",
  },
];

// ---------------------------------------------------------------------------
// Section-type advice
// ---------------------------------------------------------------------------

const SECTION_ADVICE: Record<string, string> = {
  hero: "A hero should answer three things in one glance: who you are, what you offer, and what you want the visitor to do next. Keep the headline short, add one supporting line, and give it a clear button.",
  features:
    "List the 3–6 things your product or service does best. Each one needs a short title and a one-line explanation of the benefit — not just what it is, but why the visitor should care.",
  pricing:
    "Keep plans simple: name, price, and the most important features. Highlight the plan most visitors should choose. Make the price easy to compare at a glance.",
  faq: "Answer the questions customers actually ask before buying: pricing, setup, security, and what happens after a trial. Two to five clear answers are plenty.",
  cta: "A call-to-action section should repeat the core offer with one button. Keep the headline short and make the action unmistakable.",
  header: "Keep the menu to your most important pages — four to six links is plenty. Make sure the logo links home.",
  footer: "The footer should hold contact details, copyright, and links visitors may look for at the bottom: privacy, terms, and social profiles.",
};

// ---------------------------------------------------------------------------
// Page overview builder
// ---------------------------------------------------------------------------

function buildPageOverview(context: CopilotContext): string | null {
  const page = context.activePage;
  if (!page) return null;
  const sectionNames = page.sections
    .map((s) => s.type.charAt(0).toUpperCase() + s.type.slice(1))
    .join(", ");
  const headline = page.sections.find((s) => s.type === "hero")?.headline;
  const lines: string[] = [];
  lines.push(
    `"${page.title}" has ${page.sectionCount} section${page.sectionCount === 1 ? "" : "s"}${
      sectionNames ? `: ${sectionNames}` : ""
    }.`,
  );
  if (headline) lines.push(`Its main headline is: “${headline}”.`);
  if (page.meta?.description) {
    lines.push(`It has a search description: “${page.meta.description}”.`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Readiness interpretation
// ---------------------------------------------------------------------------

function buildReadinessAnswer(context: CopilotContext): string {
  const readiness = context.readiness;
  if (!readiness) {
    return "I can't see a readiness result for this page right now — open the Launch Center to run the checks, or ask me to check the page.";
  }
  const lines: string[] = [];
  lines.push(
    `Buildora's checks give this site a readiness score of ${readiness.score} out of 100.`,
  );
  if (readiness.topFindings.length > 0) {
    lines.push("Here's what's worth looking at:");
    for (const finding of readiness.topFindings) {
      lines.push(`- ${finding.title}`);
    }
    lines.push(
      "I can explain any of these, draft better text, or prepare a plan to fix them — just ask.",
    );
  } else {
    lines.push("No obvious problems were found by the automated checks.");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main answerer
// ---------------------------------------------------------------------------

export interface AskResult {
  answer: string;
  /** Optional plan instruction the user may trigger ("Draft a fix"). */
  planInstruction?: string;
}

/**
 * Answer a question deterministically from the bounded context.
 * Returns null when the question is definitional but not answerable here.
 */
export function answerQuestion(instruction: string, context: CopilotContext): AskResult {
  const text = instruction.trim().toLowerCase();

  // 0. CTA clarity — checked BEFORE the glossary so "Is this CTA clear?" gets
  //    the specific, actionable answer (with a plan offer) instead of the
  //    generic glossary definition.
  if (/(cta|button|call to action).*(clear|good|work|strong|readable)/.test(text)) {
    const section = context.section;
    if (section) {
      return {
        answer: `Looking at this ${section.type} section, a clear call-to-action says exactly what happens next (for example “Start free trial” instead of “Learn more”). I can prepare a plan to sharpen the button text — just ask.`,
        planInstruction: "Make the primary call-to-action clearer and more action-oriented. Keep the destination the same.",
      };
    }
  }

  // 1. Glossary / definitions.
  const glossaryMatch = GLOSSARY.find((entry) =>
    entry.keys.some((key) => text.includes(key)),
  );
  if (glossaryMatch) {
    return { answer: glossaryMatch.answer };
  }

  // 2. Section advice.
  const sectionType = context.section?.type;
  if (sectionType && SECTION_ADVICE[sectionType]) {
    const advice = SECTION_ADVICE[sectionType];
    if (/(what should|what to put|what do i put|advice|suggest|ideas? for)/.test(text)) {
      return { answer: advice };
    }
  }

  // 3. "What's on this page" / overview.
  if (/(what.*(on|about) (this|the) page|page.*about|overview|what does this page|tell me about)/.test(text)) {
    const overview = buildPageOverview(context);
    if (overview) return { answer: overview };
  }

  // 4. Crowded / too much content (page feel).
  if (/(crowd|too much|busy|cluttered|overwhelm|too long|feel)/.test(text)) {
    const page = context.activePage;
    if (page) {
      const bodySections = page.sections.filter((s) => s.type !== "header" && s.type !== "footer").length;
      const hint =
        bodySections > 6
          ? `This page has ${page.sectionCount} sections, which is more than most pages need. Visitors can feel overwhelmed when there's too much to scan.`
          : `This page has ${page.sectionCount} sections. The feeling of being crowded usually comes from dense text or too many options — trimming copy and keeping one clear action per section helps a lot.`;
      return {
        answer: `${hint}\n\nI can prepare a plan to shorten sections or simplify the page — just ask.`,
        planInstruction: "Simplify this page and make it easier to scan. Keep all links and prices the same.",
      };
    }
  }

  // 5. Readiness questions (also caught by the intent classifier; kept here
  //    so follow-up questions phrased differently still get a useful answer).
  if (/(ready|score|check|problem|issue|fix)/.test(text)) {
    return { answer: buildReadinessAnswer(context) };
  }

  // 7. Honest fallback.
  return {
    answer:
      "I can't answer that from your site, and I'd rather not guess. I can help you in other ways: ask me to check this page for problems, explain a launch-readiness finding, or prepare an edit plan (for example “make this page more premium”).",
  };
}

/**
 * Answer used by the "Check this page for obvious problems" starter prompt.
 */
export function buildReadinessReview(context: CopilotContext): AskResult {
  return { answer: buildReadinessAnswer(context) };
}
