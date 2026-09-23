"use client";

import { useEffect } from "react";
import { useSectionAssets } from "@/features/editor/hooks/useSectionAssets";
import { resolveAsset } from "@/features/assets/services/asset-resolver";
import { ResolvedAssetImage } from "@/features/assets/components/ResolvedAssetImage";
import {
  EditableText,
  EditableLinkText,
} from "@/features/inline-editing/components/EditableText";
import { useInlineEditPageId } from "@/features/inline-editing/context/InlineEditPageContext";
import { resolveSectionPadding } from "@/features/editor/utils/section-styles";
import { useCartStore, cartItemCount } from "@/features/commerce/cart-store";
import type { BaseSection } from "@/types/section";
import type { HeaderSectionProps } from "@/types/section";

export function HeaderSection({ section }: { section: BaseSection }) {
  const props = section.props as unknown as HeaderSectionProps;
  const assets = useSectionAssets();

  // Stage 3 — visitor (interactive) surfaces see NO pageId; the editor canvas
  // always provides one. Commerce affordances render only in visitor mode so
  // editing can never accidentally trigger cart mutations.
  const pageId = useInlineEditPageId();
  const isVisitor = pageId === null;

  const itemCount = useCartStore((s) => cartItemCount(s.items));
  const openCart = useCartStore((s) => s.openCart);
  const setWhatsappNumber = useCartStore((s) => s.setWhatsappNumber);

  // Publish the business WhatsApp number to the cart runtime whenever the
  // header (which owns it) mounts or changes. Empty string = no checkout.
  useEffect(() => {
    if (!isVisitor) return;
    setWhatsappNumber(
      typeof props.whatsappNumber === "string" ? props.whatsappNumber : "",
    );
    return () => {
      if (isVisitor) setWhatsappNumber("");
    };
  }, [isVisitor, props.whatsappNumber, setWhatsappNumber]);

  // The cart trigger is any nav link literally labelled "Cart" (the
  // template-provided zero-code convention; no new props to learn).
  const hasCartTrigger =
    isVisitor &&
    navLinks(props).some((l) => typeof l.text === "string" && l.text.trim().toLowerCase() === "cart");

  // Safety: ensure render-critical fields exist
  const logoText = typeof props.logoText === "string" ? props.logoText : "Brand";
  const navLinksList = navLinks(props);
  const ctaText = typeof props.ctaText === "string" ? props.ctaText : null;

  // Resolve logo image
  const logo = resolveAsset(props.logoImage, assets);
  const showLogoImage = logo.src && !logo.missing;

  return (
    <header
      style={{
        padding: resolveSectionPadding(section, "1rem 0"),
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
          {navLinksList.map((link, idx) => {
            const label = typeof link.text === "string" ? link.text : "Link";
            const isCartLink = hasCartTrigger && label.trim().toLowerCase() === "cart";
            if (isCartLink) {
              // Stage 3 — live cart trigger with an item-count badge.
              return (
                <button
                  key={`cart-${idx}`}
                  type="button"
                  data-testid="header-cart-trigger"
                  aria-label={`Open basket, ${itemCount} item${itemCount !== 1 ? "s" : ""}`}
                  onClick={() => openCart()}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    color: "var(--foreground, #0a0a0a)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    position: "relative",
                  }}
                >
                  🛒
                  {label.trim().length > 0 && label.trim().toLowerCase() !== "🛒" && (
                    <span>{label.trim()}</span>
                  )}
                  {itemCount > 0 && (
                    <span
                      data-testid="header-cart-badge"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        minWidth: "1.1rem",
                        height: "1.1rem",
                        padding: "0 0.25rem",
                        borderRadius: "999px",
                        background: "var(--primary, #7c5cfc)",
                        color: "var(--primary-foreground, #ffffff)",
                        fontSize: "0.65rem",
                        fontWeight: 700,
                        lineHeight: 1,
                      }}
                    >
                      {itemCount}
                    </span>
                  )}
                </button>
              );
            }
            return (
              <EditableLinkText
                key={typeof link.text === "string" ? link.text : `nav-${idx}`}
                section={section}
                fieldId="header.navLinks.text"
                index={idx}
                value={label}
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
            );
          })}

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

/** Safe nav-links accessor (props may be malformed at render time). */
function navLinks(props: HeaderSectionProps): HeaderSectionProps["navLinks"] {
  return Array.isArray(props.navLinks) ? props.navLinks : [];
}
