// ---------------------------------------------------------------------------
// Share Links & Review Experience (Phase P12) — local cache
//
// Tiny best-effort localStorage cache that remembers which projects have
// active share links. Used ONLY to avoid redundant network calls (dashboard
// badges, snapshot-sync gating). It is NEVER an authorization source — the
// server decides everything. Offline/failure degrades silently.
// ---------------------------------------------------------------------------

import { SHARE_LOCAL_CACHE_KEY } from "../constants";

interface ShareLocalCache {
  version: 1;
  /** projectId -> active share ids known this session. */
  entries: Record<string, { shareIds: string[]; updatedAt: string }>;
  /**
   * shareId -> raw token, cached ONLY on the owner's device so the manage
   * list can re-copy a link. The server returns a raw token exactly once (at
   * create/regenerate); this device cache is the only other place it lives.
   * Never exported, never in project content, cleared on revoke/regenerate.
   */
  tokens: Record<string, string>;
}

const MAX_ENTRIES = 200;

function readCache(): ShareLocalCache {
  try {
    if (typeof localStorage === "undefined") return { version: 1, entries: {}, tokens: {} };
    const raw = localStorage.getItem(SHARE_LOCAL_CACHE_KEY);
    if (!raw) return { version: 1, entries: {}, tokens: {} };
    const parsed = JSON.parse(raw) as Partial<ShareLocalCache>;
    if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== "object") {
      return { version: 1, entries: {}, tokens: {} };
    }
    return {
      version: 1,
      entries: parsed.entries,
      tokens: parsed.tokens && typeof parsed.tokens === "object" ? parsed.tokens : {},
    };
  } catch {
    return { version: 1, entries: {}, tokens: {} };
  }
}

function writeCache(cache: ShareLocalCache): void {
  try {
    if (typeof localStorage === "undefined") return;
    const keys = Object.keys(cache.entries);
    if (keys.length > MAX_ENTRIES) {
      // Drop the oldest entries.
      const trimmed = Object.fromEntries(
        Object.entries(cache.entries)
          .sort((a, b) => a[1].updatedAt.localeCompare(b[1].updatedAt))
          .slice(0, MAX_ENTRIES),
      );
      cache.entries = trimmed;
    }
    localStorage.setItem(SHARE_LOCAL_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Non-fatal — the cache is an optimization only.
  }
}

/** Known active share ids for a project (may be stale; never authoritative). */
export function cachedShareIds(projectId: string): string[] {
  return readCache().entries[projectId]?.shareIds ?? [];
}

/** Remember the active share ids for a project. */
export function setCachedShareIds(projectId: string, shareIds: string[]): void {
  const cache = readCache();
  cache.entries[projectId] = {
    shareIds,
    updatedAt: new Date().toISOString(),
  };
  writeCache(cache);
}

/** Clear the cached entry (e.g. all links revoked / project deleted). */
export function clearCachedShareIds(projectId: string): void {
  const cache = readCache();
  if (cache.entries[projectId]) {
    delete cache.entries[projectId];
    writeCache(cache);
  }
}

/** Remember the raw token for a share on THIS device (owner convenience). */
export function cacheShareToken(shareId: string, rawToken: string): void {
  const cache = readCache();
  cache.tokens[shareId] = rawToken;
  writeCache(cache);
}

/** The cached raw token for a share, if this device has it. */
export function cachedShareToken(shareId: string): string | null {
  return readCache().tokens[shareId] ?? null;
}

/** Forget a share's token (revoked/regenerated links must drop the old one). */
export function removeCachedShareToken(shareId: string): void {
  const cache = readCache();
  if (cache.tokens[shareId]) {
    delete cache.tokens[shareId];
    writeCache(cache);
  }
}

/** Test hook. */
export function clearShareLocalCacheForTests(): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(SHARE_LOCAL_CACHE_KEY);
    }
  } catch {
    // ignore
  }
}
