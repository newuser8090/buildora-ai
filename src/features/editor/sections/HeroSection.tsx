"use client";

import { useSectionAssets } from "@/features/editor/hooks/useSectionAssets";
import { resolveAsset } from "@/features/assets/services/asset-resolver";
import { ResolvedAssetImage } from "@/features/assets/components/ResolvedAssetImage";
import type { BaseSection } from "@/types/section";
import type { HeroSectionProps } from "@/types/section";

export function HeroSection({ section }: { section: BaseSection }) {
  const props = section.props as unknown as HeroSectionProps;
  const assets = useSectionAssets();

  // Resolve hero image and background image
  const heroImg = resolveAsset(props.heroImage, assets);
  const bgImg = resolveAsset(props.backgroundImage, assets);

  // Use legacy image URL as fallback for content image
  const contentImgSrc = heroImg.src || (typeof props.image === "string" ? props.image : undefined);

  // Safety: ensure render-critical fields exist
  const headline = typeof props.headline === "string" ? props.headline : "Welcome";
  const subheadline = typeof props.subheadline === "string" ? props.subheadline : "";
  const primaryCtaText = props.primaryCta && typeof props.primaryCta.text === "string"
    ? props.primaryCta.text
    : "Get Started";
  const secondaryCtaText = props.secondaryCta && typeof props.secondaryCta.text === "string"
    ? props.secondaryCta.text
    : null;

  // Background style — use resolved asset or fall back to theme
  const sectionStyle: Record<string, unknown> = {
    padding: "6rem 0",
    textAlign: "center",
  };
  if (bgImg.src) {
    sectionStyle.backgroundImage = `url("${bgImg.src.replace(/"/g, "'")}")`;
    sectionStyle.backgroundSize = "cover";
    sectionStyle.backgroundPosition = "center";
    sectionStyle.position = "relative";
  }

  return (
    <section style={sectionStyle}>
      <div
        style={{
          maxWidth: "720px",
          margin: "0 auto",
          padding: "0 2rem",
        }}
      >
        {/* Content image (AssetRef or legacy URL) */}
        {contentImgSrc && (
          <div style={{ marginBottom: "1.5rem", display: "flex", justifyContent: "center" }}>
            <ResolvedAssetImage
              src={contentImgSrc}
              alt={heroImg.alt || "Hero image"}
              fit="contain"
              maxHeight="400px"
              style={{ borderRadius: "0.75rem" }}
            />
          </div>
        )}

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
