// ---------------------------------------------------------------------------
// FAQ section definition
// ---------------------------------------------------------------------------

import type { SectionLibraryDefinition } from "../types";

export const faqDefinition: SectionLibraryDefinition<"faq"> = {
  type: "faq",
  name: "FAQ",
  description:
    "Answer the most common questions with an accordion of Q&A pairs.",
  category: "content",
  keywords: ["faq", "questions", "answers", "help", "support", "accordion"],
  iconKey: "help-circle",
  recommendedPosition: "middle",
  sortOrder: 50,
  createProps: () => ({
    title: "Frequently asked questions",
    items: [
      {
        question: "How do I get started?",
        answer:
          "Create a project, pick a template or describe what you want, and the editor generates a polished page you can customize in minutes.",
      },
      {
        question: "Can I change my plan later?",
        answer:
          "Yes. Upgrade or downgrade at any time from your account settings — changes are applied immediately.",
      },
      {
        question: "Is my data secure?",
        answer:
          "Absolutely. All data is encrypted in transit and at rest, and we run automatic backups so you never lose work.",
      },
      {
        question: "Do you offer support?",
        answer:
          "Every plan includes access to our help center and email support. Pro and Enterprise plans add priority support.",
      },
    ],
  }),
  createStyles: () => ({}),
};
