// ---------------------------------------------------------------------------
// Navigation foundation tests (Phase P22-A)
// Covers: typed NavTarget resolution against the existing routing system
// (homepage = first page), section anchors, external/email/phone/back targets,
// unresolved fallbacks, and unsafe URL rejection.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  isSafeNavUrl,
  navTargetToHref,
  resolveNavTarget,
} from "../navigation/resolve";
import { describeNavTarget } from "../navigation/types";
import type { Page } from "@/types/project";

const HOME: Page = {
  id: "home",
  title: "Home",
  slug: "/",
  sections: [],
};
const ABOUT: Page = {
  id: "about",
  title: "About",
  slug: "/about",
  sections: [],
};
const PRODUCTS: Page = {
  id: "products",
  title: "Products",
  slug: "/products",
  sections: [],
};
const PAGES: Page[] = [HOME, ABOUT, PRODUCTS];

describe("resolveNavTarget", () => {
  it("resolves a page target to the canonical route (homepage owns /)", () => {
    expect(resolveNavTarget({ kind: "page", pageId: "home" }, PAGES)).toEqual({
      href: "/",
      kind: "internal",
    });
    expect(resolveNavTarget({ kind: "page", pageId: "about" }, PAGES)).toEqual({
      href: "/about",
      kind: "internal",
    });
  });

  it("resolves a section target to an anchored route (defaults to homepage)", () => {
    const withoutPage = resolveNavTarget({ kind: "section", sectionId: "s-hero" }, PAGES);
    expect(withoutPage).toEqual({ href: "/#s-hero", kind: "internal" });

    const withPage = resolveNavTarget(
      { kind: "section", pageId: "about", sectionId: "s-team" },
      PAGES,
    );
    expect(withPage).toEqual({ href: "/about#s-team", kind: "internal" });
  });

  it("resolves external / email / phone / back targets", () => {
    expect(resolveNavTarget({ kind: "external", url: "https://example.com/x" }, PAGES)).toEqual({
      href: "https://example.com/x",
      kind: "external",
    });
    expect(resolveNavTarget({ kind: "email", to: "hi@buildora.app" }, PAGES)).toEqual({
      href: "mailto:hi@buildora.app",
      kind: "email",
    });
    expect(resolveNavTarget({ kind: "phone", number: "+1 555 0100" }, PAGES)).toEqual({
      href: "tel:+1 555 0100",
      kind: "phone",
    });
    expect(resolveNavTarget({ kind: "back" }, PAGES)).toEqual({
      href: "#",
      kind: "back",
    });
  });

  it("falls back to an unresolved '#' for unknown pages", () => {
    const result = resolveNavTarget({ kind: "page", pageId: "nope" }, PAGES);
    expect(result).toEqual({ href: "#", kind: "internal", unresolved: true });
  });

  it("rejects unsafe external schemes at resolution time", () => {
    const result = resolveNavTarget({ kind: "external", url: "javascript:alert(1)" }, PAGES);
    expect(result).toEqual({ href: "#", kind: "external", unresolved: true });
  });
});

describe("isSafeNavUrl", () => {
  it("accepts http/https/mailto/tel/relative and rejects script schemes", () => {
    expect(isSafeNavUrl("https://example.com")).toBe(true);
    expect(isSafeNavUrl("mailto:a@b.co")).toBe(true);
    expect(isSafeNavUrl("/about")).toBe(true);
    expect(isSafeNavUrl("javascript:void(0)")).toBe(false);
    expect(isSafeNavUrl("  javascript:alert(1)")).toBe(false);
    expect(isSafeNavUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeNavUrl("data:text/html,<script>1</script>")).toBe(false);
    expect(isSafeNavUrl("JaVaScRiPt:alert(1)")).toBe(false);
  });
});

describe("navTargetToHref + describeNavTarget", () => {
  it("returns the plain href string", () => {
    expect(navTargetToHref({ kind: "page", pageId: "products" }, PAGES)).toBe("/products");
    expect(navTargetToHref({ kind: "email", to: "a@b.co" }, PAGES)).toBe("mailto:a@b.co");
  });

  it("describes targets human-readably", () => {
    expect(describeNavTarget({ kind: "page", pageId: "home" })).toBe("Page home");
    expect(describeNavTarget({ kind: "section", sectionId: "s1" })).toBe("Section s1");
    expect(describeNavTarget({ kind: "external", url: "https://x.dev" })).toBe("https://x.dev");
    expect(describeNavTarget({ kind: "email", to: "a@b.co" })).toBe("a@b.co");
    expect(describeNavTarget({ kind: "phone", number: "123" })).toBe("123");
    expect(describeNavTarget({ kind: "back" })).toBe("Back");
  });
});
