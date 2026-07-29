import type { Theme } from "@/types/theme";
import type { OutputFile } from "../pipeline/types";

// ---------------------------------------------------------------------------
// Generates app/globals.css — Tailwind v4 @theme directive with project theme
//
// Tailwind v4 uses @theme { } in CSS to define the design token scale.
// This replaces the v3 tailwind.config.ts `extend` pattern.
// ---------------------------------------------------------------------------

export function generateGlobalsCss(theme: Theme): OutputFile {
  const p = theme.palette;
  const t = theme.typography;
  const s = theme.spacing;
  const r = theme.radius;
  const sh = theme.shadows;

  const css = `@import "tailwindcss";

/* ------------------------------------------------------------------ */
/*  Buildora-generated theme                                           */
/* ------------------------------------------------------------------ */
@theme {
  /* ---- Palette ---- */
  --color-background: ${p.background};
  --color-foreground: ${p.foreground};
  --color-primary: ${p.primary};
  --color-primary-foreground: ${p.primaryForeground};
  --color-secondary: ${p.secondary};
  --color-secondary-foreground: ${p.secondaryForeground};
  --color-muted: ${p.muted};
  --color-muted-foreground: ${p.mutedForeground};
  --color-accent: ${p.accent};
  --color-accent-foreground: ${p.accentForeground};
  --color-border: ${p.border};
  --color-card: ${p.card};
  --color-card-foreground: ${p.cardForeground};

  /* ---- Typography ---- */
  --font-sans: ${t.fontFamily};
  --font-heading: ${t.headingFont};
  --text-base-size: ${t.baseSize};
  --text-scale: ${t.scale};

  /* ---- Spacing ---- */
  --spacing-section: ${s.sectionPadding};
  --spacing-container: ${s.containerMaxWidth};
  --spacing-gap: ${s.gap};

  /* ---- Border radius ---- */
  --radius-sm: ${r.sm};
  --radius-md: ${r.md};
  --radius-lg: ${r.lg};
  --radius-xl: ${r.xl};
  --radius-full: ${r.full};

  /* ---- Shadows ---- */
  --shadow-sm: ${sh.sm};
  --shadow-md: ${sh.md};
  --shadow-lg: ${sh.lg};
  --shadow-xl: ${sh.xl};
}

/* ------------------------------------------------------------------ */
/*  Base styles                                                        */
/* ------------------------------------------------------------------ */
html {
  scroll-behavior: smooth;
}

body {
  font-family: var(--font-sans, system-ui, sans-serif);
  font-size: var(--text-base-size, 16px);
  color: var(--color-foreground, #0a0a0a);
  background: var(--color-background, #ffffff);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
`;

  return { path: "app/globals.css", content: css };
}
