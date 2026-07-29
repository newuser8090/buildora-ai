import type { OutputFile } from "../../pipeline/types";

// ---------------------------------------------------------------------------
// Header section generator
//
// Produces a reusable component with navigation links and optional CTA.
// React handles HTML escaping at runtime — no manual safe() needed.
// ---------------------------------------------------------------------------

export function generateHeaderComponent(): OutputFile {
  const content = `export interface HeaderProps {
  logoText: string;
  navLinks: { text: string; href: string }[];
  ctaText?: string;
  ctaHref?: string;
}

export function Header({ logoText, navLinks, ctaText, ctaHref }: HeaderProps) {
  return (
    <header className="border-b border-border px-6 py-4">
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        <span className="text-xl font-bold text-foreground">{logoText}</span>
        <nav className="flex items-center gap-6">
          {navLinks.map((link) => (
            <a
              key={link.text}
              href={link.href || "#"}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.text}
            </a>
          ))}
          {ctaText && (
            <a
              href={ctaHref || "#"}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
            >
              {ctaText}
            </a>
          )}
        </nav>
      </div>
    </header>
  );
}
`;

  return { path: "components/sections/header.tsx", content };
}
