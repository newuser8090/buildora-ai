// ---------------------------------------------------------------------------
// /share/[token] — public read-only review link (Phase P12)
//
// Renders the sanitized share projection with NO editor chrome: no inline
// editing, no inspector, no block tree, no AI controls, no account controls.
// Reuses the existing visitor rendering architecture (VisitorPageView +
// SectionAssetProvider + computePageRoutes + classifyPreviewLink) — there is
// no second website renderer.
//
// Server authorization rules everything: invalid/expired/revoked tokens show
// safe beginner copy and never render content. The page fetches with
// no-store semantics so revocation/expiration can never be defeated by
// client caching.
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Loader2, MessageSquareText, ShieldAlert, TimerOff, Link2Off } from "lucide-react";
import { useRegisterDefaultSections } from "@/features/editor/registry/register-default-sections";
import { computePageRoutes } from "@/features/routing/routes";
import { classifyPreviewLink } from "@/features/preview/engine/navigation";
import { VisitorPageView } from "@/features/preview/components/VisitorPageView";
import { SectionAssetProvider } from "@/features/editor/hooks/useSectionAssets";
import { getShareProvider, ShareLinkService } from "@/features/sharing/services/share-link-service";
import { FeedbackSheet } from "@/features/sharing/components/FeedbackSheet";
import type { PublicShareInfo, ShareProjection } from "@/features/sharing/types";
import type { Project } from "@/types/project";

type ViewState =
  | { status: "loading" }
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "revoked" }
  | { status: "ready"; share: PublicShareInfo; projection: ShareProjection };

const ERROR_COPY: Record<"invalid" | "expired" | "revoked", { title: string; body: string }> = {
  invalid: {
    title: "This review link isn't working",
    body: "The link may be mistyped, or it never existed. Double-check the full link with the person who shared it.",
  },
  expired: {
    title: "This review link has expired",
    body: "The site owner set this link to expire. Ask them to send a fresh review link.",
  },
  revoked: {
    title: "This review link is no longer available",
    body: "The site owner stopped sharing this link. Ask them for a new one if they still want your feedback.",
  },
};

export default function ShareReviewPage() {
  const params = useParams<{ token: string }>();
  const rawToken = typeof params?.token === "string" ? params.token : "";
  const [view, setView] = useState<ViewState>({ status: "loading" });
  const [route, setRoute] = useState("/");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // This route mounts outside the editor, so the section registry would be
  // empty without an explicit registration — the site would render blank.
  useRegisterDefaultSections();

  useEffect(() => {
    // Robots: the review link is not meant for search indexes.
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  useEffect(() => {
    if (!rawToken) {
      // Deferred so the state update lands after the effect (lint convention).
      const id = requestAnimationFrame(() => setView({ status: "invalid" }));
      return () => cancelAnimationFrame(id);
    }
    let cancelled = false;
    const provider = getShareProvider();
    if (!provider) {
      const id = requestAnimationFrame(() => setView({ status: "invalid" }));
      return () => {
        cancelled = true;
        cancelAnimationFrame(id);
      };
    }
    const service = new ShareLinkService(provider);
    service
      .resolvePublic(rawToken)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setView({ status: "ready", share: result.share, projection: result.projection });
        } else {
          setView({ status: result.state });
        }
      })
      .catch(() => {
        if (!cancelled) setView({ status: "invalid" });
      });
    return () => {
      cancelled = true;
    };
  }, [rawToken]);

  const routes = useMemo(
    () => (view.status === "ready" ? computePageRoutes(view.projection.pages) : []),
    [view],
  );
  const routeUrls = useMemo(() => routes.map((r) => r.routeUrl), [routes]);
  const activePage = useMemo(
    () => routes.find((r) => r.routeUrl === route)?.page ?? routes[0]?.page,
    [routes, route],
  );

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

  if (view.status === "loading") {
    return (
      <div className="flex h-dvh items-center justify-center bg-base">
        <Loader2 className="h-7 w-7 animate-spin text-accent" />
      </div>
    );
  }

  if (view.status !== "ready") {
    const copy = ERROR_COPY[view.status];
    const Icon =
      view.status === "invalid" ? ShieldAlert : view.status === "expired" ? TimerOff : Link2Off;
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-base px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-card">
          <Icon className="h-7 w-7 text-text-dim" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-text-primary" data-testid="share-error-title">
            {copy.title}
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-text-muted">{copy.body}</p>
        </div>
        <Link
          href="/"
          className="flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          Make your own website
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-secondary">
      {/* ---- Review chrome (never editor chrome) ---- */}
      <div className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-border bg-base px-3">
        <span
          className="flex h-6 items-center gap-1.5 rounded-full bg-accent/10 px-2.5 text-[11px] font-medium text-accent"
          data-testid="share-review-badge"
        >
          <MessageSquareText className="h-3 w-3" />
          Review link
        </span>
        <span className="max-w-[30%] truncate text-xs font-medium text-text-primary sm:max-w-[40%]">
          {view.projection.name}
        </span>

        <div className="mx-1 h-4 w-px bg-border" />

        <select
          value={route}
          onChange={(e) => setRoute(e.target.value)}
          aria-label="Switch page"
          data-testid="share-page-switcher"
          className="h-8 rounded-lg border border-border bg-base px-2 text-xs text-text-primary focus:border-accent/40 focus:outline-none"
        >
          {routes.map((r) => (
            <option key={r.routeUrl} value={r.routeUrl}>
              {r.page.title}
            </option>
          ))}
        </select>

        <div className="flex-1" />

        {view.share.feedbackEnabled && (
          <button
            onClick={() => setFeedbackOpen(true)}
            data-testid="share-leave-feedback"
            className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
            type="button"
          >
            <MessageSquareText className="h-3.5 w-3.5" />
            Leave feedback
          </button>
        )}
      </div>

      {/* ---- Site content (safe navigation) ---- */}
      <div className="min-h-0 flex-1 overflow-auto" ref={contentRef} onClick={handleClick}>
        <SectionAssetProvider assets={view.projection.assets}>
          {activePage && (
            <VisitorPageView
              project={projectionToProject(view.projection)}
              page={activePage}
            />
          )}
        </SectionAssetProvider>
      </div>

      {/* ---- Footer attribution ---- */}
      <div className="flex h-9 flex-shrink-0 items-center justify-center border-t border-border bg-base text-[11px] text-text-dim">
        Made with Buildora
      </div>

      {feedbackOpen && (
        <FeedbackSheet
          share={view.share}
          token={rawToken}
          pageId={activePage?.id}
          onClose={() => setFeedbackOpen(false)}
        />
      )}
    </div>
  );
}

/** Project-shaped view needed by the shared renderer (timestamps are empty). */
function projectionToProject(projection: ShareProjection): Project {
  return {
    ...projection,
    createdAt: "",
    updatedAt: "",
  };
}
