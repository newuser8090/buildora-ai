// ---------------------------------------------------------------------------
// Navigation resolution (Phase P22-A)
//
// Turns a typed NavTarget into a concrete href/behavior using the EXISTING
// routing system (computePageRoutes). No UI — the "Navigate to…" picker
// arrives in a later sub-phase.
//
// Safe by construction: unsafe URL schemes are rejected; unknown page targets
// resolve to "#" with `unresolved: true` (never a dead navigation).
//
// Pure, deterministic, framework-independent.
// ---------------------------------------------------------------------------

import { computePageRoutes } from "@/features/routing/routes";
import type { Page } from "@/types/project";
import type { NavTarget } from "./types";

export interface ResolvedNavigation {
  href: string;
  kind: "internal" | "external" | "email" | "phone" | "back";
  /** True when the target could not be resolved to a known page/safe URL. */
  unresolved?: boolean;
}

/** Unsafe URL schemes are always rejected (mirrors preview navigation). */
export function isSafeNavUrl(url: string): boolean {
  const lower = url.trim().toLowerCase();
  if (lower.startsWith("javascript:")) return false;
  if (lower.startsWith("vbscript:")) return false;
  if (lower.startsWith("data:text/html")) return false;
  return true;
}

/** Resolve a NavTarget against a project's pages (homepage = pages[0]). */
export function resolveNavTarget(
  target: NavTarget,
  pages: Page[],
): ResolvedNavigation {
  const routes = computePageRoutes(pages);

  switch (target.kind) {
    case "page": {
      const route = routes.find((r) => r.page.id === target.pageId);
      if (!route) {
        return { href: "#", kind: "internal", unresolved: true };
      }
      return { href: route.routeUrl, kind: "internal" };
    }
    case "section": {
      // Default to the current page (first route) when no page is specified.
      const route = target.pageId
        ? routes.find((r) => r.page.id === target.pageId)
        : routes[0];
      if (!route) {
        return { href: "#", kind: "internal", unresolved: true };
      }
      return { href: `${route.routeUrl}#${target.sectionId}`, kind: "internal" };
    }
    case "external": {
      const url = target.url.trim();
      if (!isSafeNavUrl(url)) {
        return { href: "#", kind: "external", unresolved: true };
      }
      return { href: url, kind: "external" };
    }
    case "email":
      return { href: `mailto:${target.to}`, kind: "email" };
    case "phone":
      return { href: `tel:${target.number}`, kind: "phone" };
    case "back":
      return { href: "#", kind: "back" };
  }
}

/** Convenience: resolve a NavTarget to a plain href string. */
export function navTargetToHref(target: NavTarget, pages: Page[]): string {
  return resolveNavTarget(target, pages).href;
}
