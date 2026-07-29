"use client";

import type { BaseSection } from "@/types/section";
import type { HeroSectionProps } from "@/types/section";

export function HeroSection({ section }: { section: BaseSection }) {
  const props = section.props as unknown as HeroSectionProps;

  // Safety: ensure render-critical fields exist
  const headline = typeof props.headline === "string" ? props.headline : "Welcome";
  const subheadline = typeof props.subheadline === "string" ? props.subheadline : "";
  const primaryCtaText = props.primaryCta && typeof props.primaryCta.text === "string"
    ? props.primaryCta.text
    : "Get Started";
  const secondaryCtaText = props.secondaryCta && typeof props.secondaryCta.text === "string"
    ? props.secondaryCta.text
    : null;

  return (
    <section
      style={{
        padding: "6rem 0",
        textAlign: "center",
      }}
    >
      <div
        style={{
          maxWidth: "720px",
          margin: "0 auto",
          padding: "0 2rem",
        }}
      >
        <h1
          style={{
            fontSize: "clamp(2rem, 5vw, 3.5rem)",
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            color: "var(--foreground, #0a0a0a)",
            marginBottom: "1.25rem",
          }}
        >
          {headline}
        </h1>

        {subheadline && (
          <p
            style={{
              fontSize: "1.125rem",
              lineHeight: 1.6,
              color: "var(--muted-foreground, #737373)",
              maxWidth: "560px",
              margin: "0 auto 2rem",
            }}
          >
            {subheadline}
          </p>
        )}

        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
          <span
            style={{
              display: "inline-block",
              padding: "0.75rem 1.5rem",
              borderRadius: "0.5rem",
              background: "var(--primary, #7c5cfc)",
              color: "var(--primary-foreground, #ffffff)",
              fontWeight: 600,
              fontSize: "0.9375rem",
              cursor: "default",
            }}
          >
            {primaryCtaText}
          </span>

          {secondaryCtaText && (
            <span
              style={{
                display: "inline-block",
                padding: "0.75rem 1.5rem",
                borderRadius: "0.5rem",
                border: "1px solid var(--border, #e5e5e5)",
                color: "var(--foreground, #0a0a0a)",
                fontWeight: 500,
                fontSize: "0.9375rem",
                cursor: "default",
              }}
            >
              {secondaryCtaText}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
