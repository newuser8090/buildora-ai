# Phase P9 — Architecture Decisions

This document records the decisions made before building Phase P9 (product
polish, templates, growth loops & production readiness). It builds on the
foundation of Phases N (guided builder), O–P3 (block engine + import),
P4–P5 (My Blocks library), P6 (auth + cloud sync), P7 (Launch Center +
publishing abstraction), and P8 (real Vercel publishing + custom domains).

Scope boundaries: this phase adds NO billing, NO marketplace monetization,
NO public community marketplace, NO live multiplayer editing, and NO full
analytics suite. The public read-only share link (§45) and the
`.buildora-template.json` file format (§44) are explicitly deferred and
documented as Phase P10 candidates.

## A. Template model

The existing `BuildoraTemplate` model (`src/features/templates/types.ts`) is
kept and extended — it is not replaced.

- Templates are **deterministic fixtures**: no React, no Zustand, no
  persistence adapters, no `crypto.randomUUID()`, no runtime timestamps.
  All identity and time values are injected through
  `TemplateCreationContext`.
- A template **builds a fresh Project** via `createProject(context)` using
  injected page/section IDs. It never shares mutable references across
  calls.
- `BuildoraTemplate` gains an optional `source` field
  (`"builtin" | "personal"`, defaulting to `"builtin"`) and an optional
  `difficulty` (`"beginner" | "intermediate" | "advanced"`) for the card UI
  and plain-language labels. Both are backward-compatible additions.
- Categories remain the internal `TemplateCategory` union (blank, business,
  portfolio, commerce, food, landing-page) plus two P9 additions: `event`
  and `personal`, so beginner language ("Create an event page", "Build a
  personal page") maps to real categories.

**No second project model is created.** Personal templates wrap/derive from
the existing Project schema (see §B).

## B. Personal template persistence

Personal templates ("Save this project as a template") live **locally in
IndexedDB only** in P9.

- New object store `personalTemplates` (database version 8), keyed by a
  fresh `personal-…` id.
- Record shape `PersonalTemplateRecord`:
  - `id`, `name`, `description`, `category`, `tags`
  - `createdAt`, `updatedAt`
  - `source: "personal"`
  - `project`: a **deep-cloned Project snapshot** (validated through the
    existing Project schema before storage)
- Storage is **bounded**: `MAX_PERSONAL_TEMPLATES` (25). When the cap is
  reached the save is rejected with a beginner-safe message ("You've saved a
  lot of templates. Delete one before adding another.") — never a silent
  overwrite.
- The deployment provider is the remote source of truth; **no deployment
  records, custom-domain records, cloud sync queues/markers, or auth
  session state are ever copied** into a personal template. The Project
  schema itself carries no such state, and the conversion layer strips
  persistence-only metadata.
- Cloud sync is NOT wired for personal templates in P9 (documented
  limitation; a future phase can sync them cleanly).

### Create-from-personal-template semantics

When a personal template is used to create a new project:

1. The stored snapshot is deep-cloned.
2. Fresh project ID + fresh page/section/block IDs are assigned through the
   same `TemplateIdFactory` mechanism used by built-in templates.
3. Timestamps are reset (`createdAt = updatedAt = now`).
4. Content, styles, theme, site settings, and assets are retained.
5. Deployment history, domain records, sync markers, and revision history
   are NOT retained (they were never stored in the template).
6. The result passes through the existing `ProjectSchema` validation before
   persistence (the factory contract).

## C. Built-in template registry

- The `TemplateRegistry` singleton and idempotent
  `registerDefaultTemplates()` are unchanged and remain the single source of
  truth for built-ins.
- P9 adds two polished built-ins that map to beginner language:
  - **Event** (`template-event`, category `event`) — hero, details,
    schedule, RSVP CTA, footer.
  - **Personal Profile** (`template-personal`, category `personal`) —
    intro, about, skills, experience, contact CTA, footer.
- Built-ins remain deterministic and versioned by stable IDs
  (`template-<slug>`), with `featured`, `sortOrder`, `defaultName`,
  `tags`, and a `preview` model. Templates are never mutated by the
  registry.

## D. Preview strategy

- The existing `TemplatePreview` model (deterministic CSS mock — no
  screenshots, no iframes, no remote images) is reused for **both**
  built-in and personal templates.
- Personal templates derive a `TemplatePreview` from their stored project
  deterministically: accent = theme palette primary, background = theme
  background, sections = mapped from the first page's section types. No
  separate renderer is introduced.
- Previewing never creates or persists a project.

## E. Draft recovery strategy

- New object store `recoverySnapshots` (database version 8).
- `RecoverySnapshot`: `id`, `projectId`, `revision`, `createdAt`, `reason`,
  `project` (validated deep clone), optional `hash`.
- **Capture points**: after a successful persisted save (autosave or manual)
  the controller captures a last-known-good snapshot (throttled, e.g. at
  most one per project per interval to avoid per-keystroke writes).
- **Retention**: bounded — last `MAX_RECOVERY_SNAPSHOTS_PER_PROJECT` (5) per
  project, oldest evicted first. Snapshots never evict the live project.
- **Recovery path**: when opening a project fails schema validation on
  load, the raw record is preserved (never overwritten), a sanitized
  diagnostic code is logged, and the Recovery Dialog offers Restore /
  Preview backup / Keep current version. Restoring writes the snapshot back
  through the normal save path (a new revision) — it never auto-overwrites
  without explicit confirmation.

## F. Project lifecycle actions

- **Duplicate** (already in P7): fresh project ID, fresh revision 1, fresh
  timestamps, duplicate-safe name ("Project Copy", "Project Copy 2"), deep
  clone, no thumbnail copy. Deployments/domains/sync markers are never
  copied because they are stored OUTSIDE ProjectSchema keyed by projectId.
- **Archive (new)**: a dashboard metadata flag (`isArchived`). Archived
  projects are hidden from the main grid, listed in an Archived view, and
  can be restored. Archiving never deletes the project or its remote
  deployments. No retention policy is added.
- **Delete**: existing P8 flow retained — project deletion never silently
  deletes the live production site; the dialog offers the explicit
  "Also remove the published site" opt-in only when the provider supports
  secure deletion.

## G. Performance instrumentation

- A lightweight, **transient** client-side measurement module
  (`src/features/perf/`) records soft metrics (editor hydration duration,
  template gallery render, preview open, publish dialog open, block count).
- Measurements live in an in-memory bounded ring; nothing is persisted, and
  nothing is sent anywhere unless explicitly enabled. No tracking analytics.
- Soft budgets are documented (not enforced with flaky wall-clock unit
  thresholds); tests assert deterministic operation counts only.

## H. Product-polish scope boundaries

In scope (P9): template gallery polish, personal templates, archive/restore,
dashboard search/sort/empty states, contextual help + keyboard shortcuts
dialog, autosave/status message coherence, undo/redo feedback (lightweight,
label-based only where meaningful), draft recovery, performance
instrumentation, beginner copy on new surfaces, accessibility/responsive
polish on new surfaces, and the `docs/product-quality-checklist.md`.

Explicitly OUT of scope (deferred to P10 or later):
- `.buildora-template.json` file export format (§44) — documented, not built.
- Public read-only share link (§45) — deferred; ownership/revocation model
  needs a server component.
- Product tour (§49) — existing onboarding already covers the journey;
  a tour would add forced friction.
- Billing, marketplace, live multiplayer, analytics, plugin ecosystem.
