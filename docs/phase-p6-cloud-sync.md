# Phase P6 — Cloud Sync, Accounts & Private Shared Libraries

## Architecture decision record

**Date:** 2026-08-07 · **Status:** Accepted

### 1. Backend provider: Supabase

The repository had **no existing backend or auth code**. Per the phase brief,
Supabase is the single chosen provider because it supplies authentication,
Postgres, Row Level Security, ownership rules, invitations, and optional
Realtime in one product. No other provider is introduced.

Three provider kinds exist behind one interface (see §5):

| kind       | when selected                                                                  |
| ---------- | ------------------------------------------------------------------------------ |
| `none`     | no env config and not in dev → pure local-only (IndexedDB)                     |
| `mock`     | `NEXT_PUBLIC_CLOUD_PROVIDER=mock`, or `NODE_ENV=development` by default        |
| `supabase` | `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` set               |

The mock backend is an in-process HTTP server mounted at `/api/cloud/[...path]`
so the full sync/sharing flows are exercisable end-to-end in dev and Playwright
without a real Supabase project. The core sync engine is provider-independent
and is unit-tested against an in-memory provider.

**Secrets:** only the anon key ever reaches the browser. The service-role key,
database password, and JWT secret are never read by app code.

### 2. Local-first principle

IndexedDB (the existing `buildora` database) remains the immediate source for
the editor UI. The cloud layer is an **asynchronous mirror**:

- local reads and writes never touch the network;
- successful local mutations enqueue sync work into a durable queue;
- the sync engine consumes the queue and applies remote deltas through a
  dedicated remote-apply path;
- remote applies carry `origin: "remote-sync"` so they never re-enqueue an
  echo upload;
- a cloud outage never blocks editing — failed sync leaves the local library
  untouched and retries with bounded backoff.

### 3. Auth

`src/features/auth` implements email/password sign-up, sign-in, sign-out,
password reset, session restoration, and verified-user state through
supabase-js (mock service in dev). Sessions are handled by the provider’s
secure storage — **no tokens in `localStorage` by hand**. The auth store is
transient UI state; signing out never deletes local data.

### 4. Cloud data model (schemaVersion 1)

Cloud payloads preserve the **validated native model** — validated BlockTree,
metadata, `contentRevision` — and strip local-only fields (favorite, useCount,
lastUsedAt) and thumbnail data (regenerable, never uploaded). The serializer
rejects dangerous keys, unsupported versions, and over-sized payloads, and
normalizes timestamps. Deletion uses soft-delete (`deletedAt` tombstones).

### 5. Provider abstraction

```ts
interface CloudLibraryProvider {
  getSessionUser()
  pushBlockBatch() / pushCollectionBatch() / pushTombstones()
  fetchChanges(after, limit)      // delta sync with cursor + pagination
  createSharedLibrary() / updateSharedLibrary() / deleteSharedLibrary()
  listSharedLibraries() / getSharedLibrary()
  addBlocksToLibrary() / removeBlockFromLibrary() / fetchSharedBlock()
  listLibraryMembers() / inviteMember() / listInvitations()
  acceptInvitation() / revokeInvitation()
  revokeMember() / leaveSharedLibrary()
}
```

Implementations: `SupabaseCloudLibraryProvider`, `MockHttpCloudLibraryProvider`
(dev/e2e), `InMemoryCloudLibraryProvider` (unit tests). Conflict/sync logic is
provider-independent.

### 6. Sync engine

One sync run at a time with stale-run protection and cancellation on sign-out.
Uploads queue entries in bounded batches; downloads paginate deltas since the
cursor stored in IndexedDB markers. Each record keeps a last-synced hash +
`contentRevision` baseline so conflicts are detected against a **baseline**, not
wall-clock timestamps. Local changes are debounced (never per keystroke) plus an
explicit “Sync now”.

### 7. Conflict policy

Automatic resolution only for safe cases (unchanged side vs changed side;
deterministic metadata/favorite/useCount merges; collection membership union).
BlockTree-vs-BlockTree and delete-vs-edit conflicts are surfaced as durable
conflict records and require explicit user review — **never silently
overwritten**.

### 8. Initial sign-in merge

First sign-in on a device never blindly overwrites either side. The user
chooses Merge both (recommended) / Upload this device / Download cloud library /
Review differences. Duplicate detection uses cloud IDs, content hashes, and
normalized tree hashes — never name alone.

### 9. Sign-out policy

Sign-out cancels sync, clears remote session state, and retains local My
Blocks. Queue entries and cached shared data are isolated per user and cleared
for the previous user. An explicit “Remove this account’s cloud copies from
this device” action is confirmed before executing.

### 10. Thumbnails — NOT synced (decision)

BlockTree is authoritative; thumbnails are regenerable local cache. Remote
downloads regenerate thumbnails locally. No private bucket is required in P6.

### 11. Realtime — NOT used (decision)

Manual sync, sign-in sync, debounced change sync, window-focus/online sync, and
low-frequency periodic sync suffice. Realtime is a Phase P7 candidate.

### 12. Database migrations & RLS

`supabase/migrations/20260807000001_cloud_sync_schema.sql` creates profiles,
cloud_my_blocks, cloud_my_block_collections, cloud_sync_tombstones,
shared_libraries, shared_library_members, shared_library_blocks, and
library_invitations with RLS on every table. `owner_id` is assigned by a
BEFORE INSERT trigger from `auth.uid()` — clients cannot forge ownership.
Members gain read access only through membership policy. Invitation recipients
can read/accept only their own pending invitations (email match, lazy expiry).
`20260807000002_shared_library_rpcs.sql` adds SECURITY DEFINER RPCs for
library/invitation/membership operations with execute granted only to
`authenticated`.
