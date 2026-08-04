"use client";

import { useRef, useCallback, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Menu, LayoutGrid } from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useEditorUiStore } from "@/features/editor/ui/editor-ui-store";
import { SectionRenderer } from "@/features/editor/renderer/SectionRenderer";
import { scrollSectionIntoView } from "@/features/editor/utils/scroll-section-into-view";
import { InlineEditLayer } from "@/features/inline-editing/components/InlineEditLayer";
import { useInlineEditShortcuts } from "@/features/inline-editing/hooks/useInlineEditShortcuts";
import { useGuidedBuilderStore } from "@/features/guided-builder/store/guided-builder-store";
import { GuidedStartScreen } from "@/features/guided-builder/components/GuidedStartScreen";


// ---------------------------------------------------------------------------
// Viewport width map
// ---------------------------------------------------------------------------

const VIEWPORT_WIDTHS: Record<string, string> = {
  desktop: "1440px",
  tablet: "768px",
  mobile: "390px",
};

// ---------------------------------------------------------------------------
// Theme → CSS variables
// ---------------------------------------------------------------------------

function themeToCSSVars(theme: import("@/types/theme").Theme): React.CSSProperties {
  const p = theme.palette;
  return {
    "--background": p.background,
    "--foreground": p.foreground,
    "--primary": p.primary,
    "--primary-foreground": p.primaryForeground,
    "--secondary": p.secondary,
    "--secondary-foreground": p.secondaryForeground,
    "--muted": p.muted,
    "--muted-foreground": p.mutedForeground,
    "--accent": p.accent,
    "--accent-foreground": p.accentForeground,
    "--border": p.border,
    "--card": p.card,
    "--card-foreground": p.cardForeground,
    "--font-family": theme.typography.fontFamily,
    "--font-heading": theme.typography.headingFont,
    "--font-base-size": theme.typography.baseSize,
    "--spacing-padding": theme.spacing.sectionPadding,
    "--spacing-container": theme.spacing.containerMaxWidth,
    "--spacing-gap": theme.spacing.gap,
    "--radius-sm": theme.radius.sm,
    "--radius-md": theme.radius.md,
    "--radius-lg": theme.radius.lg,
    "--radius-xl": theme.radius.xl,
    "--radius-full": theme.radius.full,
    "--shadow-sm": theme.shadows.sm,
    "--shadow-md": theme.shadows.md,
    "--shadow-lg": theme.shadows.lg,
    "--shadow-xl": theme.shadows.xl,
  } as React.CSSProperties;
}

// ---------------------------------------------------------------------------
// Empty canvas state
// ---------------------------------------------------------------------------

function EmptyCanvasState() {
  const openAddSectionDialog = useEditorUiStore((s) => s.openAddSectionDialog);

  return (
    <div className="flex w-full flex-col items-center justify-center px-8 py-16">
      <div data-testid="empty-canvas" className="flex max-w-md flex-col items-center gap-6 text-center">
        {/* Subtle wireframe illustration */}
        <div className="relative flex h-36 w-56 items-center justify-center rounded-xl border border-border/40 bg-card/40">
          <div className="absolute left-4 right-4 top-3 h-2 rounded bg-border/30" />
          <div className="absolute left-4 top-8 h-1.5 w-12 rounded bg-border/20" />
          <div className="absolute bottom-8 left-4 right-4 h-16 rounded-lg border border-border/30 bg-card/30" />
          <div className="absolute bottom-8 left-6 top-12 w-1.5 rounded-full bg-accent/30" />
          <Sparkles className="h-8 w-8 text-text-dim/40" />
        </div>

        <div>
          <h2 className="text-xl font-semibold tracking-tight text-text-primary">
            Start building your page
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">
            Add a section from the library or describe what you want and
            Buildora will generate it with AI.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => openAddSectionDialog({ initialType: "hero" })}
            data-testid="empty-add-hero"
            className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95"
          >
            <Sparkles className="h-4 w-4" />
            Add Hero
          </button>
          <button
            type="button"
            onClick={() => openAddSectionDialog({ initialType: "header" })}
            data-testid="empty-add-header"
            className="flex h-9 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95"
          >
            <Menu className="h-4 w-4" />
            Add Header
          </button>
          <button
            type="button"
            onClick={() => openAddSectionDialog()}
            data-testid="empty-browse-sections"
            className="flex h-9 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95"
          >
            <LayoutGrid className="h-4 w-4" />
            Browse Sections
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generation overlay (inside canvas, not fullscreen)
// Uses a simple animation — detailed 7-stage progress is in the chat sidebar
// ---------------------------------------------------------------------------

function GenerationOverlay() {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-base/60 backdrop-blur-[2px]">
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10">
          <motion.div
            animate={{ scale: [1, 1.08, 1] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          >
            <Sparkles className="h-6 w-6 text-accent" />
          </motion.div>
        </div>
        <p className="text-sm text-text-muted">Generating your website...</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Canvas() {
  const project = useEditorStore((s) => s.project);
  const selectedPageId = useEditorStore((s) => s.selectedPageId);
  const viewport = useEditorStore((s) => s.viewport);
  const zoom = useEditorStore((s) => s.zoom);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const isGeneratingStore = useEditorStore((s) => s.isGenerating);

  const isGenerating = isGeneratingStore;
  const experienceMode = useGuidedBuilderStore((s) => s.experienceMode);
  const guidedHydrated = useGuidedBuilderStore((s) => s.hydrated);
  const guided = guidedHydrated && experienceMode === "guided";

  const canvasRef = useRef<HTMLDivElement>(null);
  const prevProjectRef = useRef<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Detect project replacement for fade-in transition
  useEffect(() => {
    if (!project.id) return;
    if (project.id === prevProjectRef.current) return;
    prevProjectRef.current = project.id;
    setIsTransitioning(true);
    const timer = setTimeout(() => setIsTransitioning(false), 350);
    return () => clearTimeout(timer);
  }, [project.id]);

  // Determine the active page
  const activePage =
    project.pages.find((p) => p.id === selectedPageId) ?? project.pages[0];
  const hasSections = activePage && activePage.sections.length > 0;


  const handleBgClick = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  // Inline editing (Phase M) — floating toolbar/popover layer + shortcuts.
  useInlineEditShortcuts();

  // Selection sync — when a section is selected from the STRUCTURE panel (or
  // programmatically via insert/duplicate), scroll the canvas element into
  // view. Canvas-initiated clicks are excluded via selectionSource so we never
  // re-center a section the user is already looking at. Scrolling never
  // changes selection, so this cannot cause an infinite scroll loop.
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);
  const selectionSource = useEditorUiStore((s) => s.selectionSource);
  const prevSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      selectedSectionId &&
      prevSelectedRef.current !== selectedSectionId &&
      selectionSource !== "canvas"
    ) {
      scrollSectionIntoView(selectedSectionId, { block: "center" });
    }
    prevSelectedRef.current = selectedSectionId;
  }, [selectedSectionId, selectionSource]);

  const viewportWidth = VIEWPORT_WIDTHS[viewport] ?? "1440px";
  const zoomPercent = zoom / 100;

  return (
    <main
      ref={canvasRef}
      data-testid="editor-root"
      className="relative flex flex-1 min-w-0 min-h-0 flex-col items-center justify-center bg-secondary p-6"
      onClick={handleBgClick}
    >
      {/* ---- Browser frame ---- */}
      <div
        data-testid="preview-frame"
        className="relative flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 shadow-card transition-all duration-300"
        style={{
          width: viewportWidth,
          maxWidth: "100%",
          transform: `scale(${zoomPercent})`,
          transformOrigin: "top center",
          height: zoomPercent !== 1 ? `calc(100% / ${zoomPercent})` : "100%",
        }}
      >
        {/* ---- Browser bar ---- */}
        <div className="flex items-center gap-3 border-b border-border/40 bg-secondary/80 px-4 py-3 flex-shrink-0">
          {/* Traffic lights */}
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-red-500/80" />
            <span className="h-3 w-3 rounded-full bg-yellow-500/80" />
            <span className="h-3 w-3 rounded-full bg-green-500/80" />
          </div>

          <div className="flex-1 text-center">
            <span className="text-xs font-medium tracking-wide text-text-dim/60">
              PREVIEW
            </span>
          </div>

          <div className="w-[54px]" />
        </div>

        {/* ---- Website content ---- */}
        <div
          id="preview-content"
          data-testid="preview-content"
          data-preview-root
          className="relative flex-1 min-h-0 overflow-y-auto"
          style={{
            ...themeToCSSVars(project.theme),
            background: "var(--background, #ffffff)",
            color: "var(--foreground, #0a0a0a)",
            fontFamily: "var(--font-family, Geist, system-ui, sans-serif)",
            opacity: isTransitioning ? 0.6 : 1,
            transition: "opacity 350ms ease-in-out",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Generation overlay (during active generation with existing project) */}
          <AnimatePresence>
            {isGenerating && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <GenerationOverlay />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Existing project dimming during generation */}
          {hasSections && isGenerating && (
            <style>{`
              [data-preview-root] > :not(.absolute) {
                opacity: 0.5;
                filter: blur(1px);
                pointer-events: none;
                transition: opacity 300ms, filter 300ms;
              }
            `}</style>
          )}

          {/* Website content or empty state */}
          {hasSections ? (
            <>
              {isTransitioning && (
                <style>{`
                  [data-preview-root] > :first-child {
                    animation: previewFadeIn 350ms ease-out;
                  }
                  @keyframes previewFadeIn {
                    from { opacity: 0; transform: translateY(8px); }
                    to { opacity: 1; transform: translateY(0); }
                  }
                `}</style>
              )}
              {/* Phase N: guided start banner on a new/nearly-blank page */}
              {guided &&
                !isGenerating &&
                activePage &&
                activePage.sections.filter((s) => s.visible).length <= 1 && (
                  <div className="px-8 pt-6">
                    <GuidedStartScreen
                      compact
                      pageId={activePage.id}
                      existingSectionIds={new Set(activePage.sections.map((s) => s.id))}
                    />
                  </div>
                )}
              <SectionRenderer
                sections={activePage.sections}
                pageId={activePage.id}
                showInsertionPoints={guided && !isGenerating}
              />
            </>
          ) : (
            !isGenerating &&
            (guided ? (
              <div className="px-8 py-16">
                <GuidedStartScreen
                  pageId={activePage?.id ?? ""}
                  existingSectionIds={new Set()}
                />
              </div>
            ) : (
              <EmptyCanvasState />
            ))
          )}
        </div>
      </div>

      {/* Inline editing layer (Phase M) — floats above the preview frame */}
      <InlineEditLayer />
    </main>
  );
}
