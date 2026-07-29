"use client";

import type { BaseSection } from "@/types/section";
import type { FooterSectionProps } from "@/types/section";

export function FooterSection({ section }: { section: BaseSection }) {
  const props = section.props as unknown as FooterSectionProps;

  // Safety: ensure render-critical fields exist
  const text = typeof props.text === "string" ? props.text : "© All rights reserved.";
  const links = Array.isArray(props.links) ? props.links : [];

  return (
    <footer
      style={{
        padding: "2rem 0",
        borderTop: "1px solid var(--border, #e5e5e5)",
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
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <span
          style={{
            fontSize: "0.875rem",
            color: "var(--muted-foreground, #737373)",
          }}
        >
          {text}
        </span>

        {links.length > 0 && (
          <nav style={{ display: "flex", gap: "1.5rem" }}>
            {links.map((link, idx) => (
              <span
                key={typeof link.text === "string" ? link.text : `link-${idx}`}
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
              >
                {typeof link.text === "string" ? link.text : "Link"}
              </span>
            ))}
          </nav>
        )}
      </div>
    </footer>
  );
}
