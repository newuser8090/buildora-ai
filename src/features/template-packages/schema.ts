// ---------------------------------------------------------------------------
// Template Packages (Phase P13) — strict runtime validation
//
// Packages are untrusted input. Manifest and payload schemas are STRICT while
// formatVersion is 1 (unknown keys are rejected); they relax only on a future
// format bump. Assets are additionally cross-checked by the importer service
// (magic bytes, presence, size).
// ---------------------------------------------------------------------------

import { z } from "zod";
import {
  ASSET_PATH_PATTERN,
  BUILDORA_TEMPLATE_FORMAT_MARKER,
  MAX_TEMPLATE_ASSET_BYTES,
  MAX_TEMPLATE_ASSET_NAME_LENGTH,
  MAX_TEMPLATE_ASSETS,
  MAX_TEMPLATE_PACKAGE_NAME_LENGTH,
  PACKAGE_TYPES,
} from "./constants";
import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import { getMimeForExtension, getCanonicalExtension } from "@/features/assets/services/file-validator";
import {
  MAX_TAG_LENGTH,
  MAX_TEMPLATE_DESCRIPTION_LENGTH,
  MAX_TEMPLATE_TAGS,
} from "@/features/personal-templates/types";

// ---------------------------------------------------------------------------
// Asset entries
// ---------------------------------------------------------------------------

export const PackageAssetEntrySchema = z
  .object({
    path: z.string().regex(ASSET_PATH_PATTERN, "Invalid asset path"),
    assetId: z.string().min(1, "Asset ID is required"),
    name: z
      .string()
      .min(1, "Asset name is required")
      .max(MAX_TEMPLATE_ASSET_NAME_LENGTH, "Asset name is too long"),
    mimeType: z.string().min(1, "MIME type is required"),
    extension: z.string().min(1, "Extension is required"),
    size: z
      .number()
      .int()
      .nonnegative("Size must be non-negative")
      .max(MAX_TEMPLATE_ASSET_BYTES, "Asset is too large"),
  })
  .strict()
  .refine(
    (asset) => getCanonicalExtension(asset.mimeType) !== undefined,
    { message: "Unsupported asset MIME type", path: ["mimeType"] },
  )
  .refine(
    (asset) => getMimeForExtension(asset.extension) === asset.mimeType,
    { message: "Asset extension does not match its type", path: ["extension"] },
  );

export const PackageManifestSchema = z
  .object({
    format: z.literal(BUILDORA_TEMPLATE_FORMAT_MARKER),
    formatVersion: z.number().int().min(1, "Format version must be a positive integer"),
    packageType: z.enum(PACKAGE_TYPES),
    exportedAt: z
      .string()
      .min(1, "exportedAt is required")
      .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Invalid exportedAt" }),
    assetCount: z.number().int().nonnegative(),
    totalAssetBytes: z.number().int().nonnegative(),
    assets: z.array(PackageAssetEntrySchema).max(MAX_TEMPLATE_ASSETS, "Too many assets"),
  })
  .strict()
  .refine((m) => m.assetCount === m.assets.length, {
    message: "assetCount does not match the asset list",
    path: ["assetCount"],
  })
  .refine(
    (m) => m.totalAssetBytes === m.assets.reduce((sum, a) => sum + a.size, 0),
    { message: "totalAssetBytes does not match the asset list", path: ["totalAssetBytes"] },
  );

// ---------------------------------------------------------------------------
// Template metadata
// ---------------------------------------------------------------------------

const TEMPLATE_CATEGORY_VALUES = [
  "blank",
  "business",
  "portfolio",
  "commerce",
  "food",
  "landing-page",
  "event",
  "personal",
] as const;

export const TemplatePackageMetaSchema = z
  .object({
    name: z
      .string()
      .min(1, "Template name is required")
      .max(MAX_TEMPLATE_PACKAGE_NAME_LENGTH, "Template name is too long"),
    description: z
      .string()
      .max(MAX_TEMPLATE_DESCRIPTION_LENGTH, "Description is too long"),
    category: z.enum(TEMPLATE_CATEGORY_VALUES),
    tags: z
      .array(z.string().max(MAX_TAG_LENGTH, "Tag is too long"))
      .max(MAX_TEMPLATE_TAGS, "Too many tags"),
    createdAt: z
      .string()
      .min(1, "createdAt is required")
      .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Invalid createdAt" }),
    updatedAt: z
      .string()
      .min(1, "updatedAt is required")
      .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Invalid updatedAt" }),
  })
  .strict();

// ---------------------------------------------------------------------------
// Payload (template.json) — project with externalized asset sources
// ---------------------------------------------------------------------------

export const PackagePayloadSchema = z
  .object({
    template: TemplatePackageMetaSchema,
    project: ProjectSchema,
  })
  .strict()
  .superRefine((payload, ctx) => {
    // Every asset source must reference a packaged asset path whose extension
    // agrees with the asset's own MIME type.
    payload.project.assets.forEach((asset, index) => {
      if (!ASSET_PATH_PATTERN.test(asset.source.value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Asset ${index} does not reference a packaged file`,
          path: ["project", "assets", index, "source", "value"],
        });
        return;
      }
      const expected = getCanonicalExtension(asset.mimeType);
      if (expected && asset.extension !== expected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Asset ${index} extension does not match its type`,
          path: ["project", "assets", index, "extension"],
        });
      }
    });
  });
