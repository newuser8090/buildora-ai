"use client";

import { useState } from "react";
import {
  EditableHeading,
  EditableText,
} from "@/features/inline-editing/components/EditableText";
import { resolveSectionPadding } from "@/features/editor/utils/section-styles";
import type { BaseSection } from "@/types/section";
import type { FaqSectionProps } from "@/types/section";

export function FaqSection({ section }: { section: BaseSection }) {
  const props = section.props as unknown as FaqSectionProps;
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  // Safety: ensure render-critical fields exist
  const title = typeof props.title === "string" ? props.title : "FAQ";
  const items = Array.isArray(props.items) ? props.items : [];

  return (
    <section
      style={{
        padding: resolveSectionPadding(section, "5rem 0"),
        background: "var(--muted, #f5f5f5)",
      }}
    >
      <div
        style={{
          maxWidth: "720px",
          margin: "0 auto",
          padding: "0 2rem",
          textAlign: "center",
        }}
      >
        <EditableHeading
          section={section}
          fieldId="faq.title"
          value={title}
          as="h2"
          style={{
            fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
            fontWeight: 700,
            color: "var(--foreground, #0a0a0a)",
            marginBottom: "3rem",
          }}
        />

        <div style={{ textAlign: "left" }}>
          {items.map((item, i) => {
            const question = typeof item.question === "string" ? item.question : "";
            const answer = typeof item.answer === "string" ? item.answer : "";

            return (
              <div
                key={i}
                style={{
                  borderBottom: "1px solid var(--border, #e5e5e5)",
                  padding: "1.25rem 0",
                }}
              >
                <button
                  onClick={() => setOpenIndex(openIndex === i ? null : i)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    width: "100%",
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    color: "var(--foreground, #0a0a0a)",
                    fontWeight: 600,
                    fontSize: "1rem",
                    textAlign: "left",
                  }}
                >
                  <EditableText
                    section={section}
                    fieldId="faq.question"
                    index={i}
                    value={question}
                    as="span"
                  />
                  <span
                    style={{
                      transition: "transform 200ms",
                      transform:
                        openIndex === i ? "rotate(180deg)" : "rotate(0deg)",
                      fontSize: "0.875rem",
                      color: "var(--muted-foreground, #737373)",
                      flexShrink: 0,
                      marginLeft: "1rem",
                    }}
                  >
                    ▼
                  </span>
                </button>

                {openIndex === i && answer && (
                  <EditableText
                    section={section}
                    fieldId="faq.answer"
                    index={i}
                    value={answer}
                    as="p"
                    style={{
                      marginTop: "1rem",
                      fontSize: "0.9375rem",
                      lineHeight: 1.7,
                      color: "var(--muted-foreground, #737373)",
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {items.length === 0 && (
          <p style={{ fontSize: "0.875rem", color: "var(--muted-foreground, #737373)" }}>
            No FAQ items available.
          </p>
        )}
      </div>
    </section>
  );
}
