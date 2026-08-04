"use client";

import { useSectionAssets } from "@/features/editor/hooks/useSectionAssets";
import { resolveAsset } from "@/features/assets/services/asset-resolver";
import { ResolvedAssetImage } from "@/features/assets/components/ResolvedAssetImage";
import {
  EditableText,
  EditableLinkText,
} from "@/features/inline-editing/components/EditableText";
import type { BaseSection } from "@/types/section";
import type { HeaderSectionProps } from "@/types/section";

export function HeaderSection({ section }: { section: BaseSection }) {
  const props = section.props as unknown as HeaderSectionProps;
  const assets = useSectionAssets();

  // Safety: ensure render-critical fields exist
  const logoText = typeof props.logoText === "string" ? props.logoText : "Brand";
  const navLinks = Array.isArray(props.navLinks) ? props.navLinks : [];
  const ctaText = typeof props.ctaText === "string" ? props.ctaText : null;

  // Resolve logo image
  const logo = resolveAsset(props.logoImage, assets);
  const showLogoImage = logo.src && !logo.missing;

  return (
    <header
      style={{
        padding: "1rem 0",
        borderBottom: "1px solid var(--border, #e5e5e5)",
      }}
    >
      <div
        style={{
          maxWidth: "1120px",
          margin: "0 auto",
          padding: "0 2rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* Logo — image takes precedence over text */}
        {showLogoImage ? (
          <ResolvedAssetImage
            src={logo.src}
            alt={logo.alt}
            fit="contain"
            width="auto"
            maxHeight="2.5rem"
            style={{ flexShrink: 0 }}
            fallback={<span style={{ fontWeight: 700, fontSize: "1.25rem", color: "var(--foreground, #0a0a0a)" }}>{logoText}</span>}
          />
        ) : (
          <EditableText
            section={section}
            fieldId="header.logoText"
            value={logoText}
            as="span"
            style={{
              fontWeight: 700,
              fontSize: "1.25rem",
              color: "var(--foreground, #0a0a0a)",
            }}
          />
        )}

        {/* Nav links */}
        <nav style={{ display: "flex", gap: "1.5rem", alignItems: "center" }}>
          {navLinks.map((link, idx) => (
            <EditableLinkText
              key={typeof link.text === "string" ? link.text : `nav-${idx}`}
              section={section}
              fieldId="header.navLinks.text"
              index={idx}
              value={typeof link.text === "string" ? link.text : "Link"}
              style={{
                fontSize: "0.875rem",
                color: "var(--muted-foreground, #737373)",
                cursor: "default",
                transition: "color 200ms",
              }}
              onMouseEnter={(e) => {
                (e.target as HTMLElement).style.color =
                  "var(--foreground, #0a0a0a)";
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLElement).style.color =
                  "var(--muted-foreground, #737373)";
              }}
            />
          ))}

          {ctaText && (
            <EditableText
              section={section}
              fieldId="header.ctaText"
              value={ctaText}
              as="span"
              style={{
                fontSize: "0.875rem",
                fontWeight: 600,
                padding: "0.5rem 1rem",
                borderRadius: "0.5rem",
                background: "var(--primary, #7c5cfc)",
                color: "var(--primary-foreground, #ffffff)",
                cursor: "default",
              }}
            />
          )}
        </nav>
      </div>
    </header>
  );
}
