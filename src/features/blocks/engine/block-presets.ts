// ---------------------------------------------------------------------------
// Block presets — named presets mapped onto EXISTING style values (Phase O)
//
// Presets never introduce a second styling engine: every override below uses
// the same style tokens the section renderers already consume (spacing, corner
// radius, shadow depth, background color). Deterministic and pure — no React,
// no DOM, no store.
// ---------------------------------------------------------------------------

import type { BlockPreset } from "../types";

// ---------------------------------------------------------------------------
// Button presets
// ---------------------------------------------------------------------------

const BUTTON_PRESETS: BlockPreset[] = [
  {
    id: "button-primary",
    kind: "button",
    label: "Primary",
    description: "A filled button that stands out as the main action.",
    applyProps: { buttonStyle: "primary" },
    applyStyles: {
      background: "var(--accent)",
      color: "#ffffff",
      borderWidth: 0,
      borderRadius: 10,
      shadowDepth: "medium",
    },
  },
  {
    id: "button-secondary",
    kind: "button",
    label: "Secondary",
    description: "A lighter button for supporting actions.",
    applyProps: { buttonStyle: "secondary" },
    applyStyles: {
      background: "var(--bg-muted)",
      color: "var(--text-primary)",
      borderWidth: 0,
      borderRadius: 10,
      shadowDepth: "none",
    },
  },
  {
    id: "button-outline",
    kind: "button",
    label: "Outline",
    description: "A bordered button with a transparent fill.",
    applyProps: { buttonStyle: "outline" },
    applyStyles: {
      background: "transparent",
      color: "var(--text-primary)",
      borderWidth: 1,
      borderColor: "var(--border)",
      borderRadius: 10,
      shadowDepth: "none",
    },
  },
  {
    id: "button-ghost",
    kind: "button",
    label: "Ghost",
    description: "A quiet text-only button with no background.",
    applyProps: { buttonStyle: "ghost" },
    applyStyles: {
      background: "transparent",
      color: "var(--accent)",
      borderWidth: 0,
      borderRadius: 10,
      shadowDepth: "none",
    },
  },
  {
    id: "button-glass",
    kind: "button",
    label: "Glass",
    description: "A translucent button with a frosted look.",
    applyProps: { buttonStyle: "glass" },
    applyStyles: {
      background: "rgba(255,255,255,0.12)",
      color: "#ffffff",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.24)",
      borderRadius: 12,
      shadowDepth: "none",
      backdropFilter: "blur(12px)",
    },
  },
  {
    id: "button-gradient",
    kind: "button",
    label: "Gradient",
    description: "A vivid gradient fill that draws the eye.",
    applyProps: { buttonStyle: "gradient" },
    applyStyles: {
      background: "linear-gradient(135deg, var(--accent), #8b5cf6)",
      color: "#ffffff",
      borderWidth: 0,
      borderRadius: 12,
      shadowDepth: "large",
    },
  },
];

// ---------------------------------------------------------------------------
// Image presets
// ---------------------------------------------------------------------------

const IMAGE_PRESETS: BlockPreset[] = [
  {
    id: "image-rounded",
    kind: "image",
    label: "Rounded",
    description: "Softly rounded corners for a friendly look.",
    applyStyles: { borderRadius: 12, shadowDepth: "none", objectFit: "cover" },
  },
  {
    id: "image-circle",
    kind: "image",
    label: "Circle",
    description: "A circular crop — great for portraits and logos.",
    applyStyles: { borderRadius: 9999, shadowDepth: "small", objectFit: "cover" },
  },
  {
    id: "image-shadow",
    kind: "image",
    label: "Shadow",
    description: "A floating card look with a soft shadow.",
    applyStyles: { borderRadius: 8, shadowDepth: "medium", objectFit: "cover" },
  },
  {
    id: "image-frame",
    kind: "image",
    label: "Frame",
    description: "A thin border frame like a printed photograph.",
    applyStyles: {
      borderRadius: 4,
      borderWidth: 2,
      borderColor: "var(--border)",
      shadowDepth: "none",
      padding: 4,
      background: "#ffffff",
      objectFit: "cover",
    },
  },
];

// ---------------------------------------------------------------------------
// Card presets
// ---------------------------------------------------------------------------

const CARD_PRESETS: BlockPreset[] = [
  {
    id: "card-minimal",
    kind: "card",
    label: "Minimal",
    description: "A clean card with a subtle border.",
    applyStyles: {
      background: "var(--bg-card)",
      borderWidth: 1,
      borderColor: "var(--border)",
      borderRadius: 12,
      shadowDepth: "none",
      padding: 24,
    },
  },
  {
    id: "card-glass",
    kind: "card",
    label: "Glass",
    description: "A translucent card that works over imagery.",
    applyStyles: {
      background: "rgba(255,255,255,0.08)",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.16)",
      borderRadius: 16,
      shadowDepth: "medium",
      padding: 24,
      backdropFilter: "blur(16px)",
    },
  },
  {
    id: "card-dark",
    kind: "card",
    label: "Dark",
    description: "A confident dark card.",
    applyStyles: {
      background: "#0f1117",
      color: "#f8fafc",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.08)",
      borderRadius: 12,
      shadowDepth: "large",
      padding: 24,
    },
  },
  {
    id: "card-outline",
    kind: "card",
    label: "Outline",
    description: "A crisp outline with no fill.",
    applyStyles: {
      background: "transparent",
      borderWidth: 1.5,
      borderColor: "var(--accent)",
      borderRadius: 12,
      shadowDepth: "none",
      padding: 24,
    },
  },
  {
    id: "card-premium",
    kind: "card",
    label: "Premium",
    description: "A elevated card with a soft shadow.",
    applyStyles: {
      background: "var(--bg-card)",
      borderWidth: 0,
      borderRadius: 16,
      shadowDepth: "large",
      padding: 32,
    },
  },
];

// ---------------------------------------------------------------------------
// Lookup + listing
// ---------------------------------------------------------------------------

const ALL_PRESETS: BlockPreset[] = [
  ...BUTTON_PRESETS,
  ...IMAGE_PRESETS,
  ...CARD_PRESETS,
];

const BY_ID = new Map(ALL_PRESETS.map((p) => [p.id, p]));

export function getButtonPreset(id: string): BlockPreset | undefined {
  const preset = BY_ID.get(id);
  return preset && preset.kind === "button" ? preset : undefined;
}

export function getCardPreset(id: string): BlockPreset | undefined {
  const preset = BY_ID.get(id);
  return preset && preset.kind === "card" ? preset : undefined;
}

export function getImagePreset(id: string): BlockPreset | undefined {
  const preset = BY_ID.get(id);
  return preset && preset.kind === "image" ? preset : undefined;
}

/** Deterministic list of every preset (for library chips). */
export function listPresets(): BlockPreset[] {
  return [...ALL_PRESETS];
}
