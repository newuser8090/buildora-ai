import type { OutputFile } from "../../pipeline/types";

// ---------------------------------------------------------------------------
// Footer section generator
//
// Produces a reusable component with copyright text and navigation links.
// React handles HTML escaping at runtime.
// ---------------------------------------------------------------------------

export function generateFooterComponent(): OutputFile {
  const content = `export interface FooterProps {
  text: string;
  links: { text: string; href: string }[];
}

export function Footer({ text, links }: FooterProps) {
  return (
    <footer className="border-t border-border py-8">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-8">
        <span className="text-sm text-muted-foreground">{text}</span>
        {links.length > 0 && (
          <nav className="flex gap-6">
            {links.map((link) => (
              <a
                key={link.text}
                href={link.href || "#"}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.text}
              </a>
            ))}
          </nav>
        )}
      </div>
    </footer>
  );
}
`;

  return { path: "components/sections/footer.tsx", content };
}
