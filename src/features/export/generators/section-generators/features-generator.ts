import type { OutputFile } from "../../pipeline/types";

// ---------------------------------------------------------------------------
// Features section generator
//
// Produces a reusable component with a responsive grid of feature cards.
// Each card supports an optional icon image (standard <img>).
// React handles HTML escaping at runtime.
// ---------------------------------------------------------------------------

export function generateFeaturesComponent(): OutputFile {
  const content = `function resolveIcon(name: string): string {
  const icons: Record<string, string> = {
    Zap: "\\\\u26A1", Shield: "\\\\uD83D\\\\uDEE1", Globe: "\\\\uD83C\\\\uDF10",
    BarChart: "\\\\uD83D\\\\uDCCA", Layers: "\\\\uD83D\\\\uDCD0", Sparkles: "\\\\u2728",
    Heart: "\\\\u2665", Star: "\\\\u2605",
  };
  return icons[name] ?? "\\\\u25C6";
}

export interface FeatureItem {
  title: string;
  description: string;
  icon: string;
  iconSrc?: string;
  iconAlt?: string;
}

export interface FeaturesProps {
  title: string;
  subtitle?: string;
  features: FeatureItem[];
}

export function Features({ title, subtitle, features }: FeaturesProps) {
  return (
    <section className="bg-muted py-20">
      <div className="mx-auto max-w-6xl px-8 text-center">
        <h2 className="text-[clamp(1.5rem,3vw,2.25rem)] font-bold text-foreground">
          {title}
        </h2>
        {subtitle && (
          <p className="mx-auto mb-12 mt-3 max-w-[560px] text-[1.0625rem] text-muted-foreground">
            {subtitle}
          </p>
        )}
        {features.length > 0 && (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <div
                key={i}
                className="rounded-xl border border-border bg-card p-8 text-left transition-shadow hover:shadow-lg"
              >
                <div className="mb-3 flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg">
                  {f.iconSrc ? (
                    <img
                      src={f.iconSrc}
                      alt={f.iconAlt || f.title}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <span className="text-2xl">{resolveIcon(f.icon)}</span>
                  )}
                </div>
                <h3 className="mb-2 text-[1.0625rem] font-semibold text-foreground">
                  {f.title}
                </h3>
                {f.description && (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {f.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
        {features.length === 0 && (
          <p className="text-sm text-muted-foreground">No features to display.</p>
        )}
      </div>
    </section>
  );
}
`;

  return { path: "components/sections/features.tsx", content };
}
