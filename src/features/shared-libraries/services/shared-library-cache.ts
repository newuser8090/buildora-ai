// ---------------------------------------------------------------------------
// Private Shared Libraries (Phase P6) — per-user preview cache
//
// Shared-library previews are cached per signed-in user so previously loaded
// libraries stay visible while offline (labelled as cached). The cache is
// scoped by userId and cleared on sign-out / account switch — another user's
// cache is never exposed. Access is always re-verified on the next online
// fetch; the cache is a convenience, never an authorization boundary.
// ---------------------------------------------------------------------------

import type { CloudLibraryInvitation, CloudSharedLibrary, CloudSharedLibraryBlock } from "@/features/cloud-sync/types";

export interface CachedLibraryDetails {
  library: CloudSharedLibrary;
  blocks: CloudSharedLibraryBlock[];
}

interface UserCache {
  listing: { owned: CloudSharedLibrary[]; shared: CloudSharedLibrary[] } | null;
  details: Map<string, CachedLibraryDetails>;
  invitations: CloudLibraryInvitation[] | null;
}

const caches = new Map<string, UserCache>();

function cacheFor(userId: string): UserCache {
  let cache = caches.get(userId);
  if (!cache) {
    cache = { listing: null, details: new Map(), invitations: null };
    caches.set(userId, cache);
  }
  return cache;
}

export function getCachedListing(userId: string): UserCache["listing"] {
  return cacheFor(userId).listing;
}

export function setCachedListing(
  userId: string,
  listing: UserCache["listing"],
): void {
  cacheFor(userId).listing = listing;
}

export function getCachedDetails(
  userId: string,
  libraryId: string,
): CachedLibraryDetails | null {
  return cacheFor(userId).details.get(libraryId) ?? null;
}

export function setCachedDetails(
  userId: string,
  libraryId: string,
  details: CachedLibraryDetails,
): void {
  cacheFor(userId).details.set(libraryId, details);
}

export function getCachedInvitations(userId: string): CloudLibraryInvitation[] | null {
  return cacheFor(userId).invitations;
}

export function setCachedInvitations(
  userId: string,
  invitations: CloudLibraryInvitation[],
): void {
  cacheFor(userId).invitations = invitations;
}

/** Clear one user's cache (sign-out / account switch / explicit removal). */
export function clearCachedSharedDataForUser(userId: string): void {
  caches.delete(userId);
}

/** Clear everything (tests). */
export function clearSharedLibraryCacheForTests(): void {
  caches.clear();
}
