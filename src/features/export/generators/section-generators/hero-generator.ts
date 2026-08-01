import type { OutputFile } from "../../pipeline/types";

// ---------------------------------------------------------------------------
// Hero section generator
//
// Produces a reusable component with headline, subheadline, optional CTAs,
// and optional content/foreground image. Legacy image URLs are supported
// through legacyImageSrc. Background image is applied via inline style.
// React handles HTML escaping.
// ---------------------------------------------------------------------------

export function generateHeroComponent(): OutputFile {
  const content = `export interface HeroProps {
  headline: string;
  subheadline?: string;
  primaryCta: { text: string; href: string };
  secondaryCta?: { text: string; href: string };
  heroSrc?: string;
  legacyImageSrc?: string;
  heroAlt?: string;
  backgroundSrc?: string;
}

export function Hero({ headline, subheadline, primaryCta, secondaryCta, heroSrc, legacyImageSrc, heroAlt, backgroundSrc }: HeroProps) {
  const sectionStyle: Record<string, string> = {};
  if (backgroundSrc) {
    sectionStyle.backgroundImage = \`url("\${backgroundSrc}")\`;
    sectionStyle.backgroundSize = "cover";
    sectionStyle.backgroundPosition = "center";
  }

  // Content image precedence: valid AssetRef > legacy URL > no image
  const contentSrc = heroSrc || legacyImageSrc;

  return (
    <section className="py-24 text-center" style={sectionStyle}>
      <div className="mx-auto max-w-3xl px-8">
        {contentSrc && (
          <div className="mb-6 flex justify-center">
            <img
              src={contentSrc}
              alt={heroAlt || "Hero image"}
              className="max-h-[400px] w-auto rounded-xl object-contain"
            />
          </div>
        )}
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
