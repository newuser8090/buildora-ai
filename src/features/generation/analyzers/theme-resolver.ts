import type { ThemeStyle } from "../types/generation-plan";
import type { Theme } from "@/types/theme";

// ---------------------------------------------------------------------------
// Theme Resolver — maps theme styles to predefined design tokens
// ---------------------------------------------------------------------------

const THEMES: Record<ThemeStyle, Theme> = {
  // ---- Modern (light, purple accent) ----
  modern: {
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
    typography: { fontFamily: "Geist, system-ui, sans-serif", headingFont: "Geist, system-ui, sans-serif", baseSize: "16px", scale: 1.25 },
    spacing: { sectionPadding: "5rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
    radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
    shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
  },

  // ---- Minimal (light, neutral, spacious) ----
  minimal: {
    palette: {
      background: "#fafafa",
      foreground: "#171717",
      primary: "#171717",
      primaryForeground: "#ffffff",
      secondary: "#f5f5f5",
      secondaryForeground: "#171717",
      muted: "#f0f0f0",
      mutedForeground: "#787878",
      accent: "#171717",
      accentForeground: "#ffffff",
      border: "#e5e5e5",
      card: "#ffffff",
      cardForeground: "#171717",
    },
    typography: { fontFamily: "Geist, system-ui, sans-serif", headingFont: "Geist, system-ui, sans-serif", baseSize: "16px", scale: 1.2 },
    spacing: { sectionPadding: "6rem 0", containerMaxWidth: "960px", gap: "2rem" },
    radius: { sm: "0.25rem", md: "0.375rem", lg: "0.5rem", xl: "0.75rem", full: "9999px" },
    shadows: { sm: "0 1px 2px rgba(0,0,0,0.03)", md: "0 2px 4px rgba(0,0,0,0.04)", lg: "0 4px 8px rgba(0,0,0,0.05)", xl: "0 8px 16px rgba(0,0,0,0.06)" },
  },

  // ---- Dark (dark bg, light text) ----
  dark: {
    palette: {
      background: "#0a0a0a",
      foreground: "#fafafa",
      primary: "#7c5cfc",
      primaryForeground: "#ffffff",
      secondary: "#1a1a1a",
      secondaryForeground: "#e5e5e5",
      muted: "#1a1a1a",
      mutedForeground: "#a3a3a3",
      accent: "#7c5cfc",
      accentForeground: "#ffffff",
      border: "#262626",
      card: "#171717",
      cardForeground: "#fafafa",
    },
    typography: { fontFamily: "Geist, system-ui, sans-serif", headingFont: "Geist, system-ui, sans-serif", baseSize: "16px", scale: 1.25 },
    spacing: { sectionPadding: "5rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
    radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
    shadows: { sm: "0 1px 2px rgba(0,0,0,0.2)", md: "0 4px 6px rgba(0,0,0,0.3)", lg: "0 10px 15px rgba(0,0,0,0.4)", xl: "0 20px 25px rgba(0,0,0,0.5)" },
  },

  // ---- Light (bright, blue-ish, friendly) ----
  light: {
    palette: {
      background: "#ffffff",
      foreground: "#0a0a0a",
      primary: "#2563eb",
      primaryForeground: "#ffffff",
      secondary: "#f8fafc",
      secondaryForeground: "#0a0a0a",
      muted: "#f1f5f9",
      mutedForeground: "#64748b",
      accent: "#2563eb",
      accentForeground: "#ffffff",
      border: "#e2e8f0",
      card: "#ffffff",
      cardForeground: "#0a0a0a",
    },
    typography: { fontFamily: "Geist, system-ui, sans-serif", headingFont: "Geist, system-ui, sans-serif", baseSize: "16px", scale: 1.25 },
    spacing: { sectionPadding: "5rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
    radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
    shadows: { sm: "0 1px 2px rgba(0,0,0,0.04)", md: "0 4px 6px rgba(0,0,0,0.05)", lg: "0 10px 15px rgba(0,0,0,0.06)", xl: "0 20px 25px rgba(0,0,0,0.08)" },
  },

  // ---- Luxury (gold/premium feel) ----
  luxury: {
    palette: {
      background: "#fcfbf9",
      foreground: "#1a1a1a",
      primary: "#b8860b",
      primaryForeground: "#ffffff",
      secondary: "#f5f0e8",
      secondaryForeground: "#1a1a1a",
      muted: "#f0ece4",
      mutedForeground: "#8a7a5a",
      accent: "#b8860b",
      accentForeground: "#ffffff",
      border: "#d4c5a9",
      card: "#ffffff",
      cardForeground: "#1a1a1a",
    },
    typography: { fontFamily: "Geist, system-ui, serif", headingFont: "Geist, system-ui, serif", baseSize: "17px", scale: 1.3 },
    spacing: { sectionPadding: "6rem 0", containerMaxWidth: "1120px", gap: "2rem" },
    radius: { sm: "0.5rem", md: "0.75rem", lg: "1rem", xl: "1.25rem", full: "9999px" },
    shadows: { sm: "0 1px 3px rgba(0,0,0,0.06)", md: "0 4px 8px rgba(0,0,0,0.08)", lg: "0 10px 20px rgba(0,0,0,0.1)", xl: "0 20px 30px rgba(0,0,0,0.12)" },
  },

  // ---- Startup (vibrant, teal/indigo) ----
  startup: {
    palette: {
      background: "#ffffff",
      foreground: "#0f172a",
      primary: "#6366f1",
      primaryForeground: "#ffffff",
      secondary: "#f0fdf4",
      secondaryForeground: "#0f172a",
      muted: "#f1f5f9",
      mutedForeground: "#64748b",
      accent: "#10b981",
      accentForeground: "#ffffff",
      border: "#e2e8f0",
      card: "#ffffff",
      cardForeground: "#0f172a",
    },
    typography: { fontFamily: "Geist, system-ui, sans-serif", headingFont: "Geist, system-ui, sans-serif", baseSize: "16px", scale: 1.25 },
    spacing: { sectionPadding: "5rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
    radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
    shadows: { sm: "0 1px 2px rgba(0,0,0,0.04)", md: "0 4px 8px rgba(0,0,0,0.06)", lg: "0 10px 20px rgba(0,0,0,0.08)", xl: "0 20px 30px rgba(0,0,0,0.1)" },
  },
};

export function getThemeTokens(themeStyle: ThemeStyle): Theme {
  return THEMES[themeStyle] ?? THEMES.modern;
}

export { THEMES as THEME_TOKENS };
