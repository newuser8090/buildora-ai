import type { OutputFile } from "../../pipeline/types";

// ---------------------------------------------------------------------------
// FAQ section generator
//
// Produces a reusable component with accordion-displayed Q&A items.
// React handles HTML escaping at runtime.
// ---------------------------------------------------------------------------

export function generateFaqComponent(): OutputFile {
  const content = `"use client";

import { useState } from "react";

export interface FaqItem {
  question: string;
  answer: string;
}

export interface FaqProps {
  title: string;
  items: FaqItem[];
}

export function Faq({ title, items }: FaqProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section className="bg-muted py-20">
      <div className="mx-auto max-w-3xl px-8 text-center">
        <h2 className="mb-12 text-[clamp(1.5rem,3vw,2.25rem)] font-bold text-foreground">
          {title}
        </h2>
        <div className="text-left">
          {items.map((item, i) => (
            <div key={i} className="border-b border-border py-5">
              <button
                type="button"
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="flex w-full items-center justify-between bg-transparent text-left text-base font-semibold text-foreground"
              >
                {item.question}
                <span
                  className={"ml-4 flex-shrink-0 text-sm text-muted-foreground transition-transform " + (openIndex === i ? "rotate-180" : "")}
                >
                  \u25BC
                </span>
              </button>
              {openIndex === i && item.answer && (
                <p className="mt-4 text-[0.9375rem] leading-relaxed text-muted-foreground">
                  {item.answer}
                </p>
              )}
            </div>
          ))}
        </div>
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground">No FAQ items available.</p>
        )}
      </div>
    </section>
  );
}
`;

  return { path: "components/sections/faq.tsx", content };
}
