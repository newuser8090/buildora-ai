// ---------------------------------------------------------------------------
// Asset data model
//
// Designed for extensibility:
//   - `source` wraps the storage backend (data URLs now, IndexedDB later)
//   - `AssetRef` is a generic reference that any section prop can use
//   - `AssetType` is a union that can be extended for future media types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Storage source abstraction
// ---------------------------------------------------------------------------

export interface AssetSource {
  /** Storage backend type. Currently only "data-url". */
  type: "data-url";
  /** The source value: for data-url this is the data: URI */
  value: string;
}

// ---------------------------------------------------------------------------
// Generic asset reference — used in section props
// ---------------------------------------------------------------------------

export interface AssetRef {
  /** The ID of the referenced Asset */
  assetId: string;
  /** Optional alt text for accessibility. Falls back to asset name. */
  altText?: string;
}

// ---------------------------------------------------------------------------
// Asset type — extensible union
// ---------------------------------------------------------------------------

export type AssetType = "image" | "logo" | "background" | "icon" | "illustration";

// ---------------------------------------------------------------------------
// Full asset model
// ---------------------------------------------------------------------------

export interface Asset {
  /** Unique identifier (nanoid or timestamp-based) */
  id: string;
  /** Original filename from upload */
  name: string;
  /** Semantic type: image, logo, background, icon, illustration */
  type: AssetType;
  /** MIME type, e.g. "image/png", "image/webp", "image/svg+xml" */
  mimeType: string;
  /** File extension including dot, e.g. ".png", ".webp", ".svg" */
  extension: string;
  /** File size in bytes */
  size: number;
  /** Detected pixel width (only for raster images) */
  width?: number;
  /** Detected pixel height (only for raster images) */
  height?: number;
  /** Storage-abstracted source — currently always data URL */
  source: AssetSource;
  /** ISO timestamp of upload */
  createdAt: string;
  /** User-specified alt text; defaults to `name` */
  altText?: string;
}
