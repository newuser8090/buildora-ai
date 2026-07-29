import type { OutputFile } from "../../pipeline/types";

// ---------------------------------------------------------------------------
// Hero section generator
//
// Produces a reusable component with headline, subheadline, and optional CTAs.
// React handles HTML escaping at runtime.
// ---------------------------------------------------------------------------

export function generateHeroComponent(): OutputFile {
  const content = `export interface HeroProps {
  headline: string;
  subheadline?: string;
  primaryCta: { text: string; href: string };
  secondaryCta?: { text: string; href: string };
}

export function Hero({ headline, subheadline, primaryCta, secondaryCta }: HeroProps) {
  return (
    <section className="py-24 text-center">
      <div className="mx-auto max-w-3xl px-8">
        <h1 className="text-[clamp(2rem,5vw,3.5rem)] font-bold leading-tight tracking-tight text-foreground">
          {headline}
        </h1>
        {subheadline && (
          <p className="mx-auto mb-8 mt-4 max-w-[560px] text-lg leading-relaxed text-muted-foreground">
            {subheadline}
          </p>
        )}
        <div className="flex items-center justify-center gap-3">
          <a
            href={primaryCta.href || "#"}
            className="rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground transition-colors hover:opacity-90"
          >
            {primaryCta.text}
          </a>
          {secondaryCta && (
            <a
              href={secondaryCta.href || "#"}
              className="rounded-lg border border-border px-6 py-3 font-medium text-foreground transition-colors hover:bg-muted"
            >
              {secondaryCta.text}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
`;

  return { path: "components/sections/hero.tsx", content };
}
