"use client";

import type { BaseSection } from "@/types/section";
import type { CtaSectionProps } from "@/types/section";

export function CtaSection({ section }: { section: BaseSection }) {
  const props = section.props as unknown as CtaSectionProps;

  // Safety: ensure render-critical fields are strings, not objects
  const headline = typeof props.headline === "string" ? props.headline : "Get Started";
  const subheadline = typeof props.subheadline === "string" ? props.subheadline : null;
  const ctaText = typeof props.ctaText === "string" ? props.ctaText : "Get Started";

  return (
    <section
      style={{
        padding: "5rem 0",
        textAlign: "center",
        background: "var(--primary, #7c5cfc)",
      }}
    >
      <div
        style={{
          maxWidth: "640px",
          margin: "0 auto",
          padding: "0 2rem",
        }}
      >
        <h2
          style={{
            fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
            fontWeight: 700,
            color: "#ffffff",
            marginBottom: subheadline ? "0.75rem" : "1.5rem",
          }}
        >
          {headline}
        </h2>

        {subheadline && (
          <p
            style={{
              fontSize: "1.0625rem",
              color: "rgba(255,255,255,0.8)",
              marginBottom: "2rem",
            }}
          >
            {subheadline}
          </p>
        )}

        <span
          style={{
            display: "inline-block",
            padding: "0.75rem 2rem",
            borderRadius: "0.5rem",
            background: "#ffffff",
            color: "var(--primary, #7c5cfc)",
            fontWeight: 600,
            fontSize: "0.9375rem",
            cursor: "default",
          }}
        >
          {ctaText}
        </span>
      </div>
    </section>
  );
}
