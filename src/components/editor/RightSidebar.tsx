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
  Layers,
  SlidersHorizontal,
  Boxes,
  LayoutGrid,
  Database,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useEditorUiStore } from "@/features/editor/ui/editor-ui-store";
import { PageStructurePanel } from "@/features/editor/components/PageStructurePanel";
import { inspectorRegistry } from "@/features/editor/registry/inspector-registry";
import { sectionRegistry } from "@/features/editor/registry/section-registry";
import { useGuidedBuilderStore } from "@/features/guided-builder/store/guided-builder-store";
import { GuidedPanel } from "@/features/guided-builder/components/GuidedPanel";
import { GuidedInspector } from "@/features/guided-builder/components/GuidedInspector";
import { BlockEditorPanel } from "@/features/blocks/components/BlockEditorPanel";
import { ElementInspectorPanel } from "@/features/inspector/components/ElementInspectorPanel";
import { ElementLibrary } from "@/features/library/components/ElementLibrary";
import { DataPanel } from "@/features/integrations/components/DataPanel";
import { CUSTOM_BLOCK_SECTION_TYPE } from "@/features/code-import/schemas/custom-block-schema";
import type { BaseSection } from "@/types/section";
// Phase P22-K — collapsible/resizable shell chrome (UI-only, no project state).
import { MAX_PANEL_WIDTH, MIN_PANEL_WIDTH } from "@/features/editor/ui/editor-ui-prefs";
import { ResizeHandle } from "./ResizeHandle";

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

function InspectorPanel({ guided }: { guided: boolean }) {
  const project = useEditorStore((s) => s.project);
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);
  const updateSectionProps = useEditorStore((s) => s.updateSectionProps);
  const updateSectionStyles = useEditorStore((s) => s.updateSectionStyles);
  const clearSelection = useEditorStore((s) => s.clearSelection);

  // Find the selected section across all pages (tracking its page for the
  // element inspector's commit path).
  let selectedSection = null;
  let selectedPageId = "";
  for (const page of project.pages) {
    const found = page.sections.find((s) => s.id === selectedSectionId);
    if (found) {
      selectedSection = found;
      selectedPageId = page.id;
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
          pageId={selectedPageId}
          guided={guided}
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
  pageId,
  guided,
  onUpdateProps,
  onUpdateStyles,
}: {
  section: BaseSection;
  pageId: string;
  guided: boolean;
  onUpdateProps: (props: Record<string, unknown>) => void;
  onUpdateStyles: (styles: Record<string, unknown>) => void;
}) {
  const InspectorComponent = inspectorRegistry.get(section.type);
  const isRegistered = sectionRegistry.has(section.type);

  // Phase N: guided mode uses the simplified inspector (advanced controls
  // stay reachable through "More options").
  if (guided) {
    return (
      <GuidedInspector
        section={section}
        onUpdateProps={onUpdateProps}
        onUpdateStyles={onUpdateStyles}
      />
    );
  }

  // Phase P22-C: custom-block sections carry fully editable + durable element
  // trees, so they use the universal element inspector. Regular sections keep
  // their section-specific inspectors (existing E2E surface preserved).
  if (section.type === CUSTOM_BLOCK_SECTION_TYPE) {
    return <ElementInspectorPanel pageId={pageId} sectionId={section.id} />;
  }

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
// RightSidebar — Structure / Design tabs
//
// Tab selection is ephemeral UI state (editor-ui-store), never part of the
// Project model and never persisted. Selecting a section on canvas does NOT
// forcibly switch tabs; adding a section switches to Design once.
// ---------------------------------------------------------------------------

interface TabDefinition {
  id: "structure" | "elements" | "data" | "design" | "blocks";
  label: string;
  icon: typeof Layers;
}

const TABS: TabDefinition[] = [
  { id: "structure", label: "Structure", icon: Layers },
  { id: "elements", label: "Elements", icon: LayoutGrid },
  // Phase P22-J — data integrations + collection management.
  { id: "data", label: "Data", icon: Database },
  { id: "blocks", label: "Blocks", icon: Boxes },
  { id: "design", label: "Design", icon: SlidersHorizontal },
];

function TabList() {
  const tab = useEditorUiStore((s) => s.rightSidebarTab);
  const setTab = useEditorUiStore((s) => s.setRightSidebarTab);

  return (
    <div
      role="tablist"
      aria-label="Editor panels"
      className="flex border-b border-border"
    >
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`right-tab-${t.id}`}
            aria-selected={active}
            aria-controls={`right-panel-${t.id}`}
            tabIndex={active ? 0 : -1}
            data-testid={`right-tab-${t.id}`}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              // Arrow-key tab navigation (roving tabindex)
              const idx = TABS.findIndex((x) => x.id === t.id);
              let next: TabDefinition | null = null;
              if (e.key === "ArrowRight") next = TABS[idx + 1] ?? TABS[0];
              if (e.key === "ArrowLeft") next = TABS[idx - 1] ?? TABS[TABS.length - 1];
              if (next) {
                e.preventDefault();
                setTab(next.id);
                document.getElementById(`right-tab-${next.id}`)?.focus();
              }
            }}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors",
              active
                ? "border-b-2 border-accent text-text-primary"
                : "text-text-dim hover:text-text-primary",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function RightSidebar() {
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);
  const tab = useEditorUiStore((s) => s.rightSidebarTab);
  const rightCollapsed = useEditorUiStore((s) => s.rightPanelCollapsed);
  const rightWidth = useEditorUiStore((s) => s.rightPanelWidth);
  const setRightCollapsed = useEditorUiStore((s) => s.setRightPanelCollapsed);
  const setRightWidth = useEditorUiStore((s) => s.setRightPanelWidth);
  const [rightDragging, setRightDragging] = useState(false);
  const experienceMode = useGuidedBuilderStore((s) => s.experienceMode);
  const guidedHydrated = useGuidedBuilderStore((s) => s.hydrated);
  const guided = guidedHydrated && experienceMode === "guided";

  if (rightCollapsed) {
    return (
      <>
        <aside
          data-testid="right-sidebar-rail"
          className="flex w-12 flex-shrink-0 flex-col items-center gap-4 border-l border-border bg-secondary py-3"
          aria-label="Editor sidebar (collapsed)"
        >
          <button
            type="button"
            data-testid="collapse-right-panel"
            aria-expanded="false"
            aria-controls="editor-sidebar"
            aria-label="Expand editor sidebar"
            title="Expand editor sidebar"
            onClick={() => setRightCollapsed(false)}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent transition-colors hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
          <span
            aria-hidden="true"
            className="text-[10px] font-medium uppercase tracking-[0.2em] text-text-dim/60 [writing-mode:vertical-rl]"
          >
            Panels
          </span>
        </aside>
      </>
    );
  }

  return (
    <>
      <ResizeHandle
        testId="resize-right-handle"
        label="Resize editor sidebar"
        value={rightWidth}
        min={MIN_PANEL_WIDTH}
        max={MAX_PANEL_WIDTH}
        multiplier={-1}
        onChange={setRightWidth}
        onDraggingChange={setRightDragging}
      />
      <aside
        id="editor-sidebar"
        className={cn(
          "flex min-h-0 flex-shrink-0 flex-col border-l border-border bg-secondary transition-[width] duration-200 ease-out",
          rightDragging && "transition-none",
        )}
        style={{ width: rightWidth }}
        aria-label="Editor sidebar"
      >
        {/* ---- Collapse header ---- */}
        <div className="flex h-8 flex-shrink-0 items-center justify-between border-b border-border px-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-text-dim/70">
            Panels
          </span>
          <button
            type="button"
            data-testid="collapse-right-panel"
            aria-expanded="true"
            aria-controls="editor-sidebar"
            aria-label="Collapse editor sidebar"
            title="Collapse editor sidebar"
            onClick={() => setRightCollapsed(true)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-card hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* ---- Tabs ---- */}
        <TabList />

      {/* ---- Panels ---- */}
      {tab === "structure" ? (
        <div
          role="tabpanel"
          id="right-panel-structure"
          aria-labelledby="right-tab-structure"
          data-testid="structure-panel"
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {/* Phase N: guided journey / readiness / coach above the structure */}
          {guided && <GuidedPanel />}
          <PageStructurePanel />
        </div>
      ) : tab === "elements" ? (
        <div
          role="tabpanel"
          id="right-panel-elements"
          aria-labelledby="right-tab-elements"
          data-testid="elements-panel"
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* Phase P22-D — discover + insert elements from the registry */}
          <ElementLibrary />
        </div>
      ) : tab === "data" ? (
        <div
          role="tabpanel"
          id="right-panel-data"
          aria-labelledby="right-tab-data"
          data-testid="data-panel"
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* Phase P22-J — connect integrations + manage collections */}
          <DataPanel />
        </div>
      ) : tab === "blocks" ? (
        <div
          role="tabpanel"
          id="right-panel-blocks"
          aria-labelledby="right-tab-blocks"
          data-testid="blocks-panel"
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* Phase O: LEGO builder engine — build tree + block inspector */}
          <BlockEditorPanel />
        </div>
      ) : (
        <div
          role="tabpanel"
          id="right-panel-design"
          aria-labelledby="right-tab-design"
          data-testid="design-panel"
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* ---- Header ---- */}
          <div className="border-b border-border px-5 py-4 flex-none">
            <h2 className="text-sm font-semibold text-text-primary">Properties</h2>
            <p className="mt-0.5 text-xs text-text-dim">
              {selectedSectionId
                ? guided
                  ? "Edit the selected part"
                  : "Editing selected section"
                : guided
                  ? "Choose something on your page to edit it"
                  : "Customize your website appearance and content"}
            </p>
          </div>

          {/* ---- Content ---- */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <InspectorPanel guided={guided} />
          </div>
        </div>
      )}
      </aside>
    </>
  );
}
