# Product Quality Checklist (Phase P9)

Internal development checklist — documentation, not a runtime feature. Use it
before shipping any Buildora surface. Every area lists what "good" means for
Buildora and where to look.

---

## 1. Empty states

Every empty state should answer three questions:

1. **What is this?** — a clear heading.
2. **Why would I use it?** — one plain sentence.
3. **What can I do next?** — an obvious action button.

| Surface | Check |
|---|---|
| Dashboard (no projects) | Guided setup + New Project + Import actions |
| Dashboard (no search results) | "Clear search" action |
| Dashboard (archived) | Back-to-projects action |
| Template gallery (no results) | "Try a different search or category" copy |
| Personal templates | "Save as template" guidance |
| My Blocks library | Save/import actions |
| Collections | Create-collection action |
| Shared libraries | Create/join actions |
| Deployment history | Publish CTA |
| Launch Center | First publish guidance |
| Recovery dialog (no backups) | "Backups appear automatically" copy |

## 2. Loading

- Skeleton/pulse placeholders, not blank flashes.
- Loading states never move focus unexpectedly.
- Long operations show progress (spinner + label) and disable the trigger.

## 3. Errors

- User-safe copy, structured codes behind the scenes — never raw stack traces.
- Every error has a recovery path: Retry, Open backup, Restore, or Download.
- Errors are dismissible and never block unrelated actions.
- Persistence errors keep the editor usable (blank fallback + hydration error).

## 4. Keyboard

- Real shortcuts only (see `src/features/help/keyboard-shortcuts.ts`).
- Dialogs trap focus and restore focus on close.
- Cards and menus are fully keyboard-accessible (Enter/Space, Esc).

## 5. Responsive

- Dashboard, template gallery, template preview, recovery dialog, help,
  project menus: desktop → tablet → mobile, no horizontal overflow.
- No precision-only interactions (e.g. tiny hover-only menus get a tap target).

## 6. Accessibility

- Semantic buttons/labels; status is never color-only.
- Card actions reachable (menu button visible on focus for keyboard users).
- Templates searchable without a mouse.
- `prefers-reduced-motion` respected (no required animations).
- Empty states have proper headings.

## 7. Offline

- StatusBar shows "Offline — saved on this device" when the device is offline.
- Local-first saves always succeed regardless of connectivity.
- Cloud sync failures degrade gracefully ("saved on this device").

## 8. Cloud

- Sync status never contradicts the save status.
- Sign-out / account switch never leaks another user's data.
- First connection creates every store (shared schema helper).

## 9. Preview

- Visitor preview reuses the section registry — no separate renderer.
- Device presets work and never mutate the project.
- Unsafe URLs are rejected before render/open.

## 10. Publish

- Publish button label reflects state ("Publish updates" when dirty).
- Deleting a project never silently deletes the live site (explicit opt-in).
- Rollback is never faked; confirmation always required.
- Deployment/domain records never contain tokens or secrets.

## 11. Templates

- Deterministic, versioned, schema-valid; fresh IDs on create-from-template.
- Personal templates are local-only, bounded (25), validated, deep-cloned.
- No deployment/domain/sync/auth state copied into a template.
- Preview never creates or persists a project.

## 12. Recovery

- Backups bounded (5/project), oldest evicted, live project never evicted.
- Recovery never auto-overwrites — explicit confirmation required.
- Corrupted records are preserved (never overwritten on failed load).

## 13. Performance (soft budgets)

- Editor hydration and template gallery load are recorded (transient, in-memory).
- Large projects (100+ sections, 500+ blocks) render without obvious jank;
  lists are memoized, thumbnails lazy.
- No wall-clock assertions in unit tests — deterministic counts only.
