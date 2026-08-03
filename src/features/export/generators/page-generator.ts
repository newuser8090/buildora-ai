import type { Project, Page } from "@/types/project";
import type { AssetRef } from "@/features/assets/types";
import type { BaseSection } from "@/types/section";
import type { ExportAssetManifest } from "./asset-export-manifest";
import { safeJsxString, escapeJsxStringLiteral } from "../formatters/jsx-formatter";
import {
  computePageRoutes,
  resolveInternalHref,
  type PageRoute,
} from "@/features/routing/routes";
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
// Link field mapping — user-authored hrefs that may reference other pages
// ---------------------------------------------------------------------------

type LinkFieldTransform =
  | { kind: "array"; field: string; hrefKey: string }
  | { kind: "object"; field: string; hrefKey: string }
  | { kind: "direct"; field: string }
  | { kind: "arrayOfObjects"; field: string; nestedField: string; hrefKey: string };

const LINK_TRANSFORMS: Record<string, LinkFieldTransform[]> = {
  header: [
    { kind: "array", field: "navLinks", hrefKey: "href" },
    { kind: "direct", field: "ctaHref" },
  ],
  hero: [
    { kind: "object", field: "primaryCta", hrefKey: "href" },
    { kind: "object", field: "secondaryCta", hrefKey: "href" },
  ],
  cta: [
    { kind: "direct", field: "ctaHref" },
  ],
  footer: [
    { kind: "array", field: "links", hrefKey: "href" },
  ],
  features: [
    { kind: "arrayOfObjects", field: "features", nestedField: "link", hrefKey: "href" },
  ],
};

// ---------------------------------------------------------------------------
// Per-page metadata + component naming
// ---------------------------------------------------------------------------

function componentNameForRoute(route: PageRoute): string {
  if (route.isHome) return "HomePage";
  const segments = route.routeUrl.split("/").filter(Boolean);
  const name = segments
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
  return `${name || "Page"}Page`;
}

function pageMetadataLines(page: Page): string {
  const title = page.meta?.title?.trim() || page.title;
  const description = page.meta?.description?.trim();
  const lines = [`  title: "${escapeJsxStringLiteral(title)}",`];
  if (description) {
    lines.push(`  description: "${escapeJsxStringLiteral(description)}",`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Generates one route file (app/<slug>/page.tsx) for a page
// ---------------------------------------------------------------------------

export function generatePageFile(
  project: Project,
  page: Page,
  routes: PageRoute[],
  manifest?: ExportAssetManifest,
): OutputFile {
  const route = routes.find((r) => r.page.id === page.id);
  if (!route) {
    throw new Error(`No route registered for page "${page.id}".`);
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

  // Build rendered elements — hrefs are resolved against ALL page routes so
  // cross-page internal links point at real exported routes.
  const rendered: string[] = [];
  for (const section of visibleSections) {
    const info = SECTION_COMPONENTS[section.type];
    if (!info) continue;

    const propsLines = serializePropsForComponent(section, manifest, routes);
    rendered.push(`      <${info.componentName} key="${section.id}" ${propsLines} />`);
  }

  const componentName = componentNameForRoute(route);
  const metadata = pageMetadataLines(page);

  const content = `import type { Metadata } from "next";
${imports.join("\n")}

export const metadata: Metadata = {
${metadata}
};

export default function ${componentName}() {
  return (
    <>
${rendered.join("\n")}
    </>
  );
}
`;

  return { path: route.filePath, content };
}

// ---------------------------------------------------------------------------
// Home-page generator — kept for backward compatibility (exports pages[0])
// ---------------------------------------------------------------------------

export function generatePage(
  project: Project,
  manifest?: ExportAssetManifest,
): OutputFile {
  const page = project.pages[0];
  if (!page) {
    return {
      path: "app/page.tsx",
      content: `export default function Home() { return null; }\n`,
    };
  }
  const routes = computePageRoutes(project.pages);
  return generatePageFile(project, page, routes, manifest);
}

// ---------------------------------------------------------------------------
// Full multi-page route generation — one OutputFile per page
// ---------------------------------------------------------------------------

export function generatePageRoutes(
  project: Project,
  manifest?: ExportAssetManifest,
): OutputFile[] {
  const routes = computePageRoutes(project.pages);
  if (routes.length === 0) {
    return [
      {
        path: "app/page.tsx",
        content: `export default function Home() { return null; }\n`,
      },
    ];
  }
  return routes.map((route) =>
    generatePageFile(project, route.page, routes, manifest),
  );
}

// ---------------------------------------------------------------------------
// Serialize section props into JSX attribute strings
//
// Handles:
//   - AssetRef fields → resolved to /assets/ paths via manifest
//   - internal hrefs → resolved to canonical page routes
//   - Strings (escaped), numbers, booleans
//   - Arrays of objects, nested objects
// ---------------------------------------------------------------------------

function serializePropsForComponent(
  section: BaseSection,
  manifest?: ExportAssetManifest,
  routes?: PageRoute[],
): string {
  const parts: string[] = [];

  // Asset resolution first, then cross-page link resolution.
  const assetResolved = resolveAssetFields(section, manifest);
  const resolvedProps = resolveLinkFields(section.type, assetResolved, routes ?? []);

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
// ---------------------------------------------------------------------------

function resolveAssetFields(
  section: BaseSection,
  manifest?: ExportAssetManifest,
): Record<string, unknown> {
  const props = { ...section.props };
  const transforms = ASSET_TRANSFORMS[section.type];

  // Always handle Hero legacy image URL fallback first, even without a manifest.
  if (section.type === "hero") {
    const legacyImage = typeof props.image === "string" && props.image.length > 0 ? props.image : undefined;
    if (legacyImage) {
      props.legacyImageSrc = legacyImage;
    }
    delete props.image;
  }

  if (!transforms || !manifest) return props;

  for (const transform of transforms) {
    if (transform.isArray) {
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
        delete newItem[transform.itemRefField!];
        return newItem;
      });

      props[transform.refField] = resolvedItems;
    } else {
      const ref = props[transform.refField] as AssetRef | undefined;
      if (ref?.assetId) {
        const entry = manifest.byAssetId.get(ref.assetId);
        if (entry) {
          props[transform.srcField] = entry.publicPath;
          if (transform.altField) {
            props[transform.altField] = ref.altText || entry.asset.name || "";
          }
        }
      }
      delete props[transform.refField];
    }
  }

  return props;
}

// ---------------------------------------------------------------------------
// Resolve cross-page internal hrefs to canonical routes
// ---------------------------------------------------------------------------

function resolveLinkFields(
  sectionType: string,
  props: Record<string, unknown>,
  routes: PageRoute[],
): Record<string, unknown> {
  const resolved = { ...props };
  const transforms = LINK_TRANSFORMS[sectionType];
  if (!transforms) return resolved;

  for (const t of transforms) {
    if (t.kind === "direct") {
      const href = resolved[t.field];
      if (typeof href === "string") {
        resolved[t.field] = resolveInternalHref(href, routes);
      }
    } else if (t.kind === "object") {
      const obj = resolved[t.field];
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        const item = { ...(obj as Record<string, unknown>) };
        if (typeof item[t.hrefKey] === "string") {
          item[t.hrefKey] = resolveInternalHref(item[t.hrefKey], routes);
        }
        resolved[t.field] = item;
      }
    } else if (t.kind === "array") {
      const arr = resolved[t.field];
      if (Array.isArray(arr)) {
        resolved[t.field] = arr.map((item) => {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const obj = { ...(item as Record<string, unknown>) };
            if (typeof obj[t.hrefKey] === "string") {
              obj[t.hrefKey] = resolveInternalHref(obj[t.hrefKey], routes);
            }
            return obj;
          }
          return item;
        });
      }
    } else if (t.kind === "arrayOfObjects") {
      const arr = resolved[t.field];
      if (Array.isArray(arr)) {
        resolved[t.field] = arr.map((item) => {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const obj = { ...(item as Record<string, unknown>) };
            const nested = obj[t.nestedField];
            if (nested && typeof nested === "object" && !Array.isArray(nested)) {
              const linkObj = { ...(nested as Record<string, unknown>) };
              if (typeof linkObj[t.hrefKey] === "string") {
                linkObj[t.hrefKey] = resolveInternalHref(linkObj[t.hrefKey], routes);
              }
              obj[t.nestedField] = linkObj;
            }
            return obj;
          }
          return item;
        });
      }
    }
  }

  return resolved;
}

/** Safely replace undefined/null values in JSON serialisation. */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (value === undefined) return null;
  return value;
}
