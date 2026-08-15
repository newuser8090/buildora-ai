// ---------------------------------------------------------------------------
// Element props schemas (Phase P22-A) — typed per-family content validation
//
// Element-specific props are typed THROUGH SCHEMAS (registry-driven), not a
// single universal props interface. Block-derived element types use the
// generic bounded schema; element-only families get typed schemas below.
//
// Every schema validates the RAW record (z.custom, never rebuilt) so
// prototype-pollution keys are rejected at the boundary.
// ---------------------------------------------------------------------------

import { z } from "zod";
import {
  ELEMENT_MAX_LIST_ITEMS,
  ELEMENT_MAX_TEXT_LENGTH,
  isSafeElementPayload,
} from "./element-schemas";

// ---------------------------------------------------------------------------
// Shared guard
// ---------------------------------------------------------------------------

function propsRecord(
  constraint: (record: Record<string, unknown>) => string[],
): z.ZodType<Record<string, unknown>> {
  return z.custom<Record<string, unknown>>(
    (value) => {
      if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value)
      ) {
        return false;
      }
      const record = value as Record<string, unknown>;
      if (!isSafeElementPayload(record)) return false;
      return constraint(record).length === 0;
    },
    { message: "Props failed validation." },
  );
}

const capText = (value: unknown): boolean =>
  typeof value !== "string" || value.length <= ELEMENT_MAX_TEXT_LENGTH;

const optString = (max: number) => (value: unknown): string[] => {
  if (value === undefined || value === null) return [];
  if (typeof value !== "string") return ["Expected a string."];
  if (value.length > max) return [`String exceeds ${max} characters.`];
  return [];
};

// ---------------------------------------------------------------------------
// Generic schema — every block-derived element type (safe bounded record)
// ---------------------------------------------------------------------------

export const GenericElementPropsSchema = propsRecord((record) => {
  const problems: string[] = [];
  if (Object.keys(record).length > 64) {
    problems.push("Too many props.");
  }
  // Internal marker keys (`_bindPath`, `_sectionId`, …) are a documented
  // adapter convention and are stripped at persistence by the existing
  // section adapter — they are allowed here. Safety is enforced by the node
  // schema's boundedRecord (dangerous keys + safe values + text caps).
  for (const value of Object.values(record)) {
    if (!capText(value)) {
      problems.push("A prop exceeds the text limit.");
      break;
    }
  }
  return problems;
});

// ---------------------------------------------------------------------------
// Typed element-only family schemas
// ---------------------------------------------------------------------------

/** Root "section" element — a container that will render as a full-width section. */
export const SectionElementPropsSchema = propsRecord((record) => {
  const problems: string[] = [];
  problems.push(...optString(80)(record.name));
  if (record.sectionType !== undefined && typeof record.sectionType !== "string") {
    problems.push("sectionType must be a string.");
  }
  return problems;
});

/** Rich "text" element — content + semantic format; typography lives in style tokens. */
export const TextElementPropsSchema = propsRecord((record) => {
  const problems: string[] = [];
  if (typeof record.text !== "string" || record.text.length === 0) {
    problems.push("text is required.");
  } else if (record.text.length > ELEMENT_MAX_TEXT_LENGTH) {
    problems.push("text exceeds the text limit.");
  }
  if (
    record.format !== undefined &&
    (typeof record.format !== "string" ||
      !/^(paragraph|h1|h2|h3|h4|h5|h6)$/.test(record.format))
  ) {
    problems.push("format must be paragraph|h1..h6.");
  }
  return problems;
});

/** "logo" element — brand image or text. */
export const LogoElementPropsSchema = propsRecord((record) => {
  const problems: string[] = [];
  problems.push(...optString(2048)(record.src));
  problems.push(...optString(2048)(record.alt));
  problems.push(...optString(80)(record.text));
  return problems;
});

/** "list" element — ordered/unordered list of items. */
export const ListElementPropsSchema = propsRecord((record) => {
  const problems: string[] = [];
  if (
    record.ordered !== undefined &&
    typeof record.ordered !== "boolean"
  ) {
    problems.push("ordered must be a boolean.");
  }
  const items = record.items;
  if (!Array.isArray(items)) {
    problems.push("items must be an array.");
    return problems;
  }
  if (items.length > ELEMENT_MAX_LIST_ITEMS) {
    problems.push(`items exceeds ${ELEMENT_MAX_LIST_ITEMS} entries.`);
  }
  for (const item of items) {
    if (typeof item !== "string" || item.length > ELEMENT_MAX_TEXT_LENGTH) {
      problems.push("Each item must be a bounded string.");
      break;
    }
  }
  return problems;
});

/** "carousel" element — horizontal slide container (data only). */
export const CarouselElementPropsSchema = propsRecord((record) => {
  const problems: string[] = [];
  if (record.autoPlay !== undefined && typeof record.autoPlay !== "boolean") {
    problems.push("autoPlay must be a boolean.");
  }
  if (record.loop !== undefined && typeof record.loop !== "boolean") {
    problems.push("loop must be a boolean.");
  }
  if (
    record.intervalMs !== undefined &&
    (typeof record.intervalMs !== "number" ||
      !Number.isInteger(record.intervalMs) ||
      record.intervalMs < 0 ||
      record.intervalMs > 600_000)
  ) {
    problems.push("intervalMs must be an integer in [0, 600000].");
  }
  return problems;
});

/** "product-card" element — commerce card. */
export const ProductCardElementPropsSchema = propsRecord((record) => {
  const problems: string[] = [];
  problems.push(...optString(80)(record.name));
  problems.push(...optString(64)(record.price));
  problems.push(...optString(16)(record.currency));
  problems.push(...optString(32)(record.badge));
  if (
    record.rating !== undefined &&
    (typeof record.rating !== "number" || record.rating < 0 || record.rating > 5)
  ) {
    problems.push("rating must be a number in [0, 5].");
  }
  return problems;
});

/** "price" element — commerce price display. */
export const PriceElementPropsSchema = propsRecord((record) => {
  const problems: string[] = [];
  problems.push(...optString(64)(record.amount));
  problems.push(...optString(16)(record.currency));
  problems.push(...optString(32)(record.period));
  return problems;
});

/** "custom-component" element — registered advanced component (data driven). */
export const CustomComponentElementPropsSchema = propsRecord((record) => {
  const problems: string[] = [];
  if (typeof record.componentKey !== "string" || record.componentKey.length === 0) {
    problems.push("componentKey is required.");
  } else if (record.componentKey.length > 120) {
    problems.push("componentKey exceeds 120 characters.");
  }
  if (
    record.config !== undefined &&
    (record.config === null ||
      typeof record.config !== "object" ||
      Array.isArray(record.config))
  ) {
    problems.push("config must be an object.");
  }
  return problems;
});
