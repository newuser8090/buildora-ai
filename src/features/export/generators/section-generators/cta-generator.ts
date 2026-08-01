import type { OutputFile } from "../../pipeline/types";

// ---------------------------------------------------------------------------
// CTA section generator
//
// Produces a reusable call-to-action component with headline, button,
// and optional background image. React handles HTML escaping at runtime.
// ---------------------------------------------------------------------------

export function generateCtaComponent(): OutputFile {
  const content = `export interface CtaProps {
  headline: string;
  subheadline?: string;
  ctaText: string;
  ctaHref: string;
  backgroundSrc?: string;
}

export function Cta({ headline, subheadline, ctaText, ctaHref, backgroundSrc }: CtaProps) {
  const sectionStyle: Record<string, string> = { textAlign: "center" };
  if (backgroundSrc) {
    sectionStyle.backgroundImage = \`url("\${backgroundSrc}")\`;
    sectionStyle.backgroundSize = "cover";
    sectionStyle.backgroundPosition = "center";
    sectionStyle.position = "relative";
  }

  return (
    <section className="bg-primary py-20" style={sectionStyle}>
      {backgroundSrc && (
        <div
          className="absolute inset-0"
          style={{ background: "var(--color-primary, #7c5cfc)", opacity: 0.75 }}
        />
      )}
      <div className="relative z-10 mx-auto max-w-2xl px-8">
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
