"use client";

import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import {
  Monitor,
  Tablet,
  Smartphone,
  Circle,
  Sparkles,
  Loader2,
  AlertCircle,
  CheckCircle2,
  CloudOff,
} from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";

// ---------------------------------------------------------------------------
// Segmented control style
// ---------------------------------------------------------------------------

const segment =
  "flex h-6 items-center gap-1.5 px-2.5 text-xs text-text-dim transition-all duration-200 hover:text-text-muted active:scale-95 first:rounded-l-md last:rounded-r-md";

const segmentActive =
  "bg-card text-text-primary hover:text-text-primary";

// ---------------------------------------------------------------------------
// Zoom options
// ---------------------------------------------------------------------------

const ZOOM_OPTIONS = [50, 75, 90, 100, 125] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StatusBar() {
  const viewport = useEditorStore((s) => s.viewport);
  const setViewport = useEditorStore((s) => s.setViewport);
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const project = useEditorStore((s) => s.project);
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);
  const saveStatus = useEditorStore((s) => s.saveStatus);
  const isDirty = useEditorStore((s) => s.isDirty);
  const isHydrated = useEditorStore((s) => s.isHydrated);
  const persistenceError = useEditorStore((s) => s.persistenceError);

  // Phase P9 — coherent status messaging: when the device is offline, "Saved"
  // becomes "Offline — saved on this device" so the user never thinks a save
  // reached the cloud. The status reflects the local save reality.
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const hasProject = project.pages.length > 0;
  const sectionCount = project.pages[0]?.sections.length ?? 0;

  // Determine save status display
  const saveIndicator = (() => {
    if (saveStatus === "hydrating") return { icon: Loader2, text: "Hydrating...", className: "text-blue-400" };
    if (saveStatus === "saving") return { icon: Loader2, text: "Saving...", className: "text-accent" };
    if (saveStatus === "error") return { icon: AlertCircle, text: persistenceError?.message ?? "Save failed", className: "text-red-400" };
    if (saveStatus === "unsaved" || isDirty) return { icon: Circle, text: "Unsaved changes", className: "text-yellow-400" };
    if (saveStatus === "saved")
      return isOnline
        ? { icon: CheckCircle2, text: "Saved", className: "text-green-400" }
        : { icon: CloudOff, text: "Offline — saved on this device", className: "text-green-400" };
    return { icon: Circle, text: "Ready", className: "text-text-dim" };
  })();

  const SaveIcon = saveIndicator.icon;

  return (
    <footer className="flex h-9 items-center justify-between border-t border-border bg-secondary px-4">
      {/* ---- Left: Device segmented control ---- */}
      <div className="flex items-center rounded-md border border-border/60 p-0.5">
        <button
          data-testid="viewport-desktop"
          className={cn(segment, viewport === "desktop" && segmentActive)}
          onClick={() => setViewport("desktop")}
          title="Desktop (1440px)"
          aria-label="Desktop view"
          type="button"
        >
          <Monitor className="h-3 w-3" />
          <span className="hidden sm:inline">Desktop</span>
        </button>
        <button
          data-testid="viewport-tablet"
          className={cn(segment, viewport === "tablet" && segmentActive)}
          onClick={() => setViewport("tablet")}
          title="Tablet (768px)"
          aria-label="Tablet view"
          type="button"
        >
          <Tablet className="h-3 w-3" />
          <span className="hidden sm:inline">Tablet</span>
        </button>
        <button
          data-testid="viewport-mobile"
          className={cn(segment, viewport === "mobile" && segmentActive)}
          onClick={() => setViewport("mobile")}
          title="Mobile (390px)"
          aria-label="Mobile view"
          type="button"
        >
          <Smartphone className="h-3 w-3" />
          <span className="hidden sm:inline">Mobile</span>
        </button>
      </div>

      {/* ---- Center: Status + save status ---- */}
      <div className="flex items-center gap-3 text-xs text-text-dim">
        {isHydrated && (
          <div className="flex items-center gap-1.5">
            <SaveIcon className={cn("h-3 w-3", saveIndicator.className, saveStatus === "saving" && "animate-spin")} />
            <span className={cn("text-xs", saveIndicator.className)}>{saveIndicator.text}</span>
          </div>
        )}
        {!isHydrated && saveStatus !== "hydrating" && (
          <div className="flex items-center gap-1.5">
            <Circle className="h-1.5 w-1.5 fill-text-dim text-text-dim" />
            <span>Ready</span>
          </div>
        )}

        {hasProject && sectionCount > 0 && (
          <>
            <span className="text-text-dim/30">·</span>
            <span>{sectionCount} sections</span>
          </>
        )}

        {selectedSectionId && (
          <>
            <span className="text-text-dim/30">·</span>
            <span className="text-accent/80">Section selected</span>
          </>
        )}
      </div>

      {/* ---- Right: Zoom + Source ---- */}
      <div className="flex items-center gap-3">
        {/* Generation source indicator */}
        {hasProject && (
          <div className="flex items-center gap-1.5 text-xs text-text-dim/50">
            <Sparkles className="h-3 w-3" />
            <span>Buildora</span>
          </div>
        )}

        <div className="h-3 w-px bg-border/60" />

        {/* Zoom selector */}
        <select
          data-testid="zoom-control"
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="h-6 rounded-md border border-border/60 bg-base px-2 text-xs text-text-dim transition-all duration-200 hover:bg-card focus:border-accent/40 focus:outline-none"
          aria-label="Zoom level"
        >
          {ZOOM_OPTIONS.map((z) => (
            <option key={z} value={z}>
              {z}%
            </option>
          ))}
        </select>
      </div>
    </footer>
  );
}
