// ---------------------------------------------------------------------------
// Theme model — controls the visual appearance of a generated website
// ---------------------------------------------------------------------------

export interface ThemePalette {
  background: string;
  foreground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  border: string;
  card: string;
  cardForeground: string;
}

export interface ThemeTypography {
  fontFamily: string;
  headingFont: string;
  baseSize: string;
  scale: number;
}

export interface ThemeSpacing {
  sectionPadding: string;
  containerMaxWidth: string;
  gap: string;
}

export interface ThemeRadius {
  sm: string;
  md: string;
  lg: string;
  xl: string;
  full: string;
}

export interface ThemeShadows {
  sm: string;
  md: string;
  lg: string;
  xl: string;
}

export interface Theme {
  palette: ThemePalette;
  typography: ThemeTypography;
  spacing: ThemeSpacing;
  radius: ThemeRadius;
  shadows: ThemeShadows;
}
