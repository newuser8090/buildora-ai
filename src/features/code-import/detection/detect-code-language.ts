// ---------------------------------------------------------------------------
// Language detection (Phase P1)
//
// Deterministic, pattern-based classification. The language hint may guide
// detection (confidence boost / weak-signal fallback) but can never override
// impossible input silently: strong contradicting signals always win.
// ---------------------------------------------------------------------------

import type {
  CodeLanguageDetection,
  ImportedCodeLanguage,
} from "../types";

export interface DetectCodeLanguageOptions {
  hint?: ImportedCodeLanguage;
}

// ---------------------------------------------------------------------------
// Signal regexes (all deterministic, no shared mutable state)
// ---------------------------------------------------------------------------

// All detection regexes MUST carry the /g flag so countMatches() advances
// lastIndex; a non-global regex that matches would loop forever.
const HTML_DOCUMENT = [
  /^\s*<!doctype\s+html/gi,
  /<html[\s>]/gi,
  /<head[\s>]/gi,
  /<body[\s>]/gi,
  /<\/html>/gi,
];

const HTML_TAG = /<(?:div|span|p|h[1-6]|section|article|header|footer|nav|main|aside|ul|ol|li|table|thead|tbody|tr|td|th|form|input|button|img|a|br|hr|blockquote|figure|figcaption|strong|em|b|i|u|small|code|pre|label|select|option|textarea|video|audio|picture|link|meta|title|script|style)\b/gi;

const HTML_ATTR = /\b(?:class|href|src|id)="[^"]*"/gi;

// JSX-only signals ----------------------------------------------------------

const JSX_CLASSNAME = /\bclassName\s*=/g;
const JSX_STYLE_OBJECT = /\bstyle\s*=\s*\{\{/g;
const JSX_FRAGMENT = /<>\s*<\/>|<\/?Fragment[\s>]/g;
const JSX_COMPONENT = /<\/?[A-Z][A-Za-z0-9]*[\s>/]/g;
// Expression inside an opening tag: <div data-x={foo} />.
const JSX_EXPRESSION = /<\s*\/?[A-Za-z][^>]*?\{[^{}]*\}/g;
// Expression in children: <div>{items.map(...)}</div>.
const JSX_CHILDREN = />\s*\{[^{}]*\}/g;
const JSX_HANDLER = /\son[A-Z]\w*\s*=\s*\{/g;
// JSX context: a tag right after return(/=> — unique to JSX source files.
const JSX_RETURN = /return\s*\(?\s*<\/?[A-Za-z][\w.-]*/g;
const JSX_ARROW = /=>\s*\(?\s*<\/?[A-Za-z][\w.-]*/g;

// TypeScript / React-component signals --------------------------------------

const TS_ANNOTATION = /\b(?:interface|type|enum|namespace)\s+\w+|:\s*(?:string|number|boolean|void|React\.FC|React\.ReactNode)\b/g;
const TS_GENERIC_ARROW = /<\s*[A-Z]\w*(\s*,\s*[A-Z]\w*)*\s*>\s*\(/g;

const REACT_FUNCTION = /\bfunction\s+[A-Z]\w*\s*\([^)]*\)\s*\{/g;
const REACT_ARROW = /\bconst\s+[A-Z]\w*\s*=\s*(?:\([^)]*\)|[A-Za-z]\w*)?\s*=>/g;

// CSS signals ---------------------------------------------------------------

// Selector characters exclude {, } and : so no pathologically slow
// backtracking can occur on large inputs.
const CSS_RULE = /(?:^|[\r\n])\s*[.#]?[A-Za-z_][^{}:;]*\s*\{[^{}]*:[^;{}]*;?[^{}]*\}/gm;
const CSS_AT_RULE = /@(?:media|keyframes|supports|import|font-face|layer|container)\b/g;
const CSS_PROPERTY = /(?:^|[\r\n;])\s*[a-z-]+\s*:\s*[^;{}]+;/gm;

function countMatches(source: string, regex: RegExp): number {
  if (!regex.global) {
    // Non-global regexes never advance; treat them as a single test.
    regex.lastIndex = 0;
    return regex.test(source) ? 1 : 0;
  }
  regex.lastIndex = 0;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    count += 1;
    if (regex.lastIndex === match.index) regex.lastIndex += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

interface Scores {
  html: number;
  jsx: number;
  tsx: number;
  react: number;
  css: number;
}

function scoreSource(source: string): Scores {
  const htmlTags = countMatches(source, HTML_TAG);
  const htmlAttrs = countMatches(source, HTML_ATTR);
  const htmlDocument = HTML_DOCUMENT.reduce(
    (acc, regex) => acc + countMatches(source, regex),
    0,
  );

  const jsx =
    countMatches(source, JSX_CLASSNAME) * 2 +
    countMatches(source, JSX_STYLE_OBJECT) * 2 +
    countMatches(source, JSX_FRAGMENT) * 2 +
    countMatches(source, JSX_COMPONENT) * 2 +
    countMatches(source, JSX_EXPRESSION) +
    countMatches(source, JSX_CHILDREN) +
    countMatches(source, JSX_HANDLER) * 2 +
    countMatches(source, JSX_RETURN) +
    countMatches(source, JSX_ARROW);

  const ts = countMatches(source, TS_ANNOTATION) + countMatches(source, TS_GENERIC_ARROW);
  const react =
    countMatches(source, REACT_FUNCTION) + countMatches(source, REACT_ARROW);

  const cssRules = countMatches(source, CSS_RULE);
  const cssAt = countMatches(source, CSS_AT_RULE);
  const cssProps = countMatches(source, CSS_PROPERTY);

  const html =
    htmlTags * 2 + htmlAttrs + htmlDocument * 3;
  const css = cssRules * 3 + cssAt * 2 + cssProps;

  return {
    html,
    jsx,
    tsx: jsx > 0 && ts > 0 ? jsx + ts : 0,
    react: jsx > 0 && react > 0 ? jsx + react * 3 : 0,
    css,
  };
}

function confidenceFor(
  language: ImportedCodeLanguage,
  scores: Scores,
): "high" | "medium" | "low" {
  switch (language) {
    case "html":
      return scores.html >= 4 ? "high" : scores.html >= 2 ? "medium" : "low";
    case "tsx":
    case "react":
    case "jsx":
      return scores.jsx >= 6 ? "high" : scores.jsx >= 2 ? "medium" : "low";
    case "css":
      return scores.css >= 4 ? "high" : scores.css >= 1 ? "medium" : "low";
    default:
      return "low";
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function detectCodeLanguage(
  source: string,
  options: DetectCodeLanguageOptions = {},
): CodeLanguageDetection {
  const reasons: string[] = [];
  const trimmed = source.trim();

  if (trimmed.length === 0) {
    return {
      language: "unknown",
      confidence: "low",
      reasons: ["empty-input"],
    };
  }

  const scores = scoreSource(trimmed);
  const hasMarkup = scores.html > 0 || scores.jsx > 0;

  let language: ImportedCodeLanguage;
  let confidence: "high" | "medium" | "low";

  if (scores.html > 0 && scores.jsx === 0) {
    language = "html";
    reasons.push("html-tags-or-document-structure-detected");
  } else if (scores.jsx > 0) {
    if (scores.tsx > 0) {
      language = "tsx";
      reasons.push("jsx-plus-typescript-annotations-detected");
    } else if (scores.react > 0) {
      language = "react";
      reasons.push("static-react-function-component-detected");
    } else {
      language = "jsx";
      reasons.push("jsx-markup-detected");
    }
  } else if (scores.css > 0 && !hasMarkup) {
    language = "css";
    reasons.push("css-rule-or-property-declarations-detected");
  } else {
    language = "unknown";
    reasons.push("no-recognizable-markup-or-css");
  }

  confidence = confidenceFor(language, scores);

  // -------------------------------------------------------------------------
  // Hint handling: guides but never silently overrides impossible input.
  // -------------------------------------------------------------------------
  const hint = options.hint;
  if (hint && hint !== "unknown") {
    if (hint === language) {
      reasons.push(`language-hint-${hint}-confirmed`);
      if (confidence === "low") confidence = "medium";
      else if (confidence === "medium") confidence = "high";
    } else if (language === "unknown") {
      // Weak-signal fallback: only honour the hint when the source shows at
      // least one signal for that language family.
      const hintSignals =
        hint === "html"
          ? scores.html
          : hint === "css"
            ? scores.css
            : hint === "tsx"
              ? scores.tsx
              : hint === "react"
                ? scores.react
                : scores.jsx;
      if (hintSignals > 0) {
        language = hint;
        confidence = "low";
        reasons.push(`language-hint-${hint}-applied-with-low-confidence`);
      } else {
        reasons.push(`language-hint-${hint}-ignored-no-signals`);
      }
    } else {
      reasons.push(`language-hint-${hint}-overridden-by-strong-signals`);
    }
  }

  return { language, confidence, reasons };
}
