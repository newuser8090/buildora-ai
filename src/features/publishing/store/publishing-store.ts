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
  /** Phase P8 — deployment currently shown in the details dialog. */
  detailsDeploymentId: string | null;
  /** Phase P8 — custom domain setup dialog open. */
  domainDialogOpen: boolean;
  /** Phase P8 — provider of the last attempted publish (retry/details). */
  attemptedProviderId: string | null;
  /** Phase P8 — transient "Link copied." announcement. */
  copyNotice: string | null;

  openPublishDialog: () => void;
  setAttemptedProvider: (providerId: string) => void;
  notifyCopy: (notice: string) => void;
  clearCopyNotice: () => void;
  openHistory: () => void;
  closeDialog: () => void;
  setProgress: (progress: PublishProgressEvent) => void;
  setResult: (result: PublishServiceResult) => void;
  setDeployments: (deployments: DeploymentRecord[]) => void;
  startProgress: () => void;
  openDetails: (deploymentId: string) => void;
  closeDetails: () => void;
  openDomainDialog: () => void;
  closeDomainDialog: () => void;
}

export const usePublishingStore = create<PublishingState>()((set) => ({
  view: "closed",
  progress: null,
  lastResult: null,
  deployments: [],
  dialogOpen: false,
  detailsDeploymentId: null,
  domainDialogOpen: false,
  attemptedProviderId: null,
  copyNotice: null,

  openPublishDialog: () =>
    set({ dialogOpen: true, view: "publish", progress: null, lastResult: null }),
  setAttemptedProvider: (providerId) => set({ attemptedProviderId: providerId }),
  notifyCopy: (notice) => {
    set({ copyNotice: notice });
    // Transient announcement — cleared shortly after.
    setTimeout(() => {
      usePublishingStore.getState().clearCopyNotice();
    }, 2200);
  },
  clearCopyNotice: () => set({ copyNotice: null }),
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
  openDetails: (deploymentId) => set({ detailsDeploymentId: deploymentId }),
  closeDetails: () => set({ detailsDeploymentId: null }),
  openDomainDialog: () => set({ domainDialogOpen: true }),
  closeDomainDialog: () => set({ domainDialogOpen: false }),
}));
