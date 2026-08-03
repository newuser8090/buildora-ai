import type { Project, Page } from "@/types/project";
import type { AssetRef } from "@/features/assets/types";
import type { BaseSection } from "@/types/section";
import type { ExportAssetManifest } from "./asset-export-manifest";
import { safeJsxString } from "../formatters/jsx-formatter";
import type { OutputFile } from "../pipeline/types";

// ---------------------------------------------------------------------------
// Section component registry — maps section type to import path + component name
// ---------------------------------------------------------------------------

interface SectionComponentInfo {
  importPath: string;
  componentName: string;
}

const SECTION_COMPONENTS: Record<string, SectionComponentInfo> = {
  header:   { importPath: "@/components/sections/header",   componentName: "Header" },
  hero:     { importPath: "@/components/sections/hero",     componentName: "Hero" },
  features: { importPath: "@/components/sections/features", componentName: "Features" },
  pricing:  { importPath: "@/components/sections/pricing",  componentName: "Pricing" },
  faq:      { importPath: "@/components/sections/faq",      componentName: "Faq" },
  cta:      { importPath: "@/components/sections/cta",      componentName: "Cta" },
  footer:   { importPath: "@/components/sections/footer",   componentName: "Footer" },
};

// ---------------------------------------------------------------------------
// Asset field mapping — which AssetRef fields map to which generated props
// ---------------------------------------------------------------------------

interface AssetFieldTransform {
  /** Source AssetRef field name, e.g. "logoImage" */
  refField: string;
  /** Generated src prop name, e.g. "logoSrc" */
  srcField: string;
  /** Generated alt prop name, e.g. "logoAlt" */
  altField: string;
  /** For array fields: the key inside each array item */
  itemRefField?: string;
  /** Whether the field contains an array of items with nested AssetRefs */
  isArray?: boolean;
}

const ASSET_TRANSFORMS: Record<string, AssetFieldTransform[]> = {
  header: [
    { refField: "logoImage", srcField: "logoSrc", altField: "logoAlt" },
  ],
  hero: [
    { refField: "heroImage", srcField: "heroSrc", altField: "heroAlt" },
    { refField: "backgroundImage", srcField: "backgroundSrc", altField: "" },
  ],
  features: [
    { refField: "features", isArray: true, itemRefField: "iconImage", srcField: "iconSrc", altField: "iconAlt" },
  ],
  cta: [
    { refField: "backgroundImage", srcField: "backgroundSrc", altField: "" },
  ],
  footer: [
    { refField: "logoImage", srcField: "logoSrc", altField: "logoAlt" },
  ],
};

// ---------------------------------------------------------------------------
// Generates app/page.tsx — renders all visible sections in order
// ---------------------------------------------------------------------------

export function generatePage(
  project: Project,
  manifest?: ExportAssetManifest,
): OutputFile {
  const page: Page = project.pages[0]; // multi-page support can be added later
  if (!page) {
    return {
      path: "app/page.tsx",
      content: `export default function Home() { return null; }\n`,
    };
  }

  // Filter visible sections, sort by order
  const visibleSections = page.sections
    .filter((s) => s.visible !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  // Collect unique component types used (for import deduplication)
  const usedTypes = new Set(visibleSections.map((s) => s.type));

  // Build import statements
  const imports: string[] = [];
  for (const type of usedTypes) {
    const info = SECTION_COMPONENTS[type];
    if (!info) continue; // skip unknown types
    imports.push(`import { ${info.componentName} } from "${info.importPath}";`);
  }
  imports.sort();

  // Build rendered elements
  const rendered: string[] = [];
  for (const section of visibleSections) {
    const info = SECTION_COMPONENTS[section.type];
    if (!info) continue;

    const propsLines = serializePropsForComponent(section, manifest);
    rendered.push(`      <${info.componentName} key="${section.id}" ${propsLines} />`);
  }

  const content = `${
    imports.length > 0 ? imports.join("\n") + "\n\n" : ""
  }export default function Home() {
  return (
    <>
${rendered.join("\n")}
    </>
  );
}\n`;

  return { path: "app/page.tsx", content };
}

// ---------------------------------------------------------------------------
// Serialize section props into JSX attribute strings
//
// Handles:
//   - AssetRef fields → resolved to /assets/ paths via manifest
//   - Strings (escaped), numbers, booleans
//   - Arrays of objects, nested objects
//   - All existing serialization is preserved for non-asset fields
// ---------------------------------------------------------------------------

function serializePropsForComponent(
  section: BaseSection,
  manifest?: ExportAssetManifest,
): string {
  const parts: string[] = [];

  // Start with the original props, then transform asset fields
  const resolvedProps = resolveAssetFields(section, manifest);

  for (const [key, value] of Object.entries(resolvedProps)) {
    if (value === undefined || value === null) continue;

    if (typeof value === "string") {
      // Use expression syntax if the string contains newlines or special chars
      if (value.includes("\n") || value.includes('"')) {
        const escaped = value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n");
        parts.push(`${key}={'${escaped}'}`);
      } else {
        parts.push(`${key}="${safeJsxString(value)}"`);
      }
    } else if (typeof value === "number" || typeof value === "boolean") {
      parts.push(`${key}={${String(value)}}`);
    } else if (Array.isArray(value)) {
      parts.push(`${key}={${JSON.stringify(value, jsonReplacer)}}`);
    } else if (typeof value === "object") {
      parts.push(`${key}={${JSON.stringify(value, jsonReplacer)}}`);
    }
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Resolve AssetRef fields to /assets/ public paths
//
// For each section type, known AssetRef fields are:
// 1. Looked up in the manifest
// 2. Replaced with the public path (src) and alt text
// 3. The original AssetRef object is removed from serialized props
// ---------------------------------------------------------------------------

function resolveAssetFields(
  section: BaseSection,
  manifest?: ExportAssetManifest,
): Record<string, unknown> {
  const props = { ...section.props };
  const transforms = ASSET_TRANSFORMS[section.type];

  // Always handle Hero legacy image URL fallback first, even without a manifest.
  // This ensures projects with assets: [] or missing assets still render legacy URLs.
  if (section.type === "hero") {
    const legacyImage = typeof props.image === "string" && props.image.length > 0 ? props.image : undefined;
    if (legacyImage) {
      props.legacyImageSrc = legacyImage;
    }
    // Remove `image` regardless — consumed as legacyImageSrc or not needed
    delete props.image;
  }

  // Without a manifest, no AssetRef resolution is possible — return early
  if (!transforms || !manifest) return props;

  for (const transform of transforms) {
    if (transform.isArray) {
      // Transform array items
      const items = props[transform.refField] as Array<Record<string, unknown>> | undefined;
      if (!items || !Array.isArray(items)) continue;

      const resolvedItems = items.map((item) => {
        const newItem = { ...item };
        const ref = newItem[transform.itemRefField!] as AssetRef | undefined;
        if (ref?.assetId) {
          const entry = manifest.byAssetId.get(ref.assetId);
          if (entry) {
            newItem[transform.srcField] = entry.publicPath;
            newItem[transform.altField] = ref.altText || entry.asset.name || "";
          }
        }
        // Remove the AssetRef object so it doesn't get serialized
        delete newItem[transform.itemRefField!];
        return newItem;
      });

      props[transform.refField] = resolvedItems;
    } else {
      // Transform direct field
      const ref = props[transform.refField] as AssetRef | undefined;
      if (ref?.assetId) {
        const entry = manifest.byAssetId.get(ref.assetId);
        if (entry) {
          // Add resolved public path — overrides legacyImageSrc if set above
          props[transform.srcField] = entry.publicPath;
          // Add alt text
          if (transform.altField) {
            props[transform.altField] = ref.altText || entry.asset.name || "";
          }
        }
      }
      // Remove the AssetRef object — don't serialize it
      delete props[transform.refField];
    }
  }

  return props;
}

/** Safely replace undefined/null values in JSON serialisation. */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (value === undefined) return null;
  return value;
}
