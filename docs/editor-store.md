# Editor Store

The editor state is managed via **Zustand** (`src/features/editor/store/editor-store.ts`).

## State Shape

| Property | Type | Description |
|----------|------|-------------|
| `project` | `Project` | The current project being edited |
| `selectedPageId` | `string \| null` | Currently selected page |
| `selectedSectionId` | `string \| null` | Currently selected section |
| `viewport` | `"desktop" \| "tablet" \| "mobile"` | Preview viewport mode |
| `zoom` | `number` | Zoom percentage (50, 75, 90, 100, 125) |
| `isGenerating` | `boolean` | AI generation in progress |
| `generationProgress` | `number` | 0–100 progress indicator |
| `history` | `History` | Undo/redo stack |

## History

```typescript
interface History {
  past: Project[];    // Previous states
  present: Project;   // Current state
  future: Project[];  // Future states (for redo)
}
```

Every project-mutating action (`updateSection`, `updateSectionProps`, `duplicateSection`, `deleteSection`, etc.) automatically snapshots the current state into `past` and clears `future`.

## Actions

| Action | Description |
|--------|-------------|
| `initProject(p)` | Replace project entirely (no history snapshot) |
| `setProject(p)` | Replace project (with history snapshot) |
| `selectSection(id)` | Set selected section |
| `clearSelection()` | Deselect section |
| `selectPage(id)` | Set selected page |
| `setViewport(v)` | Change viewport |
| `setZoom(z)` | Change zoom percentage |
| `updateSection(id, partial)` | Update section fields |
| `updateSectionProps(id, props)` | Merge props into section |
| `updateSectionStyles(id, styles)` | Merge styles into section |
| `reorderSection(pageId, sectionId, order)` | Change section order |
| `duplicateSection(id)` | Clone a section (appends after source) |
| `deleteSection(id)` | Remove section (blocked if last on page) |
| `undo()` | Restore previous state |
| `redo()` | Restore next state |
| `canUndo()` / `canRedo()` | Check history availability |
