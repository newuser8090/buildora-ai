"use client";

// ---------------------------------------------------------------------------
// VisitorPageView — plain site rendering for visitor preview
//
// Renders visible sections through the section registry WITHOUT any editor
// chrome: no selection borders, no inline edit controls, no drag handles,
// no insertion points. Mirrors how the exported site renders.
// ---------------------------------------------------------------------------

import { createElement } from "react";
import { sectionRegistry } from "@/features/editor/registry/section-registry";
import { ErrorBoundary } from "@/features/editor/components/ErrorBoundary";
import { validateSectionSafe } from "@/features/editor/schemas/section-schemas";
import type { Project, Page } from "@/types/project";
import type { BaseSection } from "@/types/section";
import type { ReactNode } from "react";

function VisitorSection({ section }: { section: BaseSection }) {
  const Component = sectionRegistry.get(section.type);
  if (!Component) return null;
  return (
    <ErrorBoundary>
      {createElement(Component, { section })}
    </ErrorBoundary>
  );
}

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

export interface VisitorPageViewProps {
  project: Project;
  page: Page;
}

export function VisitorPageView({ project, page }: VisitorPageViewProps) {
  const visible = page.sections
    .filter((s) => s.visible)
    .sort((a, b) => a.order - b.order);

  const nodes: ReactNode[] = visible.map((section) => {
    const validation = validateSectionSafe(section);
    const validSection = validation.success
      ? (validation.data as BaseSection)
      : section;
    return <VisitorSection key={section.id} section={validSection} />;
  });

  return (
    <div
      data-testid="visitor-preview-content"
      style={{
        ...themeToCSSVars(project.theme),
        background: "var(--background, #ffffff)",
        color: "var(--foreground, #0a0a0a)",
        fontFamily: "var(--font-family, Geist, system-ui, sans-serif)",
        minHeight: "100%",
      }}
    >
      {nodes}
    </div>
  );
}
