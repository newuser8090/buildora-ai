"use client";

import { useSectionAssets } from "@/features/editor/hooks/useSectionAssets";
import { resolveAsset } from "@/features/assets/services/asset-resolver";
import { ResolvedAssetImage } from "@/features/assets/components/ResolvedAssetImage";
import {
  EditableHeading,
  EditableText,
} from "@/features/inline-editing/components/EditableText";
import type { BaseSection } from "@/types/section";
import type { FeaturesSectionProps } from "@/types/section";

/** Simple icon resolution for the mock data icon names. */
function resolveIcon(name: string) {
  const icons: Record<string, string> = {
    Zap: "⚡",
    Shield: "🛡",
    Globe: "🌐",
    BarChart: "📊",
    Layers: "📐",
    Sparkles: "✨",
    Heart: "♥",
    Star: "★",
  };
  return icons[name] ?? "◆";
}

export function FeaturesSection({ section }: { section: BaseSection }) {
  const props = section.props as unknown as FeaturesSectionProps;
  const assets = useSectionAssets();

  // Safety: ensure render-critical fields exist
  const title = typeof props.title === "string" ? props.title : "Features";
  const subtitle = typeof props.subtitle === "string" ? props.subtitle : null;
  const features = Array.isArray(props.features) ? props.features : [];

  return (
    <section
      style={{
        padding: "5rem 0",
        background: "var(--muted, #f5f5f5)",
      }}
    >
      <div
        style={{
          maxWidth: "1120px",
          margin: "0 auto",
          padding: "0 2rem",
          textAlign: "center",
        }}
      >
        <EditableHeading
          section={section}
          fieldId="features.title"
          value={title}
          as="h2"
          style={{
            fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
            fontWeight: 700,
            color: "var(--foreground, #0a0a0a)",
            marginBottom: subtitle ? "0.75rem" : "3rem",
          }}
        />

        {subtitle && (
          <EditableText
            section={section}
            fieldId="features.subtitle"
            value={subtitle}
            as="p"
            style={{
              fontSize: "1.0625rem",
              color: "var(--muted-foreground, #737373)",
              maxWidth: "560px",
              margin: "0 auto 3rem",
            }}
          />
        )}

        {features.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "1.5rem",
            }}
          >
            {features.map((feature, idx) => {
              const featureTitle = typeof feature.title === "string" ? feature.title : `Feature ${idx + 1}`;
              const featureDescription = typeof feature.description === "string" ? feature.description : "";
              const featureIcon = typeof feature.icon === "string" ? feature.icon : "Zap";

              // Resolve per-feature iconImage independently
              const iconImg = feature.iconImage ? resolveAsset(feature.iconImage, assets) : undefined;
              const showIconImage = iconImg?.src && !iconImg.missing;

              return (
                <div
                  key={featureTitle}
                  style={{
                    padding: "2rem",
                    borderRadius: "0.75rem",
                    background: "var(--card, #ffffff)",
                    border: "1px solid var(--border, #e5e5e5)",
                    textAlign: "left",
                    transition: "box-shadow 200ms, transform 200ms",
                  }}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget;
                    el.style.boxShadow = "0 8px 24px rgba(0,0,0,0.08)";
                    el.style.transform = "translateY(-2px)";
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget;
                    el.style.boxShadow = "none";
                    el.style.transform = "none";
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "3rem",
                      height: "3rem",
                      marginBottom: "0.75rem",
                      borderRadius: "0.5rem",
                      overflow: "hidden",
                    }}
                  >
                    {showIconImage ? (
                      <ResolvedAssetImage
                        src={iconImg!.src}
                        alt={iconImg!.alt || featureTitle}
                        fit="contain"
                        width="100%"
                        maxHeight="3rem"
                        fallback={<span style={{ fontSize: "1.5rem" }}>{resolveIcon(featureIcon)}</span>}
                      />
                    ) : (
                      <span style={{ fontSize: "1.5rem" }}>{resolveIcon(featureIcon)}</span>
                    )}
                  </div>
                  <EditableHeading
                    section={section}
                    fieldId="features.feature.title"
                    index={idx}
                    value={featureTitle}
                    as="h3"
                    style={{
                      fontSize: "1.0625rem",
                      fontWeight: 600,
                      color: "var(--foreground, #0a0a0a)",
                      marginBottom: "0.5rem",
                    }}
                  />
                  {featureDescription && (
                    <EditableText
                      section={section}
                      fieldId="features.feature.description"
                      index={idx}
                      value={featureDescription}
                      as="p"
                      style={{
                        fontSize: "0.875rem",
                        lineHeight: 1.6,
                        color: "var(--muted-foreground, #737373)",
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {features.length === 0 && (
          <p style={{ fontSize: "0.875rem", color: "var(--muted-foreground, #737373)" }}>
            No features to display.
          </p>
        )}
      </div>
    </section>
  );
}
