// ---------------------------------------------------------------------------
// ThumbnailProjectPreview
//
// Read-only preview surface used by thumbnail generation. Renders the FIRST
// page's visible sections (in order) through the section registry with theme
// CSS variables applied. No selection wrappers, no inspector controls, no
// editor toolbar, no Zustand, no persistence, no project hydration.
//
// The caller (ThumbnailGenerationService) mounts this inside a hidden
// offscreen container, waits for readiness, captures, then unmounts it.
// ---------------------------------------------------------------------------

"use client";

import { createElement } from "react";
import { sectionRegistry } from "@/features/editor/registry/section-registry";
import { SectionAssetProvider } from "@/features/editor/hooks/useSectionAssets";
import type { Project } from "@/types/project";
import type { CSSProperties } from "react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ThumbnailProjectPreviewProps {
  project: Project;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Theme → CSS variables (same mapping as the editor Canvas preview)
// ---------------------------------------------------------------------------

export function themeToCSSVars(theme: Project["theme"]): CSSProperties {
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
  } as CSSProperties;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ThumbnailProjectPreview({
  project,
  width,
  height,
}: ThumbnailProjectPreviewProps) {
  const firstPage = project.pages[0];

  const visibleSections = (firstPage?.sections ?? [])
    .filter((s) => s.visible !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return (
    <div
      data-testid="thumbnail-preview-root"
      style={{
        ...themeToCSSVars(project.theme),
        width: `${width}px`,
        height: `${height}px`,
        overflow: "hidden",
        background: "var(--background, #ffffff)",
        color: "var(--foreground, #0a0a0a)",
        fontFamily: "var(--font-family, Geist, system-ui, sans-serif)",
        fontSize: "var(--font-base-size, 16px)",
        lineHeight: 1.5,
        // Disable all animation/transition/hover behavior deterministically.
        animation: "none",
        transition: "none",
      }}
    >
      {/* Force-disable animations and transitions inside the captured surface */}
      <style>{`
        [data-testid="thumbnail-preview-root"] *,
        [data-testid="thumbnail-preview-root"] *::before,
        [data-testid="thumbnail-preview-root"] *::after {
          animation: none !important;
          animation-duration: 0s !important;
          transition: none !important;
          transition-duration: 0s !important;
        }
      `}</style>

      <SectionAssetProvider assets={project.assets}>
        {visibleSections.map((section) => {
          const Component = sectionRegistry.get(section.type);
          if (!Component) return null;
          return createElement(Component, {
            key: section.id,
            section,
          });
        })}
      </SectionAssetProvider>
    </div>
  );
}
