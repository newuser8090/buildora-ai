// ---------------------------------------------------------------------------
// Preview — UI store (Phase P7)
//
// Ephemeral UI state: whether the visitor preview is open, the active
// device preset, and the currently visited route. Nothing here is persisted
// and nothing here mutates the project.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import { markPerf } from "@/features/perf/perf-instrumentation";

export type PreviewDevice = "phone" | "tablet" | "desktop" | "full";

export const PREVIEW_DEVICE_LABELS: Record<PreviewDevice, string> = {
  phone: "Phone",
  tablet: "Tablet",
  desktop: "Desktop",
  full: "Full window",
};

/** Widths applied to the preview frame per device preset. */
export const PREVIEW_DEVICE_WIDTHS: Record<PreviewDevice, string> = {
  phone: "390px",
  tablet: "768px",
  desktop: "1280px",
  full: "100%",
};

interface PreviewState {
  open: boolean;
  device: PreviewDevice;
  /** Current route (e.g. "/" or "/about"). */
  route: string;
  openPreview: (route?: string) => void;
  closePreview: () => void;
  setDevice: (device: PreviewDevice) => void;
  navigate: (route: string) => void;
}

export const usePreviewStore = create<PreviewState>()((set) => ({
  open: false,
  device: "desktop",
  route: "/",
  openPreview: (route) => {
    try {
      markPerf("preview-open");
    } catch {
      // Instrumentation is best-effort.
    }
    set({ open: true, route: route ?? "/" });
  },
  closePreview: () => set({ open: false, route: "/", device: "desktop" }),
  setDevice: (device) => set({ device }),
  navigate: (route) => set({ route }),
}));
