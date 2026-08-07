"use client";

// ---------------------------------------------------------------------------
// PreviewShell — full-screen visitor preview (Phase P7)
//
// No editor overlays: no selection borders, no inline edit controls, no drag
// handles. Internal links navigate; external links open in a new tab;
// mailto/tel are allowed; javascript: etc. are blocked. Escape exits.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef } from "react";
import { X, Smartphone, Tablet, Monitor, Maximize2 } from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { computePageRoutes } from "@/features/routing/routes";
import {
  usePreviewStore,
  PREVIEW_DEVICE_LABELS,
  PREVIEW_DEVICE_WIDTHS,
  type PreviewDevice,
} from "../store/preview-store";
import { classifyPreviewLink } from "../engine/navigation";
import { VisitorPageView } from "./VisitorPageView";

const DEVICES: PreviewDevice[] = ["phone", "tablet", "desktop", "full"];

const DEVICE_ICONS: Record<PreviewDevice, typeof Smartphone> = {
  phone: Smartphone,
  tablet: Tablet,
  desktop: Monitor,
  full: Maximize2,
};

export function PreviewShell() {
  const project = useEditorStore((s) => s.project);
  const open = usePreviewStore((s) => s.open);
  const device = usePreviewStore((s) => s.device);
  const route = usePreviewStore((s) => s.route);
  const closePreview = usePreviewStore((s) => s.closePreview);
  const openPreview = usePreviewStore((s) => s.openPreview);
  const setDevice = usePreviewStore((s) => s.setDevice);
  const navigate = usePreviewStore((s) => s.navigate);

  const routes = useMemo(() => computePageRoutes(project.pages), [project.pages]);
  const routeUrls = useMemo(() => routes.map((r) => r.routeUrl), [routes]);
  const activePage = useMemo(
    () => routes.find((r) => r.routeUrl === route)?.page ?? routes[0]?.page,
    [routes, route],
  );

  // Escape exits the preview.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePreview();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, closePreview]);

  // Guided journey step "preview the whole site" opens the preview.
  useEffect(() => {
    const onOpen = () => openPreview("/");
    window.addEventListener("buildora:preview-site", onOpen);
    return () => window.removeEventListener("buildora:preview-site", onOpen);
  }, [openPreview]);

  // Launch Center / guided builder can request a specific device preset.
  useEffect(() => {
    const onDevice = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === "phone" || detail === "tablet" || detail === "desktop" || detail === "full") {
        setDevice(detail);
      }
    };
    window.addEventListener("buildora:preview-device", onDevice);
    return () => window.removeEventListener("buildora:preview-device", onDevice);
  }, [setDevice]);

  // Intercept link clicks inside the preview content.
  const contentRef = useRef<HTMLDivElement>(null);
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const target = (e.target as HTMLElement).closest?.("a[href]");
      if (!target) return;
      const href = target.getAttribute("href") ?? "";
      const action = classifyPreviewLink(href, routeUrls);

      switch (action.kind) {
        case "internal":
          e.preventDefault();
          navigate(action.route);
          break;
        case "blocked":
          e.preventDefault();
          break;
        case "external": {
          e.preventDefault();
          const opener = window.open(action.href, "_blank", "noopener,noreferrer");
          if (opener) opener.opener = null;
          break;
        }
        case "special":
          // mailto/tel — let the browser handle it.
          break;
        case "anchor":
          break;
        case "noop":
          break;
      }
    },
    [routeUrls, navigate],
  );

  if (!open || !activePage) return null;

  return (
    <div
      data-testid="preview-shell"
      className="fixed inset-0 z-50 flex flex-col bg-secondary"
      role="dialog"
      aria-modal="true"
      aria-label="Website preview"
    >
      {/* ---- Toolbar ---- */}
      <div className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-border bg-base px-3">
        <button
          onClick={closePreview}
          data-testid="preview-exit"
          className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-text-dim transition-colors hover:bg-card hover:text-text-primary"
          type="button"
        >
          <X className="h-4 w-4" />
          Exit preview
        </button>

        <div className="mx-1 h-4 w-px bg-border" />

        {/* Page switcher */}
        <select
          value={route}
          onChange={(e) => navigate(e.target.value)}
          aria-label="Switch page"
          data-testid="preview-page-switcher"
          className="h-8 rounded-lg border border-border bg-base px-2 text-xs text-text-primary focus:border-accent/40 focus:outline-none"
        >
          {routes.map((r) => (
            <option key={r.routeUrl} value={r.routeUrl}>
              {r.page.title}
            </option>
          ))}
        </select>

        <div className="mx-1 h-4 w-px bg-border" />

        {/* Device presets */}
        <div className="flex items-center gap-1" role="group" aria-label="Preview size">
          {DEVICES.map((d) => {
            const Icon = DEVICE_ICONS[d];
            return (
              <button
                key={d}
                onClick={() => setDevice(d)}
                aria-pressed={device === d}
                title={PREVIEW_DEVICE_LABELS[d]}
                className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors ${
                  device === d
                    ? "bg-accent/15 text-accent"
                    : "text-text-dim hover:bg-card hover:text-text-primary"
                }`}
                type="button"
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{PREVIEW_DEVICE_LABELS[d]}</span>
              </button>
            );
          })}
        </div>

        <div className="flex-1" />

        {/* Route display */}
        <span
          className="max-w-[40%] truncate rounded-md bg-card px-2 py-1 text-[11px] text-text-dim"
          data-testid="preview-route"
        >
          {route}
        </span>
      </div>

      {/* ---- Preview frame ---- */}
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-secondary p-4 sm:p-6">
        <div
          className="min-h-full overflow-hidden rounded-xl border border-border/60 bg-white shadow-card transition-all duration-300"
          style={{
            width: PREVIEW_DEVICE_WIDTHS[device],
            maxWidth: "100%",
          }}
        >
          <div
            ref={contentRef}
            onClick={handleClick}
            className="min-h-full overflow-y-auto"
            style={{ maxHeight: "calc(100vh - 6rem)" }}
          >
            <VisitorPageView project={project} page={activePage} />
          </div>
        </div>
      </div>
    </div>
  );
}
