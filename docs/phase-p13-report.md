# Phase P13 — Report: Template Packages & Project Portability

Branch: `phase-p13-template-packages-portability`
Design document: `docs/phase-p13-architecture.md` (written before implementation).

Phase P13 ships **portable Buildora template packages**: a user can save a
project as a personal template, export it as a deterministic, versioned
`.buildora-template` ZIP package, move/send it to another Buildora
installation, import it there through a safe preview-then-install flow, and
create brand-new, fully independent projects from it — with referenced assets
intact. The format is treated as untrusted input end to end (ZIP path
allow-list, bomb/size bounds, prototype-pollution rejection, MIME magic-byte
sniffing, unsafe-URL scanning, fresh identities, no partial installs), and
privacy boundaries are hard-tested (no Copilot memory, share tokens, review
comments, recovery snapshots, deployment records, cloud-sync state, or auth
data ever leaves the device in a package).

Project portability was audited rather than replaced: the existing
`.buildora.json` format (v1 envelope + `SerializedBuildoraProject` migration
pipeline) is already correct, and P13 proves the round trip, fresh identity,
and privacy behavior in E2E.

---

## 1. Delivered

- **Package format** — `.buildora-template` is a ZIP with three logical parts:
  `manifest.json` (format marker, format version, package type, exportedAt,
  asset manifest), `template.json` (template metadata + project snapshot with
  assets externalized to package paths), and `assets/asset-0001.<ext>` files
  (`constants.ts`).
- **Format identity + versioning** — `BUILDORA_TEMPLATE_FORMAT_MARKER =
  "buildora-template"`, `BUILDORA_TEMPLATE_FORMAT_VERSION = 1`, decoupled from
  IndexedDB `DATABASE_VERSION` and from the `.buildora.json`
  `EXPORT_FORMAT_VERSION`. Newer formats are rejected before the payload is
  parsed (`FORMAT_TOO_NEW`, beginner copy: "created with a newer version of
  Buildora").
- **Strict runtime validation** — `schema.ts` (strict Zod): manifest, payload,
  asset entries (path pattern, MIME↔extension agreement, size bounds), template
  metadata (name/length, description, category enum, tags), project
  re-validated with the canonical `ProjectSchema` after asset restoration.
- **Exporter** — `template-package-exporter.ts` + `asset-collector.ts`: only
  referenced assets, deduped by data-URL content, deterministic order (sorted
  ids, fixed JSON key order, fixed ZIP dates, injected clock), sanitized
  download filename, object-URL revoked in `finally`. JSZip is lazy-loaded so
  ZIP machinery never enters the main editor bundle.
- **Importer** — `template-package-importer.ts`: full pipeline
  (file → archive inspection → entry path/count/size → manifest → version/type
  → payload → dangerous keys/depth/URLs → asset cross-checks → per-asset
  extraction with magic bytes + size → restore data URLs → re-validate →
  preview + ready-to-install record). Persistence is a single
  `installRecord` write only after user confirmation — no partial installs.
- **Safe import UI** — `ImportTemplateDialog.tsx`: picker + drag-drop,
  parse/preview (metadata only, never renders imported HTML), Install/Cancel,
  in-flight guards against same-tick double submission, Escape-safe focus
  trap, live-region status, safe error states. Mounted from BOTH the Personal
  Templates panel and the New Project dialog (single implementation).
- **Export UI** — Personal Templates panel "Export" action per template
  (`handleExport` → `exportTemplatePackage` + download).
- **Name conflicts** — `generateUniqueTemplateName`: "Portfolio", "Portfolio
  (2)", "Portfolio (3)", capped at the canonical 80-char limit; imported
  records get fresh `personal-<uuid>` ids; provenance (`source: "import"`,
  format version, exportedAt, originalName) stored as non-authoritative
  metadata only.
- **ID regeneration** — creating a project from an imported template goes
  through the canonical personal-template creation path (fresh project, page,
  section ids); tests prove two projects from one imported template are fully
  independent and editing one never mutates the template or the other project.
- **Project portability** — audited and proven: `.buildora.json` round trip
  (export → delete → import) with fresh identity and no private-state leakage.
- **No IndexedDB migration** — `provenance` is an optional field on the whole
  record in the existing `personalTemplates` store (v9); old records simply
  lack it. No `DATABASE_VERSION` bump.

## 2. Architecture decisions

- **ZIP-based package with a strict path allow-list.** Logical ZIP paths are
  untrusted strings; `validatePackageEntryPath` allows exactly
  `manifest.json`, `template.json`, and `assets/<safe-image>` (lowercase
  alnum filename + known image extension), rejecting `..`, absolute paths,
  drive letters, backslashes, control characters, and depth > 4.
- **Content is authoritative, never the filename.** The file picker's
  `accept` guides beginners, but import validation is entirely
  content-driven — a valid package whose name lost its `.buildora-template`
  extension still imports (a genuine finding from the first E2E run).
- **Two-phase, transactional-style import.** Nothing persists until the user
  confirms Install; a failed import can never leave a half-installed template.
- **Only referenced assets, deduped by content.** The typed asset collector
  union a defensive depth-bounded scan for `{ assetId }` refs, intersected
  with `project.assets`; identical content maps to one package file.
- **Assets are re-validated on extraction** — magic-byte sniff per MIME
  (PNG/JPEG/WebP magic, SVG text + script/event-handler rejection), size must
  match the manifest, and the restored project is re-validated with
  `ProjectSchema`.
- **No second project renderer or second validator.** Imported templates use
  the canonical `ProjectSchema` and personal-template service/storage.

## 3. Package format

```
manifest.json     — { format: "buildora-template", formatVersion: 1,
                      packageType: "template", exportedAt, assetCount,
                      totalAssetBytes, assets: [{path, assetId, name,
                      mimeType, extension, size}] }
template.json     — { template: {name, description, category, tags,
                      createdAt, updatedAt}, project: <Project with asset
                      sources pointing at assets/<file>> }
assets/…          — referenced binary asset files (asset-0001.png, …)
```

Deterministic core: assets sorted by id, deduped by content, stable path
assignment, fixed JSON key order, canonical base64, fixed ZIP dates. `exportedAt`
intentionally differs per export (it is package metadata).

## 4. Manifest schema (summary)

`format` literal, `formatVersion` ≥ 1 int, `packageType` ∈ {template, project},
`exportedAt` valid ISO, `assetCount` matches array length, `totalAssetBytes`
matches sum, per-asset: path regex, id, bounded name, MIME with canonical
extension, extension↔MIME agreement, bounded size. All `.strict()` — unknown
keys rejected at format v1.

## 5. Versioning

- `BUILDORA_TEMPLATE_FORMAT_VERSION = 1`, decoupled from IndexedDB
  `DATABASE_VERSION` and `.buildora.json` version.
- Importer distinguishes: current (v1) / older (accepted, schema-driven) /
  newer (rejected `FORMAT_TOO_NEW` before payload parse) / malformed
  (`MANIFEST_INVALID`/`ARCHIVE_INVALID`) / wrong type
  (`WRONG_PACKAGE_TYPE`). Unknown newer formats are never silently interpreted.

## 6. Template export

- Personal Templates panel → per-template **Export** menu action.
- Exports structure, pages, sections, styling, site settings needed by the
  template, page metadata, and referenced local assets.
- Excludes everything private (see §12). Filename sanitized:
  `my-portfolio.buildora-template`; empty-name fallback
  `buildora-template.buildora-template`.

## 7. Template import

- Entry points: Personal Templates → **Import template**; New Project dialog →
  **Import template** (same shared dialog).
- Flow: choose file (picker + drag-drop) → parse → **preview** (name,
  description, category, tags, page/section/asset counts, package size, format,
  warnings) → **Install template** / Cancel → success (with optional "Create a
  project from it") or safe error. Nothing renders imported HTML; the preview
  is metadata only.
- Conflict: automatic "Name", "Name (2)", "Name (3)"; imported templates never
  overwrite existing ones.

## 8. Asset portability

- Referenced assets only; dedupe by content; deterministic mapping; bounded
  count (2000), bounded per-asset size (5 MB), bounded total uncompressed
  (50 MB).
- MIME validation (extension agreement + magic bytes); safe generated package
  filenames; no path traversal; no external local paths.
- Import installs assets back through the canonical data-URL asset system and
  rewrites references correctly; byte-identical restoration is tested.

## 9. Project portability

- Existing `.buildora.json` format stays canonical; P13 audits it and proves:
  export → delete → import → fresh identity, no private state, name-conflict
  safety via the existing import dialog, migration via the canonical pipeline.

## 10. Identity regeneration

- Imported templates: fresh `personal-<uuid>` record ids; provenance only as
  non-authoritative metadata.
- Projects from imported templates: fresh project/page/section ids through the
  canonical creation path; independence tested (editing one project never
  mutates the template or a sibling project).

## 11. Conflict handling

- Import: never overwrites; "Name (2)/(3)" strategy with a warning shown in
  the preview.
- Project import: existing safe behavior preserved (fresh identity + custom
  name input).

## 12. Security architecture

- **ZIP/path**: allow-list validation; rejects traversal, absolute/Windows
  paths, backslashes, control chars, depth > 4, unexpected top-level entries,
  orphan entries.
- **Bomb/size bounds**: entry count ≤ 2000; compressed file ≤ 25 MB;
  uncompressed ≤ 50 MB enforced at central-directory pre-scan AND during
  extraction with early abort; manifest/template JSON ≤ 10 MB each.
- **Prototype pollution**: `__proto__`/`prototype`/`constructor` keys rejected
  recursively pre-schema; structural depth capped (20).
- **Unsafe URLs**: recursive scan rejects `javascript:`, `vbscript:`,
  `data:text/html`.
- **MIME spoofing**: magic-byte sniff + extension↔MIME agreement + exact size
  match; SVG script/event-handler payloads rejected; an HTML payload disguised
  as a PNG is rejected (unit + E2E).
- **Imported code**: no eval / new Function / dangerouslySetInnerHTML; preview
  renders metadata only; blocks render only through the validated
  `BlockRenderer` (no original source execution).
- **Rollback**: single-write install; failed imports never mutate persisted
  templates (tested).
- **Privacy exclusions (hard-tested)**: exported packages contain no Copilot
  memory/style notes/conversations, review comments, share tokens, deployment
  records, cloud-sync queues, recovery snapshots, personal-template DB
  metadata unrelated to the selected template, or user/session/auth info.
- **Error leakage**: `mapTemplatePackageErrorToMessage` maps every error to
  beginner-safe copy; no stack traces, Zod dumps, IndexedDB internals, or
  filesystem paths.
- **Object URLs**: created only for the export download and revoked in
  `finally`.

## 13. Accessible / performance choices

- **A11y**: labelled file input, focus trap + restoration, Escape closes only
  when idle/preview/error/success, live-region status, `aria-busy` during
  parse/install, error alerts associated with the flow, drag-drop has a
  keyboard-accessible picker alternative.
- **Performance**: JSZip lazy-loaded (dynamic `import`) so package machinery
  never enters the main editor bundle; strict package limits bound work;
  `markPerf` marks for import start/end; no fake metrics.

## 14. Mock / real provider strategy

Not applicable to P13 in the P6–P12 sense: packages are **local files**. The
only backend surface involved is the existing personal-template IndexedDB
store (unchanged schema). Real Supabase / mock-cloud parity is inherited and
untouched.

## 15. Backend / persistence

- Imported templates persist through `getPersonalTemplateService().installRecord`
  (canonical service + storage, quota enforced).
- No Supabase migration; no IndexedDB schema change (provenance is an optional
  whole-record field).

## 16. Files created

- `docs/phase-p13-architecture.md`
- `src/features/template-packages/` — `constants.ts`, `types.ts`, `schema.ts`,
  `utils/zip-path.ts`, `utils/data-url-io.ts`,
  `services/template-package-exporter.ts`, `services/template-package-importer.ts`,
  `services/asset-collector.ts`, `components/ImportTemplateDialog.tsx`
- `src/features/template-packages/__tests__/` — `template-package-exporter.test.ts`,
  `template-package-importer.test.ts`, `ImportTemplateDialog.test.tsx`
- `e2e/template-portability.spec.ts`, `e2e/template-import-security.spec.ts`,
  `e2e/project-portability.spec.ts`

## 17. Files modified

- `src/features/personal-templates/types.ts` (optional `provenance`)
- `src/features/personal-templates/services/personal-template-service.ts`
  (`installRecord` for imported records, creation-path reuse)
- `src/features/personal-templates/components/PersonalTemplatesPanel.tsx`
  (Export action + shared ImportTemplateDialog wiring)
- `src/features/templates/components/NewProjectDialog.tsx` (Import template
  entry point, same shared dialog)
- `e2e/my-blocks.spec.ts` (deterministic library-card assertion — see §19)

## 18. Dependencies

None added. Reuses existing `jszip` (already in the repo, lazy-loaded) and the
existing Zod / sanitize-export-filename / file-validator infrastructure.

## 19. Genuine findings and fixes

1. **Import rejected valid packages whose filename lost its extension.**
   Playwright's temp-download filenames (and real-world download-manager /
   email renames) drop the `.buildora-template` extension; the original hard
   extension gate wrongly rejected them. Fixed: the read boundary enforces
   only size/readability; archive + manifest + payload content is
   authoritative ("never trust MIME/extension alone"). Regression coverage
   added (read-boundary + renamed-file import tests; E2E downloads the real
   package file).
2. **Whitespace-only template names produced an empty preview that failed
   confusingly at install.** A payload `name: "   "` passes the schema's
   min-length check but is rejected by the canonical `validateProjectName` at
   install. Fixed: the importer rejects whitespace-only names up front with
   `TEMPLATE_INVALID` ("The template does not have a name."). Regression test
   added.
3. **`my-blocks.spec.ts` latent thumbnail-text race (pre-existing, not P13).**
   The block's h1 text exists in the DOM only while `MyBlockThumb` is in its
   idle structural-preview state; once the thumbnail `<img>` loads, the text
   disappears, so `toContainText("My Blocks hero")` on the library raced with
   thumbnail loading (failed ~50% even in isolation; P13 touched none of this
   code). Fixed deterministically: assert the saved card + its actual saved
   name (captured from the input). The h1 content is still verified on the
   live canvas later in the same spec, so coverage is unchanged. Verified 3
   consecutive isolated passes after the fix.

## 20. Tests

- **Unit/component** — 52 tests in `template-packages` (exporter: valid round
  trip, referenced-only assets, dedupe, determinism, privacy exclusions,
  filename sanitization, caps; importer: file/archive/manifest/payload/asset
  rejection incl. traversal, absolute/drive paths, too-many-entries, orphan
  entries, malformed JSON, wrong marker, newer format, wrong type,
  prototype-pollution keys, `javascript:`/`vbscript:`/`data:text/html`,
  whitespace-only name, missing/dangling assets, size mismatch, HTML-as-PNG,
  script-in-SVG, MIME spoof; persistence: no-partial-install, single-write
  install, project independence; dialog: preview, cancel-doesn't-install,
  install, error states, double-submit guard, Escape behavior).
- **P13 E2E** — `template-portability.spec.ts` (export → delete → import →
  preview → install → create project → content/assets verified → independent
  editing), `template-import-security.spec.ts` (hostile packages rejected
  without persistence mutation; HTML-as-PNG rejected; fixture sanity),
  `project-portability.spec.ts` (`.buildora.json` round trip: privacy +
  fresh identity).

## 21. Validation results (exact)

Run sequentially, never concurrently:

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean |
| `npm run lint` | ✅ clean |
| `npm test` | ✅ **3708 passed** (267 files) — up from P12's 3654 + new coverage |
| `npm run build` | ✅ success (incl. `/share/[token]`, `/api/share/[[...path]]`) |
| P13 E2E (3 specs, chromium, workers=1) | ✅ **5/5 passed** |
| `npm run test:e2e` (full, chromium, workers=1) | ✅ **104 passed / 1 failed → flake fixed** (see §19.3; failing spec passes 3× in isolation after fix) |
| `npm run test:e2e:matrix` | ✅ **13/13 passed** (2 clean runs; first attempt aborted early while the dev server was still warming — see §22) |
| `npm run test:e2e:fallback` | ✅ **1/1 passed** |
| `npm run test:export-build` | ✅ **1/1 passed** |

## 22. Incidents (documented truthfully)

- **First background `test:e2e` run failed 104/105 with `page.goto`/`page.reload`
  "load"-event timeouts while the app snapshots showed the UI fully rendered.**
  Root cause: the Next.js webpack dev server had been alive for hours
  (2.3 h run) and degraded into sustained load-event stalls — a known
  Windows/Next.js dev-server behavior, not a P13 regression. The wedged
  server (PID on :3000) was killed, a fresh `next dev --webpack` server was
  started, and representative failing suites (ai-copilot, inline-ai-editing,
  guided-builder, editor) were reproduced: **36/37 passed**; the one failure
  (real Gemini `/api/generate` call) passed in isolation (29 s — the 30 s
  timeout was exhausted under the stalled server). The full suite was then
  rerun cleanly on the fresh server: 104 passed with a single pre-existing
  test-design flake (my-blocks thumbnail race) — fixed (see §19.3). No
  production code changed for this incident.
- **First `test:e2e:matrix` run aborted at prompt 1 with "10 did not run".**
  Ran immediately after the 105-test suite while the server was warming;
  two subsequent clean runs both passed 13/13. Classified as a transient
  early-abort, not a product failure.
- **`editor.spec.ts` "Real pipeline" test** — makes a genuine provider call;
  passes in isolation (29.2 s) and needs a live key, so it is sensitive to
  server load. Not a P13 regression.

## 23. Known limitations

- Packages are moved by hand; there is no cloud template sync or marketplace
  (explicitly out of scope).
- Format v1 is strict (unknown manifest/payload keys rejected); a future
  format bump will relax the schema per the architecture's versioning rules.
- SVG is rendered only via `<img>` (matching the existing upload pipeline);
  the magic-byte/script sniff is a claim check, not a full SVG audit.
- Thumbnails of imported templates are generated by the existing personal
  template pipeline; no separate package-specific preview image is shipped.
- No WCAG certification claim.

## 24. Genuine P14 candidates (only)

- Post-install "Edit details" for imported templates (rename/description/
  category) surfaced without re-import.
- Package signing / integrity metadata (the manifest reserves the concept).
- Template version upgrades for installed imported templates (re-import with
  provenance-aware diff).
- Cloud template sync or a public gallery (explicitly deferred and out of
  scope for P13).
