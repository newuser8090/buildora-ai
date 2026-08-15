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
import { buildValidatedCustomCodeSrcdoc } from "@/features/elements/custom-code/srcdoc";
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
  "custom-block": { importPath: "@/components/sections/custom-block", componentName: "CustomBlock" },
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

// ---------------------------------------------------------------------------
// Per-page metadata — Phase P7 extended SEO / social metadata
//
// Fallback policy (deterministic):
//   Google title  = seoTitle || title || page.title
//   description   = seoDescription || description
//   social title  = socialTitle || seoTitle || title || page.title
//   social desc   = socialDescription || description
//   social image  = socialImage asset (via manifest) if set
//   canonical     = canonicalUrl override (only when set)
//   robots        = index:false emitted only when page.meta.index === false
// ---------------------------------------------------------------------------

function pageMetadataLines(
  page: Page,
  manifest?: ExportAssetManifest,
): string {
  const meta = page.meta ?? {};
  const title = meta.seoTitle?.trim() || meta.title?.trim() || page.title;
  const description = meta.seoDescription?.trim() || meta.description?.trim();
  const socialTitle = meta.socialTitle?.trim() || title;
  const socialDescription = meta.socialDescription?.trim() || description || "";

  const lines = [`  title: "${escapeJsxStringLiteral(title)}",`];
  if (description) {
    lines.push(`  description: "${escapeJsxStringLiteral(description)}",`);
  }

  // Canonical URL override
  if (meta.canonicalUrl?.trim()) {
    lines.push(`  alternates: { canonical: "${escapeJsxStringLiteral(meta.canonicalUrl.trim())}" },`);
  }

  // Robots — emit only when the page is explicitly hidden (default index).
  if (meta.index === false) {
    lines.push(`  robots: { index: false },`);
  }

  // Social share card (OpenGraph).
  const socialImagePath = resolveSocialImagePath(page, manifest);
  const ogLines: string[] = [
    `    title: "${escapeJsxStringLiteral(socialTitle)}",`,
    socialDescription
      ? `    description: "${escapeJsxStringLiteral(socialDescription)}",`
      : null,
    meta.canonicalUrl?.trim()
      ? `    url: "${escapeJsxStringLiteral(meta.canonicalUrl.trim())}",`
      : null,
    socialImagePath
      ? `    images: ["${escapeJsxStringLiteral(socialImagePath)}"],`
      : null,
  ].filter((l): l is string => l !== null);
  lines.push(`  openGraph: {\n${ogLines.join("\n")}\n  },`);

  return lines.join("\n");
}

/** Resolve the page's social image public path via the export manifest. */
function resolveSocialImagePath(
  page: Page,
  manifest?: ExportAssetManifest,
): string | undefined {
  const ref = page.meta?.socialImage;
  if (!ref?.assetId || !manifest) return undefined;
  const entry = manifest.byAssetId.get(ref.assetId);
  return entry?.publicPath;
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

    // Phase P23-C — custom-block sections may carry OPT-IN custom code. The
    // emitted tree keeps only the `enabled` flag (never the code text), and
    // validated sandbox documents are passed separately via `srcdocs`, so the
    // generated parent page contains no directly executable user code.
    const serializableSection =
      section.type === "custom-block" ? customBlockSectionForExport(section) : section;
    const propsLines = serializePropsForComponent(serializableSection, manifest, routes);

    // Phase P22-G — custom-block sections carry typed NavTargets inside their
    // element trees. The exported CustomBlock needs the page route map to
    // resolve them to real exported routes (pageId → routeUrl).
    if (section.type === "custom-block") {
      const routeMap = JSON.stringify(
        Object.fromEntries(routes.map((route) => [route.page.id, route.routeUrl])),
      );
      // Phase P23-C — srcdocs prop is omitted entirely when no custom-code
      // element is enabled (projects without custom code stay unchanged).
      const srcdocs = buildCustomCodeSrcdocsForSection(section);
      const srcdocsAttr = srcdocs ? ` srcdocs={${serializeSrcdocsForExport(srcdocs)}}` : "";
      rendered.push(`      <${info.componentName} key="${section.id}" ${propsLines} routes={${routeMap}}${srcdocsAttr} />`);
      continue;
    }
    rendered.push(`      <${info.componentName} key="${section.id}" ${propsLines} />`);
  }

  const componentName = componentNameForRoute(route);
  const metadata = pageMetadataLines(page, manifest);

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

// ---------------------------------------------------------------------------
// Phase P23-C — custom-code srcdocs for custom-block sections
//
// The ONLY srcdoc construction path is buildValidatedCustomCodeSrcdoc (schema
// validation → enabled === true → deterministic clamping → buildCustomCodeDocument).
// The page module carries:
//   - the tree with customCode reduced to { enabled: true } (never the code
//     text) so the parent page holds no user code;
//   - the validated srcdoc documents in a separate `srcdocs` prop, with every
//     "<" escaped to its \u003c JSON escape so the module source contains no
//     literal script/style sequence (the JS/JSON decoder restores the exact
//     document, which only ever executes inside the sandboxed iframe).
// ---------------------------------------------------------------------------

/**
 * Deep-copy a custom-block section for JSX serialization, reducing every
 * node's customCode to its `enabled` flag. Enabled nodes keep `{ enabled:
 * true }` (the generated NodeView requires the opt-in flag); disabled/absent
 * customCode is dropped entirely so the emitted tree never carries code text.
 * Non-custom-code fields are preserved byte-for-byte (shallow copy + JSON
 * serialization keeps key order).
 */
function customBlockSectionForExport(section: BaseSection): BaseSection {
  const props = section.props as Record<string, unknown>;
  const rawTree = props.tree as
    | { nodes?: Record<string, unknown> }
    | undefined;
  if (!rawTree || typeof rawTree !== "object" || !rawTree.nodes || typeof rawTree.nodes !== "object") {
    return section;
  }

  const nodes: Record<string, unknown> = {};
  for (const [id, node] of Object.entries(rawTree.nodes)) {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      nodes[id] = node;
      continue;
    }
    const next: Record<string, unknown> = { ...(node as Record<string, unknown>) };
    const customCode = (node as Record<string, unknown>).customCode;
    if (customCode && typeof customCode === "object" && !Array.isArray(customCode)) {
      if ((customCode as { enabled?: unknown }).enabled === true) {
        next.customCode = { enabled: true };
      } else {
        delete next.customCode;
      }
    }
    nodes[id] = next;
  }

  return {
    ...section,
    props: { ...props, tree: { ...rawTree, nodes } },
  };
}

/**
 * Build the `srcdocs` map (nodeId → validated srcdoc) for a custom-block
 * section. One entry per node with EXPLICITLY ENABLED, schema-valid custom
 * code; every document comes from the single authoritative builder. Returns
 * null when no node qualifies (callers omit the srcdocs prop entirely).
 */
function buildCustomCodeSrcdocsForSection(
  section: BaseSection,
): Record<string, string> | null {
  const props = section.props as Record<string, unknown> | undefined;
  const tree = props?.tree as { nodes?: Record<string, unknown> } | undefined;
  if (!tree || !tree.nodes || typeof tree.nodes !== "object") return null;

  const srcdocs: Record<string, string> = {};
  for (const [nodeId, node] of Object.entries(tree.nodes)) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    const customCode = (node as Record<string, unknown>).customCode;
    if (customCode === undefined || customCode === null) continue;
    const srcdoc = buildValidatedCustomCodeSrcdoc(customCode);
    if (srcdoc === null) continue;
    srcdocs[nodeId] = srcdoc;
  }
  return Object.keys(srcdocs).length > 0 ? srcdocs : null;
}

/**
 * Serialize the srcdocs map as a JSX expression literal. Every "<" in each
 * document is escaped to its \u003c JSON escape, so the emitted module source
 * contains no literal script/style sequence; JSON decoding restores the
 * exact document at runtime (inside the sandboxed iframe only).
 */
function serializeSrcdocsForExport(srcdocs: Record<string, string>): string {
  const entries = Object.entries(srcdocs).map(([nodeId, srcdoc]) => {
    const encoded = JSON.stringify(srcdoc).replace(/</g, "\\u003c");
    return `${JSON.stringify(nodeId)}:${encoded}`;
  });
  return `{${entries.join(",")}}`;
}
