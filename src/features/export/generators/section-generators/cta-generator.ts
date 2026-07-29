import type { OutputFile } from "../../pipeline/types";

// ---------------------------------------------------------------------------
// CTA section generator
//
// Produces a reusable call-to-action component with headline and button.
// React handles HTML escaping at runtime.
// ---------------------------------------------------------------------------

export function generateCtaComponent(): OutputFile {
  const content = `export interface CtaProps {
  headline: string;
  subheadline?: string;
  ctaText: string;
  ctaHref: string;
}

export function Cta({ headline, subheadline, ctaText, ctaHref }: CtaProps) {
  return (
    <section className="bg-primary py-20 text-center">
      <div className="mx-auto max-w-2xl px-8">
        <h2 className="text-[clamp(1.5rem,3vw,2.25rem)] font-bold text-primary-foreground">
          {headline}
        </h2>
        {subheadline && (
          <p className="mb-8 mt-3 text-[1.0625rem] text-primary-foreground/80">
            {subheadline}
          </p>
        )}
        <a
          href={ctaHref || "#"}
          className="inline-block rounded-lg bg-white px-8 py-3 font-semibold text-primary transition-colors hover:opacity-90"
        >
          {ctaText}
        </a>
      </div>
    </section>
  );
}
`;

  return { path: "components/sections/cta.tsx", content };
}
