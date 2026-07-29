"use client";

import { useState, createElement } from "react";
import { cn } from "@/utils/cn";
import {
  ChevronDown,
  Palette,
  FileText,
  Layout,
  Type,
  PaintBucket,
  Maximize,
} from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { inspectorRegistry } from "@/features/editor/registry/inspector-registry";
import { sectionRegistry } from "@/features/editor/registry/section-registry";
import type { BaseSection } from "@/types/section";

// ---------------------------------------------------------------------------
// General properties (shown when no section is selected)
// ---------------------------------------------------------------------------

interface Category {
  id: string;
  label: string;
  icon: typeof Palette;
  description: string;
}

const categories: Category[] = [
  { id: "theme", label: "Theme", icon: Palette, description: "Appearance & layout" },
  { id: "pages", label: "Pages", icon: FileText, description: "Manage your pages" },
  { id: "sections", label: "Sections", icon: Layout, description: "Page structure" },
  { id: "typography", label: "Typography", icon: Type, description: "Fonts & text" },
  { id: "colors", label: "Colors", icon: PaintBucket, description: "Color scheme" },
  { id: "spacing", label: "Spacing", icon: Maximize, description: "Margins & padding" },
];

function GeneralProperties() {
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      {categories.map((cat) => {
        const Icon = cat.icon;
        const isOpen = openSections.has(cat.id);
        return (
          <div key={cat.id} className="border-b border-border/50 last:border-b-0">
            <button
              onClick={() => toggle(cat.id)}
              className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors duration-200 hover:bg-card/40"
            >
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-card/50">
                <Icon className="h-3.5 w-3.5 text-text-dim" />
              </div>
              <div className="flex-1">
                <span className="text-sm font-medium text-text-muted">{cat.label}</span>
                {isOpen && (
                  <p className="mt-0.5 text-xs text-text-dim">{cat.description}</p>
                )}
              </div>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-text-dim/60 transition-transform duration-200",
                  isOpen && "rotate-180",
                )}
              />
            </button>
            <div
              className={cn(
                "grid transition-all duration-200 ease-in-out",
                isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="overflow-hidden">
                <div className="px-5 pb-4 pt-0.5">
                  <div className="rounded-lg border border-dashed border-border/40 px-4 py-5 text-center">
                    <p className="text-xs text-text-dim/60">
                      {cat.label} controls will appear here
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Section inspector header
// ---------------------------------------------------------------------------

const SECTION_LABELS: Record<string, string> = {
  header: "Header",
  hero: "Hero",
  features: "Features",
  pricing: "Pricing",
  faq: "FAQ",
  cta: "CTA",
  footer: "Footer",
};

function getSectionLabel(type: string): string {
  return SECTION_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

// ---------------------------------------------------------------------------
// Inspector panel
// ---------------------------------------------------------------------------

function InspectorPanel() {
  const project = useEditorStore((s) => s.project);
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);
  const updateSectionProps = useEditorStore((s) => s.updateSectionProps);
  const updateSectionStyles = useEditorStore((s) => s.updateSectionStyles);
  const clearSelection = useEditorStore((s) => s.clearSelection);

  // Find the selected section across all pages
  let selectedSection = null;
  for (const page of project.pages) {
    const found = page.sections.find((s) => s.id === selectedSectionId);
    if (found) {
      selectedSection = found;
      break;
    }
  }

  if (!selectedSection) {
    return <GeneralProperties />;
  }

  const typeLabel = getSectionLabel(selectedSection.type);

  return (
    <div className="flex flex-col">
      {/* Inspector header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div>
          <button
            type="button"
            onClick={clearSelection}
            className="text-xs text-text-dim/60 hover:text-text-dim transition-colors mb-0.5"
          >
            ← Properties
          </button>
          <h3 className="text-sm font-semibold text-text-primary">{typeLabel}</h3>
          <p className="text-xs text-text-dim/60">{selectedSection.type}</p>
        </div>
      </div>

      {/* Inspector body */}
      <div className="flex-1 overflow-y-auto" data-testid="inspector-panel">
        <InspectorSlot
          section={selectedSection}
          onUpdateProps={(props) =>
            updateSectionProps(selectedSection.id, props)
          }
          onUpdateStyles={(styles) =>
            updateSectionStyles(selectedSection.id, styles)
          }
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InspectorSlot — resolves the inspector component from the registry
// and renders it. Extracted into a separate component to avoid the
// "components created during render" ESLint rule.
// ---------------------------------------------------------------------------

function InspectorSlot({
  section,
  onUpdateProps,
  onUpdateStyles,
}: {
  section: BaseSection;
  onUpdateProps: (props: Record<string, unknown>) => void;
  onUpdateStyles: (styles: Record<string, unknown>) => void;
}) {
  const InspectorComponent = inspectorRegistry.get(section.type);
  const isRegistered = sectionRegistry.has(section.type);

  if (!InspectorComponent || !isRegistered) {
    return (
      <div className="px-5 py-8 text-center">
        <p className="text-xs text-text-dim/60">
          No inspector available for &ldquo;{section.type}&rdquo;
        </p>
      </div>
    );
  }

  return createElement(InspectorComponent, {
    section,
    onUpdateProps,
    onUpdateStyles,
  });
}

// ---------------------------------------------------------------------------
// RightSidebar
// ---------------------------------------------------------------------------

export function RightSidebar() {
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);

  return (
    <aside className="flex w-[300px] flex-shrink-0 min-h-0 flex-col border-l border-border bg-secondary">
      {/* ---- Header ---- */}
      <div className="border-b border-border px-5 py-4 flex-none">
        <h2 className="text-sm font-semibold text-text-primary">Properties</h2>
        <p className="mt-0.5 text-xs text-text-dim">
          {selectedSectionId
            ? "Editing selected section"
            : "Customize your website appearance and content"}
        </p>
      </div>

      {/* ---- Content ---- */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <InspectorPanel />
      </div>
    </aside>
  );
}
