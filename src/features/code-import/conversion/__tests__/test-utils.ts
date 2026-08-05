// ---------------------------------------------------------------------------
// Phase P2 conversion test helpers
// ---------------------------------------------------------------------------

import { beforeEach } from "vitest";

import { registerDefaultBlocks, isDefaultBlocksRegistered } from "../../../blocks/registry/block-registry";
import { convertImportedSource, type ConversionOutcome, type ConversionSuccess } from "../converter-orchestrator";
import type { ConversionIdFactory } from "../conversion-errors";
import type { ImportAttributeValue, ImportElementNode, ImportNode } from "../../types";

// Every conversion test needs the shared Phase O block catalogue.
beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
});

let elementCounter = 0;

export interface ElementOptions {
  attrs?: Record<string, ImportAttributeValue>;
  classes?: string[];
  styles?: Record<string, string>;
  children?: ImportNode[];
  id?: string;
}

/** Build an ImportElementNode (deterministic ids). */
export function el(
  tag: string,
  opts: ElementOptions = {},
): ImportElementNode {
  elementCounter += 1;
  return {
    kind: "element",
    id: opts.id ?? `e${elementCounter}`,
    tagName: tag,
    attributes: opts.attrs ?? {},
    classNames: opts.classes ?? [],
    inlineStyles: opts.styles ?? {},
    children: opts.children ?? [],
  };
}

/** Build a text ImportNode. */
export function txt(value: string): ImportNode {
  elementCounter += 1;
  return { kind: "text", id: `t${elementCounter}`, value };
}

/** Deterministic conversion id factory for tests. */
export function conversionIdFactory(prefix = "b"): ConversionIdFactory {
  let counter = 0;
  return {
    next(requestedPrefix?: string): string {
      counter += 1;
      return `${requestedPrefix ?? prefix}${counter}`;
    },
  };
}

/** Convert a source string through the full P1 → P2 pipeline. */
export function convertSource(
  source: string,
  opts: { idFactory?: ConversionIdFactory } = {},
): ConversionOutcome {
  return convertImportedSource(source, { idFactory: opts.idFactory });
}

/** Assert a conversion succeeded and return its value. */
export function expectConversionOk(outcome: ConversionOutcome): ConversionSuccess {
  if (!outcome.ok) {
    throw new Error(`Expected conversion to succeed, got error: ${outcome.error.code} — ${outcome.error.message}`);
  }
  return outcome.value;
}
