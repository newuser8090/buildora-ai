# Phase P13 — Template Packages & Project Portability

## 1. Phase goal

Buildora users can save a project as a **personal template**, export that template
as a **portable `.buildora-template` package**, move/send it to another Buildora
installation, import it there (after a safe preview), and create brand-new,
fully independent projects from it — with assets intact.

The package format is deterministic, versioned, strictly validated, bounded,
secure, and forward-compatible. The product stays beginner-friendly: import is a
single "Choose file → preview → Install" flow with safe copy and no raw errors.

## 2. Non-goals

- **No template marketplace** and **no public template publishing**.
- **No cloud template sync** — packages are moved by hand (file transfer).
- **No multiplayer / live collaboration** — inherited from P12 scope.
- **No billing / analytics / notifications**.
- **No project cloud backup** — project portability stays file-based.
- **No new project format** — the existing `.buildora.json` (format v1 envelope,
  `SerializedBuildoraProject` migration pipeline) is already correct and stays
  canonical. P13 audits it and proves the round trip in E2E; it does not replace it.
- **No `DATABASE_VERSION` bump** — imported templates reuse the existing
  `personalTemplates` store (v9). Provenance is an optional record field
  (forward/backward compatible in a key-value object store); no schema migration.

## 3. Current template architecture

- **Built-in templates** — `src/features/templates/templates/*.ts`, registered in
  `templateRegistry` via `registerDefaultTemplates()`. Pure `BuildoraTemplate`
  fixtures with an injected `TemplateCreationContext` (fresh IDs/timestamps come
  from the caller, never from `crypto.randomUUID()` inside the template).
- **Personal templates (P9)** — `PersonalTemplateRecord` in the IndexedDB
  `personalTemplates` store: `{ id: "personal-<uuid>", name, description,
  category, tags, createdAt, updatedAt, source: "personal", project }` where
  `project` is a deep-cloned, `ProjectSchema`-validated `Project` snapshot.
  Assets live **inside** the project document (`project.assets[]`, each with a
  `data:` URL source) — there is no global asset store.
- **Gallery** — `useTemplateGallery` merges `templateRegistry.list()` with
  personal templates (wrapped by `personalTemplateToBuildoraTemplate`) so
  search/category/preview/Use behave identically.
- **Create project** — `ProjectController.createProjectFromTemplate` routes
  `personal-*` ids to `PersonalTemplateService.createProjectFromPersonalTemplate`
  (fresh project/page/section IDs, fresh timestamps, deep-clone) and everything
  else to `TemplateProjectFactory`. Imported templates get `personal-` ids, so
  they inherit this proven path unchanged.

## 4. Current project serialization architecture

- **Export**: `ProjectExportService` → `BuildoraProjectExport` envelope
  (`format: "buildora-project"`, `formatVersion: 1`, `exportedAt`, `project`,
  `metadata`), deterministic pretty JSON → `downloadProjectFile` (`.buildora.json`).
- **Import**: `ImportProjectDialog` → `readProjectFile` (extension + 10 MB cap) →
  `ProjectImportService.parse` (envelope/format/version checks, structural-depth
  bound, dangerous-keys rejection, unknown-field warnings, `deserializeProject`
  migration pipeline, aggregate page/section/asset limits, name limit) →
  `ProjectService.commitImportedProject` (fresh project ID, validated name,
  rollback-safe metadata init, thumbnail scheduling).
- P13 reuses the same defensive *patterns* (structured errors, user-safe message
  mapping, parse/commit separation, no partial writes) for template packages.

## 5. Package format

A `.buildora-template` file is a **ZIP archive** (JSZip 3.10.1, already a
dependency) with this layout:

```
manifest.json      — format identity + version + asset manifest (inspectable summary)
template.json      — authoritative payload: template metadata + project snapshot
assets/asset-0001.png … — binary asset files (only referenced assets)
```

Rationale: ZIP keeps the package inspectable, uses existing infrastructure, and
keeps the heavy project JSON free of base64 bloat (assets externalized).

## 6. Manifest schema

`manifest.json`:

```jsonc
{
  "format": "buildora-template",      // fixed marker
  "formatVersion": 1,                 // integer, >= 1
  "packageType": "template",          // "template" (P13); "project" reserved
  "exportedAt": "2026-08-09T…Z",      // ISO timestamp of package creation
  "assetCount": 2,
  "totalAssetBytes": 123456,
  "assets": [
    {
      "path": "assets/asset-0001.png", // deterministic, sanitized, deduped
      "assetId": "asset-x",            // original asset id (provenance only)
      "name": "hero.png",              // <= 256 chars
      "mimeType": "image/png",         // must be an allowed image MIME
      "extension": ".png",             // must agree with mimeType
      "size": 12345                    // decoded byte size
    }
  ]
}
```

Validated by `TemplatePackageManifestSchema` (zod, **strict** — unknown keys are
rejected while formatVersion is 1; the schema relaxes on a future version bump).

## 7. Versioning

- `BUILDORA_TEMPLATE_FORMAT_VERSION = 1` — decoupled from `DATABASE_VERSION` and
  from the `.buildora.json` `EXPORT_FORMAT_VERSION`.
- Importer distinguishes: **supported current** (1) · **unsupported** (0 or any
  malformed value) · **too new** (`> 1`, "This template was created with a newer
  version of Buildora") · **malformed** · **wrong package type**.
- Unknown newer formats are **never** silently interpreted.

## 8. Template identity

- Installed templates get a **fresh** `personal-<uuid>` id (never the packaged
  one). The package's original metadata is preserved only as non-authoritative
  provenance (`provenance: { source: "import", packageFormatVersion, exportedAt,
  originalName }`).
- Creating a project from an imported template reuses the P9 path: fresh project
  ID, fresh page IDs, fresh section IDs, fresh timestamps, deep-clone.
  Asset IDs are **project-document-scoped** (assets live in `project.assets[]`),
  so keeping packaged asset IDs is safe for independence; regenerating them would
  require risky reference rewrites for zero isolation benefit. Independence is
  proven by tests (edit one project; template and sibling project unchanged).

## 9. Asset packaging

- Only assets **referenced** by the project are packaged: the union of
  `collectReferencedAssetIds(project)` (typed per-section mapping) and a defensive
  recursive scan for `{ assetId: string }` objects across pages/site-settings.
  Intersected with `project.assets` — dangling refs are dropped; unreferenced
  assets are dropped ("Do not dump the entire asset database").
- **Deduplication**: assets with identical `data:` URL content map to one package
  file path; multiple manifest entries may share a path. Sorted deterministic
  order (`assets/asset-0001.png`, `asset-0002.png`, …).
- **Bounds**: per-asset decoded size ≤ 5 MB (matches the upload cap), asset count
  ≤ 2000 (matches `MAX_ASSETS`), package file ≤ 25 MB, uncompressed total ≤ 50 MB.
- Generated package paths are fixed and sanitized (`assets/asset-NNNN.<ext>`,
  extension derived from MIME). No external local paths, no traversal.
- On import, assets are installed **through the restored project document**
  (`source.value` = canonical `data:<mime>;base64,…`); nothing is written to disk
  and no unrelated asset is touched.

## 10. Import pipeline

```
file selection → file-level validation (extension, size)
→ archive load (JSZip) → archive inspection (count, paths, sizes)
→ manifest parse → schema validation → version/type compatibility
→ template.json parse → project schema validation → asset cross-checks
→ per-asset extraction + MIME/magic/size/script validation
→ fresh identity + conflict-safe name → validated in-memory record
→ user confirmation (preview dialog) → single saveTemplate write
```

Persistence is a **single write after full validation** — a failed import can
never leave a half-installed template (no partial writes by construction).

## 11. Export pipeline

```
record load → ProjectSchema validation → referenced-asset collection
→ decode data URLs → dedupe → size checks → payload build (paths replace sources)
→ manifest build → deterministic ZIP (fixed dates) → Blob + sanitized filename
```

Deterministic core: sorted asset order, fixed JSON key order, canonical base64
encoding, fixed file dates (injected `now`). Timestamps that are *intended*
package metadata (exportedAt) may differ between exports.

## 12. Validation boundaries

- Manifest: strict zod schema (format marker, integer version, type enum,
  bounded metadata, asset entries with path/MIME/extension/size agreement).
- template.json: strict zod schema (name ≤ 80 via `validateProjectName`, desc ≤
  200, tags ≤ 8 × 24, category enum, timestamps) + `ProjectSchema` + per-asset
  `source.value` must match `assets/<file>` pattern.
- Cross-checks: every project asset path exists in the manifest; every manifest
  entry resolves to a project asset; no orphan files; referenced assets exist.

## 13. Sanitization & ZIP security

- **Paths** (`isSafeZipPath`): rejects `..` segments, absolute paths, Windows
  drive letters, backslashes, control chars, empty segments, depth > 4, and any
  entry outside `manifest.json` / `template.json` / `assets/<safe>.<img-ext>`.
- **Entry budget**: ≤ 2000 entries; per-entry decoded size ≤ 5 MB; cumulative
  decoded ≤ 50 MB (enforced during extraction with early abort — a bomb cannot
  allocate unbounded memory).
- **Payload**: dangerous prototype keys (`__proto__`, `prototype`, `constructor`)
  rejected (reuses the project-import `checkDangerousKeys` pattern); structural
  depth bound reused; `javascript:` / `vbscript:` / `data:text/html` string
  values rejected; JSON parse failures → structured errors.
- **Assets**: raster magic-byte checks (PNG/JPEG/WebP) verify MIME claims; SVG is
  text-scanned for `<script`, `javascript:`, and event-handler attributes; the
  project is re-validated through `ProjectSchema` after restoration.
  SVGs render only via `<img>` (never `dangerouslySetInnerHTML`), matching the
  existing upload pipeline's safety posture.
- **No eval / new Function** anywhere; no imported code is ever executed.

## 14. Error taxonomy

`INVALID_FILE_TYPE`, `FILE_READ_FAILED`, `PACKAGE_TOO_LARGE`, `ARCHIVE_INVALID`,
`ARCHIVE_TOO_MANY_FILES`, `ARCHIVE_TOO_LARGE`, `ARCHIVE_ENTRY_UNSAFE`,
`MANIFEST_MISSING`, `MANIFEST_INVALID`, `FORMAT_UNSUPPORTED`, `FORMAT_TOO_NEW`,
`WRONG_PACKAGE_TYPE`, `TEMPLATE_INVALID`, `ASSET_MISSING`, `ASSET_INVALID`,
`ASSET_TOO_LARGE`, `DOWNLOAD_FAILED`, `EXPORT_FAILED`, `IMPORT_FAILED`.

`mapTemplatePackageErrorToMessage()` maps every code to beginner-safe copy.
Users never see stack traces, zod dumps, IndexedDB internals, filesystem paths,
or provider internals.

## 15. Conflict handling

- Importing never overwrites an existing template: a fresh id is always assigned.
- Name conflicts resolve automatically: `Portfolio`, `Portfolio (2)`,
  `Portfolio (3)` (base truncated to stay within the 80-char canonical limit).
- Original package identity is preserved only as provenance metadata.

## 16. ID regeneration

- Import: fresh template id; the packaged project keeps its internal ids in the
  stored snapshot (same as save-as-template today — ids are regenerated at
  project-creation time, never trusted as authoritative for mutation).
- Create-from-template (P9 path, reused): fresh project/page/section ids and
  timestamps; deep-clone guarantees two projects from the same template are fully
  independent (editing one never mutates the template or the other project).

## 17. Project creation semantics

Imported templates are `PersonalTemplateRecord`s. "Use" flows through the
existing gallery/card/factory path (`personal-` routing in
`ProjectController.createProjectFromTemplate`). No second create path.

## 18. Personal-template persistence

Reuses the existing `personalTemplates` store and `PersonalTemplateStorageAdapter`
(quota of 25 enforced by `saveTemplate`). Optional `provenance` field added to
the record type for the "Imported" indicator; no DB version bump, no store-count
test changes, no migration.

## 19. Project portability

Audited: `.buildora.json` (v1 envelope) already enforces fresh identity on
commit, name-conflict suffixes, 10 MB cap, aggregate limits, migration pipeline,
and privacy (deployments/domains/sync/copilot/share data all live outside
`ProjectSchema` and are never serialized). **Decision: keep it unchanged** —
formalizing `.buildora-project` would be churn with zero safety gain. P13 adds
`e2e/project-portability.spec.ts` proving round trip, fresh ID, and privacy.

## 20. Backward compatibility

- All existing built-in and personal templates continue to work unchanged.
- `.buildora.json` import/export unchanged.
- Save-as-template unchanged; exported packages round-trip through the new
  importer and through the old path equivalently.
- `PersonalTemplateRecord` gains an optional field — old records load fine.

## 21. Unsupported/newer-version handling

- formatVersion > 1 → `FORMAT_TOO_NEW` → "This template was created with a newer
  version of Buildora." — never parsed further.
- formatVersion malformed → `FORMAT_UNSUPPORTED` / `MANIFEST_INVALID`.
- packageType ≠ "template" → `WRONG_PACKAGE_TYPE`.
- Missing files / bad JSON → `MANIFEST_MISSING` / `MANIFEST_INVALID` / `TEMPLATE_INVALID`.

## 22. UX flows

- **Export**: Personal Templates panel → card action "Export" → downloads
  `<sanitized-name>.buildora-template`.
- **Import**: entry points are (a) Personal Templates panel → "Import template"
  and (b) New Project dialog → "Import template". Both open the same
  `ImportTemplateDialog`.
- **Dialog**: choose file (picker + drag-drop) → validating → **preview**
  (name, description, category, page/section/asset counts, package size, format
  compatibility, warnings) → **Install template** / Cancel → installing (no
  Escape) → success ("Template installed") with a "Create a project from it"
  shortcut, or a safe error state with "Choose another file".
- Preview never renders imported HTML — it shows metadata only; the visual
  preview uses the existing `personalTemplateToBuildoraTemplate` → TemplateCard
  model when the user browses the library afterwards.
- Imported templates show a subtle "Imported" chip in the panel.

## 23. Accessibility

- Dialog mirrors `ImportProjectDialog`: `role="dialog"` + `aria-modal`, labelled
  file input, focus trap + restoration, Escape when idle (blocked during
  install), visible focus, error `role="alert"` with `aria-describedby`, polite
  live-region announcements for phase changes.
- Drag-drop is an enhancement — the visible "Choose file" button is the keyboard
  path. Mobile: full-width sheets, no horizontal overflow.

## 24. Performance

- JSZip is already a dependency; it is imported **lazily** inside the exporter /
  importer functions so ZIP machinery never loads into the main editor bundle
  unless a package operation runs.
- Import is bounded (entries/bytes caps) so work is strictly limited.
- No N+1: panel/gallery already load personal templates in one `listTemplates()`.
- `markPerf` marks: `template-import-start/end`, `template-export` (local only).

## 25. Security/privacy

Exported packages contain **only** the template metadata + the referenced project
snapshot (with assets). They never contain: auth/session data, provider secrets,
deployment/domain records, share tokens/comments, Copilot conversations/memory,
recovery snapshots, cloud-sync queues/markers, account identifiers, analytics, or
local filesystem paths. Hard privacy is enforced by construction (the record only
holds a `Project`, which by schema carries none of that) and proven by tests that
grep serialized package content.

## 26. Testing strategy

Unit/component: schema, exporter (referenced-only assets, dedupe, determinism,
privacy grep, filename sanitization), importer (valid round trip, every hostile
case, no-partial-install, conflicts, fresh ids, independence), error mapping,
`ImportTemplateDialog` component tests (preview, cancel-does-not-install, install,
error states, Escape, double-submit).

## 27. E2E strategy

- `e2e/template-portability.spec.ts` — create project → save as template →
  export → delete → import → preview → install → create project → content +
  assets verified → independence.
- `e2e/template-import-security.spec.ts` — hostile packages built in Node with
  JSZip and injected via `setInputFiles` buffer: traversal, absolute paths, bomb,
  too many entries, missing/invalid manifest, newer version, wrong type, polluted
  keys, script payloads, oversized/missing assets → safe errors, **no persistence
  mutation**.
- `e2e/project-portability.spec.ts` — `.buildora.json` round trip, fresh ID,
  privacy.

All P13 specs run with `--project=chromium --workers=1`.

## 28. Migration requirements

None. No `DATABASE_VERSION` change, no store changes, no store-count test edits.
The `provenance` record field is optional and additive.

## 29. Integration points

- `src/features/template-packages/**` — new feature dir (constants, types,
  schema, utils, services, components, tests).
- `PersonalTemplatesPanel` — "Import template" button + `ImportTemplateDialog`
  mount + per-card "Export" + "Imported" chip.
- `NewProjectDialog` — "Import template" entry + dialog mount (same component).
- `PersonalTemplateRecord` — optional `provenance` field.
- Reuse: `personalTemplateToBuildoraTemplate`, `PersonalTemplateService`,
  `sanitizeExportFilename`, `validateProjectName`, `collectReferencedAssetIds`,
  `ProjectSchema`, JSZip, `downloadBlob`, `markPerf`.

## 30. Explicit scope boundaries

IN: `.buildora-template` ZIP packages; personal-template export/import; safe
preview; asset portability; conflict handling; fresh identities; privacy tests;
project-portability E2E audit proof.

OUT: marketplace, publishing, cloud sync, project cloud backup, `DATABASE_VERSION`
bump, new project format, editor TopNav changes, command-palette actions,
notification/email, P14.

## 31. File plan

New:
- `src/features/template-packages/constants.ts`
- `src/features/template-packages/types.ts`
- `src/features/template-packages/schema.ts`
- `src/features/template-packages/utils/zip-path.ts`
- `src/features/template-packages/utils/data-url-io.ts`
- `src/features/template-packages/services/asset-collector.ts`
- `src/features/template-packages/services/template-package-exporter.ts`
- `src/features/template-packages/services/template-package-importer.ts`
- `src/features/template-packages/components/ImportTemplateDialog.tsx`
- tests + `e2e/template-portability.spec.ts`, `e2e/template-import-security.spec.ts`,
  `e2e/project-portability.spec.ts`
- `docs/phase-p13-report.md`

Modified:
- `src/features/personal-templates/types.ts` (provenance)
- `src/features/personal-templates/components/PersonalTemplatesPanel.tsx`
- `src/features/templates/components/NewProjectDialog.tsx`

## 32. Validation gates

`npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build` → P13 E2E
(sequentially, chromium, workers=1) → `npm run test:e2e` →
`npm run test:e2e:matrix` → `npm run test:e2e:fallback` → `npm run test:export-build`.
Suites never run concurrently (Windows/Next worker-exhaustion history).

## 33. Completion criteria

Architecture + implementation + tests green; P13 E2E green; full regressions
green; security review done; `docs/phase-p13-report.md` complete; P14 not started.

## 34. Genuine future-phase candidates

- SVG deep sanitization (viewBox injection, external entities) as a dedicated
  security pass.
- `.buildora-project` formalization if cloud/team flows ever need it.
- Package signing / integrity hashes for trusted-source distribution.
- Template marketplace (explicitly deferred).
