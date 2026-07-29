# Interactive Editor

## Section Selection

- **Hover** a section → subtle purple outline appears
- **Click** a section → strong purple outline + floating type label
- **Click outside** the website content → selection clears
- Selection is stored in Zustand as `selectedSectionId`

The selection layer is provided by `SelectableSection.tsx`, which wraps every rendered section automatically in the `SectionRenderer`.

## Inspector Panel

When a section is selected, the **RightSidebar** switches from the general properties view to a contextual inspector panel showing:

- The section name and type
- Editable controls for every prop (headline, text, prices, etc.)
- Shared controls (visibility, alignment, padding, duplicate, delete)
- A back button to return to general properties

All changes update the preview instantly via `updateSectionProps`/`updateSectionStyles`.

## Viewport Switching

Three viewport modes: **Desktop** (1440px), **Tablet** (768px), **Mobile** (390px).

The preview container animates to the selected width. The browser frame remains visible. Website content scrolls inside the frame while editor chrome stays fixed.

## Zoom

Zoom levels: 50%, 75%, 90%, 100%, 125%.

Zoom is applied via CSS `transform: scale()` on the preview container, preserving proportions and keeping the preview centered.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+Z | Undo |
| Ctrl+Shift+Z | Redo |
| Ctrl+Y | Redo (Windows) |
| Ctrl+D | Duplicate selected section |
| Delete / Backspace | Delete selected section |

Shortcuts are suppressed when the user is typing in any `input`, `textarea`, `select`, or `[contenteditable]` element.
