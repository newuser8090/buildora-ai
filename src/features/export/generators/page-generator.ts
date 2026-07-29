import type { Project, Page } from "@/types/project";
import type { BaseSection } from "@/types/section";
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
// Generates app/page.tsx — renders all visible sections in order
//
// Each section is rendered by passing its serialized props to the
// corresponding reusable component from components/sections/.
// Multiple sections of the same type are supported because each gets
// its own <Component key=... {...props} /> element.
// ---------------------------------------------------------------------------

export function generatePage(project: Project): OutputFile {
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

    const propsLines = serializePropsForComponent(section);
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
}
`;

  return { path: "app/page.tsx", content };
}

// ---------------------------------------------------------------------------
// Serialize section props into JSX attribute strings
//
// Handles: strings (escaped), numbers, booleans, arrays of objects, nested objects.
// ---------------------------------------------------------------------------

function serializePropsForComponent(section: BaseSection): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(section.props)) {
    if (value === undefined || value === null) continue;

    if (typeof value === "string") {
      // Use expression syntax if the string contains newlines or special chars
      // that would break a JSX string attribute
      if (value.includes("\n") || value.includes('"')) {
        // Escape for JSX expression: `prop={value}`
        const escaped = value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n");
        parts.push(`${key}={'${escaped}'}`);
      } else {
        parts.push(`${key}="${safeJsxString(value)}"`);
      }
    } else if (typeof value === "number" || typeof value === "boolean") {
      parts.push(`${key}={${String(value)}}`);
    } else if (Array.isArray(value)) {
      // Serialize array as JSX expression: `prop={[...]}`
      parts.push(`${key}={${JSON.stringify(value, jsonReplacer)}}`);
    } else if (typeof value === "object") {
      parts.push(`${key}={${JSON.stringify(value, jsonReplacer)}}`);
    }
  }

  return parts.join(" ");
}

/** Safely replace undefined/null values in JSON serialisation. */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (value === undefined) return null;
  return value;
}
