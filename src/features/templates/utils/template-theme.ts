// ---------------------------------------------------------------------------
// createTemplateTheme — fresh, independent Theme objects for templates
//
// Templates never share a module-level theme object: every call returns a
// brand-new deep object so two projects created from the same template can
// never share mutable theme references.
// ---------------------------------------------------------------------------

import type { Theme } from "@/types/theme";

const BASE_THEME: Theme = {
  palette: {
    background: "#ffffff",
    foreground: "#0a0a0a",
    primary: "#7c5cfc",
    primaryForeground: "#ffffff",
    secondary: "#f5f5f5",
    secondaryForeground: "#0a0a0a",
    muted: "#f5f5f5",
    mutedForeground: "#737373",
    accent: "#7c5cfc",
    accentForeground: "#ffffff",
    border: "#e5e5e5",
    card: "#ffffff",
    cardForeground: "#0a0a0a",
  },
  typography: {
    fontFamily: "Geist, system-ui, sans-serif",
    headingFont: "Geist, system-ui, sans-serif",
    baseSize: "16px",
    scale: 1.25,
  },
  spacing: {
    sectionPadding: "5rem 0",
    containerMaxWidth: "1120px",
    gap: "1.5rem",
  },
  radius: {
    sm: "0.375rem",
    md: "0.5rem",
    lg: "0.75rem",
    xl: "1rem",
    full: "9999px",
  },
  shadows: {
    sm: "0 1px 2px rgba(0,0,0,0.05)",
    md: "0 4px 6px rgba(0,0,0,0.07)",
    lg: "0 10px 15px rgba(0,0,0,0.1)",
    xl: "0 20px 25px rgba(0,0,0,0.15)",
  },
};

export type TemplateThemeOverrides = {
  palette?: Partial<Theme["palette"]>;
  typography?: Partial<Theme["typography"]>;
  spacing?: Partial<Theme["spacing"]>;
  radius?: Partial<Theme["radius"]>;
  shadows?: Partial<Theme["shadows"]>;
};

/**
 * Return a fresh, deep-independent Theme. Overrides are shallow-merged at each
 * nested group — the result shares nothing with BASE_THEME or prior results.
 */
export function createTemplateTheme(overrides?: TemplateThemeOverrides): Theme {
  return {
    palette: { ...BASE_THEME.palette, ...overrides?.palette },
    typography: { ...BASE_THEME.typography, ...overrides?.typography },
    spacing: { ...BASE_THEME.spacing, ...overrides?.spacing },
    radius: { ...BASE_THEME.radius, ...overrides?.radius },
    shadows: { ...BASE_THEME.shadows, ...overrides?.shadows },
  };
}
