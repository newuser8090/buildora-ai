# Phase P7 — Architecture Decisions

This document records the decisions made before building Phase P7
(beginner-first publishing, launch readiness, preview modes, and deployment
history). It answers the four questions posed in the Phase P7 brief and notes
the integration points with prior phases.

## A. Which publishing fields belong in ProjectSchema

`Project.siteSettings` (new, optional, backward compatible) holds everything a
visitor would see or that describes the site as content:

```ts
interface SiteSettings {
  siteName: string;
  siteDescription?: string;
  language?: string;
  favicon?: AssetRef;
  seo?: { title?, description?, keywords?, canonicalUrl?, robotsIndex?, robotsFollow? };
  social?: { title?, description?, image?: AssetRef };
  appearance?: { themeColor?: string };
}
```

Why in the schema:

- It is content — it is exported with the project, imported with the project,
  edited with undo/history, and versioned.
- The existing persistence pipeline (normalizer → ProjectSchema → serializer)
  already guarantees schema-validated round-tripping; adding an optional field
  is the smallest backward-compatible change.
- No deployment credentials, tokens, or provider secrets ever live in
  ProjectSchema.

`PageMeta` is extended with per-page search/social fields (`seoTitle`,
`seoDescription`, `socialTitle`, `socialDescription`, `socialImage`,
`index`, `canonicalUrl`). Home-page semantics are preserved (index 0 is always
the homepage route `/`), and the export pipeline uses per-page metadata with
deterministic fallbacks.

## B. Which publish/deployment state belongs outside ProjectSchema

Deployments are operational history, not site content:

- `DeploymentRecord` lives in `src/features/publishing/types.ts` and is
  persisted to a dedicated IndexedDB store `deployments` (database version 6).
- It is never exported with the project, never imported, never part of undo
  history, and never touched by autosave.
- The publish pipeline computes a deterministic `exportHash` and stores the
  `projectRevision` and a `contentHash` so "unpublished changes" can be
  detected without regenerating the export on every keystroke.

## C. Which readiness checks are pure derived state

All of them. `src/features/launch-readiness/` is a pure, deterministic engine:

- `getLaunchReadinessReport(project)` returns a 0–100 score plus per-check
  findings (id, category, status, title, explanation, affected element,
  suggested action, fix-action id, severity, weight).
- No AI, no side effects, no history, no autosave. Memoized at the hook level.
- The existing Guided Builder readiness score (Phase N) remains the
  page-level in-editor score; the Launch Center exposes the site-level score
  and deeper detail. The two are deliberately complementary: Guided Builder
  answers "is this page built well?", Launch Center answers "is this site
  ready to launch?". Both are derived from the same project state and neither
  is persisted.

Only genuinely invalid export/security/project-schema states block
publishing; warnings never block.

## D. Publishing provider abstraction

```ts
interface PublishingProvider {
  id: string;
  label: string;
  isAvailable(): Promise<ProviderAvailability>;
  publish(input: PublishInput, onProgress): Promise<PublishResult>;
  getDeployment(id): Promise<DeploymentRecord | null>;
  listDeployments(projectId): Promise<DeploymentRecord[]>;
  rollback?(deploymentId): Promise<DeploymentRecord>;
  deleteDeployment?(deploymentId): Promise<void>;
}
```

Implementations:

1. `LocalExportPublishingProvider` — always available. Runs the canonical
   export pipeline and downloads the site ZIP. The guaranteed fallback.
2. `MockPublishingProvider` — dev/E2E only. Simulates prepare → build →
   upload → live (and failure/cancel paths), returns a demo URL that opens the
   internal visitor preview. Never claims public internet availability.

A real production provider is intentionally NOT implemented in P7: the repo
has no secure deployment credentials, and the brief forbids half-secure
integrations. The provider registry reads environment variables
(`PUBLISH_PROVIDER`, optional per-provider tokens, server-only, never
`NEXT_PUBLIC_`); missing vars gracefully disable only that provider. See
`.env.example`.

## E. Preview architecture

- `src/features/preview/store/preview-store.ts` — UI state (open, device,
  current route).
- `src/features/preview/engine/navigation.ts` — pure safe-href resolution:
  internal routes navigate, `mailto:`/`tel:` are allowed, external
  `http(s)` open in a new tab with `noopener`, and unsafe schemes
  (`javascript:`, `data:` text/html, etc.) are blocked.
- `PreviewShell` — full-screen visitor shell (device presets: phone, tablet,
  desktop, full window; exit restores editor state).
- `/preview/[projectId]` — standalone read-only preview route used as the
  mock provider's demo URL and for opening a preview in a new tab. It loads
  the project from IndexedDB and renders with no editor overlays.

## F. Publish pipeline

validate project → readiness (non-blocking) → export validation (blocking) →
generate export files → deterministic export hash → create deployment record →
invoke provider (with progress) → persist final state → success/failure UI.
Publishing never mutates project content; the provider receives a snapshot.

## G. Files touched in existing features

- `src/types/project.ts`, `src/features/generation/schemas/generation-plan-schema.ts`
- `src/features/persistence/{services/project-normalizer,services/project-serializer,constants,services/db-schema}.ts`
- `src/features/editor/store/editor-store.ts`, `page-structure.ts`
- `src/features/export/generators/{layout-generator,page-generator,project-generator,asset-export-manifest}.ts`
- `src/components/editor/{TopNav,PageMetaDialog}.tsx`
- `src/app/editor/[projectId]/page.tsx`, `src/app/page.tsx`
- `src/features/projects/components/ProjectCard.tsx`
- `src/features/guided-builder/{types,store/guided-builder-store,engine/building-journey,hooks/useGuidedBuilder,components/CommandPalette}.ts(x)`
