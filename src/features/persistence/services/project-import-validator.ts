// ---------------------------------------------------------------------------
// Project Import Validator
//
// Enforces conservative limits on imported project data to prevent
// resource exhaustion and schema-violating content.
//
// This is a separate layer from the main ProjectSchema — limits here
// may be stricter than the live editing schema allows.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import type { ProjectFileError } from "../types";
import {
  MAX_PAGES,
  MAX_SECTIONS_PER_PAGE,
  MAX_FEATURE_ITEMS,
  MAX_FAQ_ITEMS,
  MAX_ASSETS,
  MAX_ASSET_NAME_LENGTH,
  MAX_ASSET_PAYLOAD_SIZE_BYTES,
  MAX_TEXT_FIELD_LENGTH,
} from "../constants";
import { validateDataUrl } from "@/features/assets/utils/data-url-parser";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a normalized Project against import limits.
 *
 * Returns a structured error if any limit is exceeded.
 * Returns null if the project passes all checks.
 *
 * Does not mutate the project. Every limit error carries structured
 * details: the limit name, the actual value, the maximum value, and the
 * offending path.
 */
export function validateProjectImportLimits(
  project: Project,
): ProjectFileError | null {
  // Pages
  if (project.pages.length > MAX_PAGES) {
    return limitError("PAGES", project.pages.length, MAX_PAGES, "pages");
  }

  // Sections per page
  for (const page of project.pages) {
    if (page.sections.length > MAX_SECTIONS_PER_PAGE) {
      return limitError(
        "SECTIONS_PER_PAGE",
        page.sections.length,
        MAX_SECTIONS_PER_PAGE,
        `pages.${page.id}.sections`,
      );
    }

    // Check individual section field limits
    for (const section of page.sections) {
      const props = section.props;

      // Feature items limit
      const features = props.features as Array<unknown> | undefined;
      if (Array.isArray(features) && features.length > MAX_FEATURE_ITEMS) {
        return limitError(
          "FEATURE_ITEMS",
          features.length,
          MAX_FEATURE_ITEMS,
          `sections.${section.id}.features`,
        );
      }

      // FAQ items limit
      const faqItems = props.items as Array<unknown> | undefined;
      if (Array.isArray(faqItems) && faqItems.length > MAX_FAQ_ITEMS) {
        return limitError(
          "FAQ_ITEMS",
          faqItems.length,
          MAX_FAQ_ITEMS,
          `sections.${section.id}.items`,
        );
      }

      // Text field length check — deep traversal covers nested props
      // (features[].title, plans[].name, items[].question, etc.) so nested
      // text fields are checked consistently with top-level ones.
      const textViolation = findOversizedTextField(
        props,
        MAX_TEXT_FIELD_LENGTH,
        `sections.${section.id}.props`,
      );
      if (textViolation) {
        return limitError(
          "TEXT_FIELD",
          textViolation.length,
          MAX_TEXT_FIELD_LENGTH,
          textViolation.path,
        );
      }
    }
  }

  // Assets
  if (project.assets.length > MAX_ASSETS) {
    return limitError("ASSETS", project.assets.length, MAX_ASSETS, "assets");
  }

  for (const asset of project.assets) {
    // Asset name length
    if (asset.name.length > MAX_ASSET_NAME_LENGTH) {
      return limitError(
        "ASSET_NAME",
        asset.name.length,
        MAX_ASSET_NAME_LENGTH,
        `assets.${asset.id}.name`,
      );
    }

    // Asset payload size check (for data URLs)
    if (asset.source.type === "data-url") {
      const validation = validateDataUrl(asset.source.value);
      if (!validation.valid) {
        return {
          code: "INVALID_ASSET",
          message: `Asset "${asset.id}" ("${asset.name}"): ${validation.error}`,
          field: `assets.${asset.id}.source`,
        };
      }

      // Estimate the payload size from base64
      const payloadBase64 = extractBase64FromDataUrl(asset.source.value);
      if (payloadBase64) {
        const estimatedSize = estimateBase64Size(payloadBase64);
        if (estimatedSize > MAX_ASSET_PAYLOAD_SIZE_BYTES) {
          return limitError(
            "ASSET_PAYLOAD",
            estimatedSize,
            MAX_ASSET_PAYLOAD_SIZE_BYTES,
            `assets.${asset.id}.source`,
          );
        }
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function limitError(
  limit: string,
  actual: number,
  max: number,
  path: string,
): ProjectFileError {
  return {
    code: "PROJECT_VALIDATION_FAILED",
    message: `Project exceeds the ${limit} limit: ${actual} (maximum ${max}).`,
    field: path,
    details: { limit, actual, max, path },
  };
}

/**
 * Deep-traverse a props tree (objects and arrays) and return the first
 * string value that exceeds maxLength, with its path. Returns null when
 * every string fits.
 */
function findOversizedTextField(
  value: unknown,
  maxLength: number,
  path: string,
): { length: number; path: string } | null {
  if (typeof value === "string") {
    if (value.length > maxLength) return { length: value.length, path };
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findOversizedTextField(value[i], maxLength, `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const found = findOversizedTextField(
        record[key],
        maxLength,
        `${path}.${key}`,
      );
      if (found) return found;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers (duplicated from data-url-parser to avoid browser/Node dependency)
// ---------------------------------------------------------------------------

function extractBase64FromDataUrl(dataUrl: string): string | null {
  const match = dataUrl.match(/^data:[^;]*;base64,(.*)$/);
  return match ? match[1] : null;
}

function estimateBase64Size(base64: string): number {
  const padding = (base64.match(/=+$/)?.[0]?.length) || 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}
