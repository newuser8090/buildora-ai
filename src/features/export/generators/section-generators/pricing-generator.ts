import type { OutputFile } from "../../pipeline/types";

// ---------------------------------------------------------------------------
// Pricing section generator
//
// Produces a reusable component with pricing plan cards.
// React handles HTML escaping at runtime.
// ---------------------------------------------------------------------------

export function generatePricingComponent(): OutputFile {
  const content = `export interface PricingPlan {
  name: string;
  price: string;
  description: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
}

export interface PricingProps {
  title: string;
  subtitle?: string;
  plans: PricingPlan[];
}

export function Pricing({ title, subtitle, plans }: PricingProps) {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-6xl px-8 text-center">
        <h2 className="text-[clamp(1.5rem,3vw,2.25rem)] font-bold text-foreground">
          {title}
        </h2>
        {subtitle && (
          <p className="mx-auto mb-12 mt-3 max-w-[560px] text-[1.0625rem] text-muted-foreground">
            {subtitle}
          </p>
        )}
        {plans.length > 0 && (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan, i) => (
              <div
                key={i}
                className={"relative rounded-xl p-10 text-left " + (plan.highlighted ? "border-2 border-primary ring-1 ring-primary" : "border border-border")}
                style={{ background: "var(--color-card, #ffffff)" }}
              >
                {plan.highlighted && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-0.5 text-xs font-semibold text-primary-foreground">
                    Popular
                  </span>
                )}
                <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
                <div className="mb-1 mt-2 text-4xl font-bold text-foreground">{plan.price}</div>
                {plan.description && (
                  <p className="mb-6 text-sm text-muted-foreground">{plan.description}</p>
                )}
                {plan.features.length > 0 && (
                  <ul className="mb-8 flex flex-col gap-3">
                    {plan.features.map((f, fi) => (
                      <li key={fi} className="flex items-center gap-2 text-sm text-foreground">
                        <span className="text-primary">\\u2713</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                )}
                <a
                  href="#"
                  className={"block rounded-lg px-6 py-3 text-center text-sm font-semibold transition-colors hover:opacity-90 " + (plan.highlighted ? "bg-primary text-primary-foreground" : "bg-muted text-foreground")}
                >
                  {plan.cta}
                </a>
              </div>
            ))}
          </div>
        )}
        {plans.length === 0 && (
          <p className="text-sm text-muted-foreground">No pricing plans available.</p>
        )}
      </div>
    </section>
  );
}
`;

  return { path: "components/sections/pricing.tsx", content };
}
