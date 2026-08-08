// ---------------------------------------------------------------------------
// Publishing — client in-flight registry (Phase P8)
//
// First line of defense against accidental duplicate production publishes:
// only one active publish per project+provider. A second attempt returns
// DEPLOYMENT_BUSY so the UI "focuses" the already-running publish (the
// progress view is already open). Server-side idempotency is the second line.
// ---------------------------------------------------------------------------

const inFlight = new Map<string, number>();

function key(projectId: string, providerId: string): string {
  return `${providerId}:${projectId}`;
}

/** Claim the lock; false when a publish is already running for this target. */
export function claimPublishLock(projectId: string, providerId: string): boolean {
  const k = key(projectId, providerId);
  if (inFlight.has(k)) return false;
  inFlight.set(k, Date.now());
  return true;
}

export function releasePublishLock(projectId: string, providerId: string): void {
  inFlight.delete(key(projectId, providerId));
}

/** Test hook. */
export function _resetPublishLocksForTests(): void {
  inFlight.clear();
}
