"use client";

// ---------------------------------------------------------------------------
// Data integrations (Phase P22-J) — runtime store
//
// Holds ONLY provider-layer runtime data: connection status + runtime
// records per collection. It is NOT a project state store — durable project
// state (collections + bindings) continues to live in the editor store and
// flows through withHistory as before. The mock provider seeds deterministic
// demo records so bindings resolve in previews/exports without setup.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type { Collection, CollectionRecord, CollectionRecords } from "@/features/elements/collections/types";
import { getDataIntegrationProvider } from "../provider-factory";
import { MockDataProvider } from "../mock/mock-data-provider";
import type {
  DataIntegrationProvider,
  DataIntegrationScope,
  DataIntegrationStatus,
} from "../types";

export interface DataIntegrationState {
  /** Provider kind as resolved (never throws). */
  kind: "none" | "mock" | "supabase";
  /** Connection status (never throws). */
  status: DataIntegrationStatus;
  /** Runtime records keyed by collectionId. */
  records: CollectionRecords;
  /** Whether a refresh is in flight. */
  refreshing: boolean;
  /** Connect to the resolved provider (seeds mock demo records). */
  connect: () => Promise<void>;
  /** Re-sync records for the project's collections. */
  refreshRecords: (collections: Collection[], scope?: DataIntegrationScope) => Promise<void>;
  /** Test/dev hook: overwrite mock records for one collection. */
  setMockRecords: (collectionId: string, records: CollectionRecord[]) => void;
  /** Reset to the local-only state. */
  reset: () => void;
}

const LOCAL_ONLY: DataIntegrationStatus = {
  kind: "none",
  connected: false,
  label: "Not connected",
  detail: "No data provider is configured. Static values render as authored.",
};

function providerOrNull(): DataIntegrationProvider | null {
  try {
    return getDataIntegrationProvider();
  } catch {
    return null;
  }
}

export const useDataIntegrationStore = create<DataIntegrationState>((set, get) => ({
  kind: "none",
  status: LOCAL_ONLY,
  records: {},
  refreshing: false,

  connect: async () => {
    const provider = providerOrNull();
    if (!provider) {
      set({ kind: "none", status: LOCAL_ONLY, records: {} });
      return;
    }
    const status = await provider.getStatus();
    // Seed mock demo records for known collections (deterministic).
    if (provider instanceof MockDataProvider) {
      provider.seedDemoRecords();
    }
    set({ kind: provider.kind, status, records: get().records });
  },

  refreshRecords: async (collections, scope) => {
    const provider = providerOrNull();
    if (!provider || get().kind === "none") return;
    if (!Array.isArray(collections)) return;
    set({ refreshing: true });
    try {
      // Keep the provider's collection context fresh so mock demo records are
      // generated from the CURRENT field definitions.
      if (provider instanceof MockDataProvider) {
        provider.setCollections(collections);
      }
      const next: CollectionRecords = {};
      for (const collection of collections) {
        const records = await provider.listRecords(collection.id, scope);
        if (Array.isArray(records) && records.length > 0) {
          next[collection.id] = records;
        }
      }
      set((state) => ({ records: { ...state.records, ...next } }));
    } finally {
      set({ refreshing: false });
    }
  },

  setMockRecords: (collectionId, records) => {
    const provider = providerOrNull();
    if (provider instanceof MockDataProvider) {
      provider.putRecordsForTests(collectionId, records);
    }
    set((state) => ({
      records: { ...state.records, [collectionId]: JSON.parse(JSON.stringify(records)) },
    }));
  },

  reset: () => {
    set({ kind: "none", status: LOCAL_ONLY, records: {}, refreshing: false });
  },
}));
