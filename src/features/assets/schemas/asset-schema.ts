import { z } from "zod";

// ---------------------------------------------------------------------------
// Supported upload MIME types
// ---------------------------------------------------------------------------

export const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
] as const;

export const ALLOWED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".svg"] as const;

export const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// ---------------------------------------------------------------------------
// Asset source schema
// ---------------------------------------------------------------------------

export const AssetSourceSchema = z.object({
  type: z.literal("data-url"),
  value: z.string().min(1, "Source value is required"),
});

// ---------------------------------------------------------------------------
// Asset ref schema — used inside section props
// ---------------------------------------------------------------------------

export const AssetRefSchema = z.object({
  assetId: z.string().min(1, "Asset ID is required"),
  altText: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Full asset schema
// ---------------------------------------------------------------------------

export const AssetSchema = z.object({
  id: z.string().min(1, "Asset ID is required"),
  name: z.string().min(1, "Asset name is required"),
  type: z.enum(["image", "logo", "background", "icon", "illustration"]),
  mimeType: z.string().min(1, "MIME type is required"),
  extension: z.string().min(1, "Extension is required"),
  size: z.number().int().nonnegative("Size must be non-negative"),
  width: z.number().int().nonnegative().optional(),
  height: z.number().int().nonnegative().optional(),
  source: AssetSourceSchema,
  createdAt: z.string().min(1, "Created timestamp is required"),
  altText: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Upload validation helpers
// ---------------------------------------------------------------------------

/** Check if a MIME type is allowed */
export function isAllowedMimeType(mimeType: string): boolean {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType);
}

/** Check if a file extension is allowed */
export function isAllowedExtension(filename: string): boolean {
  const ext = "." + filename.split(".").pop()?.toLowerCase();
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(ext);
}
