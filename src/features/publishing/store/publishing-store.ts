// ---------------------------------------------------------------------------
// Publishing — UI store (Phase P7)
//
// Ephemeral UI state: which dialog is open, the in-flight publish progress,
// the last result, and the deployment list cache. Deployment records
// themselves live in IndexedDB — this store never persists anything.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type { DeploymentRecord, PublishProgressEvent, PublishServiceResult } from "../types";

export type PublishDialogView = "closed" | "publish" | "progress" | "success" | "failure" | "history";

interface PublishingState {
  view: PublishDialogView;
  progress: PublishProgressEvent | null;
  lastResult: PublishServiceResult | null;
  deployments: DeploymentRecord[];
  /** True while the dialog is open (used to keep it mounted). */
  dialogOpen: boolean;

  openPublishDialog: () => void;
  openHistory: () => void;
  closeDialog: () => void;
  setProgress: (progress: PublishProgressEvent) => void;
  setResult: (result: PublishServiceResult) => void;
  setDeployments: (deployments: DeploymentRecord[]) => void;
  startProgress: () => void;
}

export const usePublishingStore = create<PublishingState>()((set) => ({
  view: "closed",
  progress: null,
  lastResult: null,
  deployments: [],
  dialogOpen: false,

  openPublishDialog: () =>
    set({ dialogOpen: true, view: "publish", progress: null, lastResult: null }),
  openHistory: () =>
    set({ dialogOpen: true, view: "history", progress: null, lastResult: null }),
  closeDialog: () =>
    set({ dialogOpen: false, view: "closed", progress: null }),
  setProgress: (progress) => set({ progress, view: "progress" }),
  setResult: (result) =>
    set({
      lastResult: result,
      view: result.ok ? "success" : "failure",
      progress: null,
    }),
  setDeployments: (deployments) => set({ deployments }),
  startProgress: () => set({ view: "progress", progress: null, lastResult: null }),
}));
