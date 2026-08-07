// ---------------------------------------------------------------------------
// /preview/[projectId] — standalone read-only visitor preview (Phase P7)
//
// Loads the project directly from IndexedDB (never the editor store), renders
// it with no editor chrome, and allows safe navigation (internal routes,
// external links, mailto/tel). Used as the demo URL for mock publishing and
// as an in-new-tab preview.
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Smartphone, Tablet, Monitor, Maximize2, Loader2 } from "lucide-react";
import { IndexedDbProjectAdapter } from "@/features/persistence/adapters/indexed-db-adapter";
import { useRegisterDefaultSections } from "@/features/editor/registry/register-default-sections";
import { computePageRoutes } from "@/features/routing/routes";
import type { Project } from "@/types/project";
import { classifyPreviewLink } from "@/features/preview/engine/navigation";
import {
  PREVIEW_DEVICE_WIDTHS,
  type PreviewDevice,
} from "@/features/preview/store/preview-store";
import { VisitorPageView } from "@/features/preview/components/VisitorPageView";

const DEVICES: PreviewDevice[] = ["phone", "tablet", "desktop", "full"];
const DEVICE_ICONS: Record<PreviewDevice, typeof Smartphone> = {
  phone: Smartphone,
  tablet: Tablet,
  desktop: Monitor,
  full: Maximize2,
};

export default function PreviewPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const projectId = params?.projectId;

  // This route mounts outside the editor, so the section registry would be
  // empty without an explicit registration — the site would render blank.
  useRegisterDefaultSections();

  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [route, setRoute] = useState("/");

  const routes = useMemo(
    () => (project ? computePageRoutes(project.pages) : []),
    [project],
  );
  const routeUrls = useMemo(() => routes.map((r) => r.routeUrl), [routes]);
  const activePage = useMemo(
    () => routes.find((r) => r.routeUrl === route)?.page ?? routes[0]?.page,
    [routes, route],
  );

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const adapter = new IndexedDbProjectAdapter();
    adapter
      .loadProject(projectId)
      .then((result) => {
        if (cancelled) return;
        if (result.success) {
          setProject(result.project);
          setStatus("ready");
        } else {
          setStatus("missing");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("missing");
      });
    return () => {
      cancelled = true;
      adapter.close();
    };
  }, [projectId]);

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
          setRoute(action.route);
          contentRef.current?.scrollTo({ top: 0 });
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
        case "anchor":
        case "noop":
          break;
      }
    },
    [routeUrls],
  );

  if (status === "loading" || !project) {
    return (
      <div className="flex h-dvh items-center justify-center bg-base">
        <Loader2 className="h-7 w-7 animate-spin text-accent" />
      </div>
    );
  }

  if (status === "missing") {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-base">
        <h1 className="text-lg font-semibold text-text-primary">Preview unavailable</h1>
        <p className="text-sm text-text-muted">This project could not be found.</p>
        <button
          onClick={() => router.push("/")}
          className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white"
          type="button"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-secondary">
      {/* Toolbar */}
      <div className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-border bg-base px-3">
        <button
          onClick={() => router.push(`/editor/${projectId}`)}
          data-testid="preview-back-editor"
          className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-text-dim transition-colors hover:bg-card hover:text-text-primary"
          type="button"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to editor
        </button>
        <div className="mx-1 h-4 w-px bg-border" />
        <select
          value={route}
          onChange={(e) => setRoute(e.target.value)}
          aria-label="Switch page"
          className="h-8 rounded-lg border border-border bg-base px-2 text-xs text-text-primary focus:border-accent/40 focus:outline-none"
        >
          {routes.map((r) => (
            <option key={r.routeUrl} value={r.routeUrl}>
              {r.page.title}
            </option>
          ))}
        </select>
        <div className="mx-1 h-4 w-px bg-border" />
        <div className="flex items-center gap-1" role="group" aria-label="Preview size">
          {DEVICES.map((d) => {
            const Icon = DEVICE_ICONS[d];
            return (
              <button
                key={d}
                onClick={() => setDevice(d)}
                aria-pressed={device === d}
                title={d}
                className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors ${
                  device === d
                    ? "bg-accent/15 text-accent"
                    : "text-text-dim hover:bg-card hover:text-text-primary"
                }`}
                type="button"
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{d}</span>
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        <span className="rounded-md bg-card px-2 py-1 text-[11px] text-text-dim">
          {route}
        </span>
      </div>

      {/* Content */}
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto p-4 sm:p-6">
        <div
          className="min-h-full overflow-hidden rounded-xl border border-border/60 bg-white shadow-card transition-all duration-300"
          style={{ width: PREVIEW_DEVICE_WIDTHS[device], maxWidth: "100%" }}
        >
          <div
            ref={contentRef}
            onClick={handleClick}
            className="min-h-full overflow-y-auto"
            style={{ maxHeight: "calc(100vh - 6rem)" }}
          >
            {activePage && <VisitorPageView project={project} page={activePage} />}
          </div>
        </div>
      </div>
    </div>
  );
}
