"use client";

import type { BaseSection } from "@/types/section";
import type { PricingSectionProps } from "@/types/section";

export function PricingSection({ section }: { section: BaseSection }) {
  const props = section.props as unknown as PricingSectionProps;

  // Safety: ensure render-critical fields exist
  const title = typeof props.title === "string" ? props.title : "Pricing";
  const subtitle = typeof props.subtitle === "string" ? props.subtitle : null;
  const plans = Array.isArray(props.plans) ? props.plans : [];

  return (
    <section style={{ padding: "5rem 0" }}>
      <div
        style={{
          maxWidth: "1120px",
          margin: "0 auto",
          padding: "0 2rem",
          textAlign: "center",
        }}
      >
        <h2
          style={{
            fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
            fontWeight: 700,
            color: "var(--foreground, #0a0a0a)",
            marginBottom: subtitle ? "0.75rem" : "3rem",
          }}
        >
          {title}
        </h2>

        {subtitle && (
          <p
            style={{
              fontSize: "1.0625rem",
              color: "var(--muted-foreground, #737373)",
              maxWidth: "560px",
              margin: "0 auto 3rem",
            }}
          >
            {subtitle}
          </p>
        )}

        {plans.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "1.5rem",
              alignItems: "start",
            }}
          >
            {plans.map((plan, idx) => {
              // Safety: ensure plan fields are strings, not objects
              const planName = typeof plan.name === "string" ? plan.name : `Plan ${idx + 1}`;
              const planPrice = typeof plan.price === "string" ? plan.price : "$0";
              const planDescription = typeof plan.description === "string" ? plan.description : "";
              const planCta = typeof plan.cta === "string" ? plan.cta : "Get Started";
              const planFeatures = Array.isArray(plan.features) ? plan.features : [];
              const highlighted = !!plan.highlighted;

              return (
                <div
                  key={`${planName}-${idx}`}
                  style={{
                    padding: "2.5rem 2rem",
                    borderRadius: "0.75rem",
                    background: "var(--card, #ffffff)",
                    border: highlighted
                      ? "2px solid var(--primary, #7c5cfc)"
                      : "1px solid var(--border, #e5e5e5)",
                    position: "relative",
                    textAlign: "left",
                  }}
                >
                  {highlighted && (
                    <span
                      style={{
                        position: "absolute",
                        top: "-0.75rem",
                        left: "50%",
                        transform: "translateX(-50%)",
                        padding: "0.25rem 1rem",
                        borderRadius: "999px",
                        background: "var(--primary, #7c5cfc)",
                        color: "#ffffff",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                      }}
                    >
                      Popular
                    </span>
                  )}

                  <h3
                    style={{
                      fontSize: "1.125rem",
                      fontWeight: 600,
                      color: "var(--foreground, #0a0a0a)",
                      marginBottom: "0.5rem",
                    }}
                  >
                    {planName}
                  </h3>

                  <div
                    style={{
                      fontSize: "2.5rem",
                      fontWeight: 700,
                      color: "var(--foreground, #0a0a0a)",
                      marginBottom: "0.25rem",
                    }}
                  >
                    {planPrice}
                  </div>

                  {planDescription && (
                    <p
                      style={{
                        fontSize: "0.875rem",
                        color: "var(--muted-foreground, #737373)",
                        marginBottom: "1.5rem",
                      }}
                    >
                      {planDescription}
                    </p>
                  )}

                  {planFeatures.length > 0 && (
                    <ul style={{ listStyle: "none", padding: 0, margin: "0 0 2rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                      {planFeatures.map((f, fi) => (
                        <li
                          key={fi}
                          style={{
                            fontSize: "0.875rem",
                            color: "var(--foreground, #0a0a0a)",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                          }}
                        >
                          <span style={{ color: "var(--primary, #7c5cfc)" }}>✓</span>
                          {typeof f === "string" ? f : ""}
                        </li>
                      ))}
                    </ul>
                  )}

                  <span
                    style={{
                      display: "block",
                      textAlign: "center",
                      padding: "0.75rem",
                      borderRadius: "0.5rem",
                      background: highlighted
                        ? "var(--primary, #7c5cfc)"
                        : "var(--muted, #f5f5f5)",
                      color: highlighted
                        ? "#ffffff"
                        : "var(--foreground, #0a0a0a)",
                      fontWeight: 600,
                      fontSize: "0.9375rem",
                      cursor: "default",
                    }}
                  >
                    {planCta}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {plans.length === 0 && (
          <p style={{ fontSize: "0.875rem", color: "var(--muted-foreground, #737373)" }}>
            No pricing plans available.
          </p>
        )}
      </div>
    </section>
  );
}
