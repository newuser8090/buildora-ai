// ---------------------------------------------------------------------------
// Help (Phase P9) — keyboard shortcut registry
//
// Only REAL shortcuts implemented in the app are listed. Nothing is invented
// for the dialog. Groups mirror the app's surfaces: Editing, Navigation, AI,
// Preview, Publishing. Palette-only commands are listed with a hint instead
// of a key chord.
// ---------------------------------------------------------------------------

export type ShortcutGroupId =
  | "editing"
  | "navigation"
  | "ai"
  | "preview"
  | "publishing";

export interface ShortcutEntry {
  id: string;
  label: string;
  /** Key chord, e.g. "Ctrl/⌘ + Z". Empty when the action lives in the palette. */
  keys: string;
  hint?: string;
}

export interface ShortcutGroup {
  id: ShortcutGroupId;
  title: string;
  entries: ShortcutEntry[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    id: "editing",
    title: "Editing",
    entries: [
      { id: "save", label: "Save your project", keys: "Ctrl/⌘ + S" },
      { id: "undo", label: "Undo your last change", keys: "Ctrl/⌘ + Z" },
      { id: "redo", label: "Redo the change you undid", keys: "Ctrl/⌘ + Shift + Z" },
      { id: "redo-win", label: "Redo (Windows)", keys: "Ctrl + Y" },
      {
        id: "duplicate-section",
        label: "Duplicate the selected part",
        keys: "Ctrl/⌘ + D",
        hint: "Only when a part is selected.",
      },
      {
        id: "delete-section",
        label: "Delete the selected part",
        keys: "Delete / Backspace",
        hint: "Only when a part is selected.",
      },
    ],
  },
  {
    id: "navigation",
    title: "Navigation",
    entries: [
      {
        id: "command-palette",
        label: "Open the command palette",
        keys: "Ctrl/⌘ + K",
        hint: "Search every action by plain language.",
      },
      {
        id: "close-dialogs",
        label: "Close a dialog or menu",
        keys: "Esc",
      },
    ],
  },
  {
    id: "ai",
    title: "AI",
    entries: [
      {
        id: "open-copilot",
        label: "Open the AI Copilot",
        keys: "Ctrl/⌘ + Shift + A",
        hint: "Ask questions or describe changes — you approve before anything applies.",
      },
      {
        id: "ask-ai",
        label: "Ask AI for help",
        keys: "",
        hint: "In the command palette (Ctrl/⌘ + K).",
      },
    ],
  },
  {
    id: "preview",
    title: "Preview",
    entries: [
      {
        id: "preview-site",
        label: "Preview your website",
        keys: "",
        hint: "Use the Preview button or the command palette.",
      },
      {
        id: "preview-mobile",
        label: "Preview on a phone",
        keys: "",
        hint: "In the command palette (Ctrl/⌘ + K).",
      },
    ],
  },
  {
    id: "publishing",
    title: "Publishing",
    entries: [
      {
        id: "publish",
        label: "Publish your website",
        keys: "",
        hint: "Use the Publish button or the command palette.",
      },
      {
        id: "check-site",
        label: "Check your website readiness",
        keys: "",
        hint: "Use the Launch Center or the command palette.",
      },
    ],
  },
];

/** Plain-language total — used by the dialog header. */
export const SHORTCUT_COUNT = SHORTCUT_GROUPS.reduce(
  (count, group) => count + group.entries.length,
  0,
);
