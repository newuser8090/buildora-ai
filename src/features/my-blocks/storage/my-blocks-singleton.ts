// ---------------------------------------------------------------------------
// My Blocks Library (Phase P4) — browser singleton adapter
//
// One shared adapter instance for the whole app. Tests inject their own
// adapters instead of touching this singleton.
// ---------------------------------------------------------------------------

import { MyBlocksIndexedDbAdapter } from "./my-blocks-storage-adapter";
import type { MyBlocksStorageAdapter } from "../types";

let singleton: MyBlocksStorageAdapter | null = null;

export function getMyBlocksAdapter(): MyBlocksStorageAdapter {
  if (!singleton) {
    singleton = new MyBlocksIndexedDbAdapter();
  }
  return singleton;
}

/** Test hook: replace the singleton (e.g. with an in-memory adapter). */
export function setMyBlocksAdapterForTests(adapter: MyBlocksStorageAdapter | null): void {
  singleton = adapter;
}
