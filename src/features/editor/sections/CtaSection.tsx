"use client";

import { useSectionAssets } from "@/features/editor/hooks/useSectionAssets";
import { resolveAsset } from "@/features/assets/services/asset-resolver";
import type { BaseSection } from "@/types/section";
import type { CtaSectionProps } from "@/types/section";

export function CtaSection({ section }: { section: BaseSection }) {
  const props = section.props as unknown as CtaSectionProps;
  const assets = useSectionAssets();

  // Resolve background image
  const bgImg = resolveAsset(props.backgroundImage, assets);

  // Safety: ensure render-critical fields are strings, not objects
  const headline = typeof props.headline === "string" ? props.headline : "Get Started";
  const subheadline = typeof props.subheadline === "string" ? props.subheadline : null;
  const ctaText = typeof props.ctaText === "string" ? props.ctaText : "Get Started";

  // Background style — use resolved asset or fall back to theme
  const sectionStyle: Record<string, unknown> = {
    padding: "5rem 0",
    textAlign: "center",
    background: "var(--primary, #7c5cfc)",
    position: "relative",
  };
  if (bgImg.src) {
    sectionStyle.backgroundImage = `url("${bgImg.src.replace(/"/g, "'")}")`;
    sectionStyle.backgroundSize = "cover";
    sectionStyle.backgroundPosition = "center";
    // Add a subtle overlay for readability
    sectionStyle.background = undefined; // Remove solid background — image covers
  }

  return (
    <section style={sectionStyle}>
      {/* Content overlay for contrast when background image is present */}
      {bgImg.src && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "var(--primary, #7c5cfc)",
            opacity: 0.75,
          }}
        />
      )}
      <div
        style={{
          maxWidth: "640px",
          margin: "0 auto",
          padding: "0 2rem",
          position: "relative",
          zIndex: 1,
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
