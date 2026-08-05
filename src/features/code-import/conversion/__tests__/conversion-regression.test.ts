// ---------------------------------------------------------------------------
// Conversion regression + snapshot tests (Phase P2)
//
// Full P1 → P2 pipeline runs over representative page snippets. Outputs are
// fully deterministic (counter-based id factories only), so snapshots are
// stable across runs and machines.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";

import { validateTree } from "../../../blocks/engine/nesting-rules";
import { convertSource } from "./test-utils";

const NAVBAR_HTML = `
<header class="flex items-center justify-between px-6 py-4">
  <span class="font-bold text-xl">Acme</span>
  <nav class="flex gap-6">
    <a href="/features">Features</a>
    <a href="/pricing">Pricing</a>
    <a href="/about">About</a>
  </nav>
  <button class="btn">Sign in</button>
</header>`;

const PRICING_HTML = `
<section class="pricing-section py-16">
  <h2 class="text-center text-3xl font-bold">Simple pricing</h2>
  <div class="grid grid-cols-3 gap-6 mt-8">
    <div class="pricing-card p-6 shadow-md">
      <h3>Starter</h3>
      <p>$9</p>
      <p>per month</p>
      <button>Choose plan</button>
    </div>
    <div class="pricing-card p-6 shadow-md">
      <h3>Pro</h3>
      <p>$29</p>
      <p>per month</p>
      <button>Choose plan</button>
    </div>
    <div class="pricing-card p-6 shadow-md">
      <h3>Team</h3>
      <p>$99</p>
      <p>per month</p>
      <button>Choose plan</button>
    </div>
  </div>
</section>`;

const FAQ_HTML = `
<section class="faq-section py-16">
  <h2 class="text-center text-3xl font-bold">FAQ</h2>
  <div class="max-w-2xl mx-auto mt-8 space-y-4">
    <div class="faq-item">
      <h3>What is included?</h3>
      <p>Everything you need to launch.</p>
    </div>
    <div class="faq-item">
      <h3>Can I cancel?</h3>
      <p>Yes, anytime.</p>
    </div>
  </div>
</section>`;

const CONTACT_HTML = `
<section class="contact-section py-16">
  <h2>Contact us</h2>
  <form class="flex flex-col gap-4 max-w-md">
    <label>Name</label>
    <input type="text" placeholder="Jane Doe">
    <label>Email</label>
    <input type="email" placeholder="jane@example.com">
    <textarea placeholder="Your message"></textarea>
    <button type="submit" class="btn">Send message</button>
  </form>
</section>`;

describe("regression: representative pages stay valid and convertible", () => {
  const cases: Array<{ name: string; source: string }> = [
    { name: "navbar", source: NAVBAR_HTML },
    { name: "pricing", source: PRICING_HTML },
    { name: "faq", source: FAQ_HTML },
    { name: "contact form", source: CONTACT_HTML },
  ];

  for (const testCase of cases) {
    it(`converts the ${testCase.name} snippet into a valid tree`, () => {
      const outcome = convertSource(testCase.source);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      const { tree, report } = outcome.value;
      expect(validateTree(tree).valid).toBe(true);
      expect(report.convertedBlockCount).toBeGreaterThan(0);
      expect(report.confidence).toBeGreaterThan(0);
      // Every block must be a registered type.
      for (const node of Object.values(tree.nodes)) {
        expect(["container", "row", "column", "grid", "stack", "divider", "spacer",
          "heading", "paragraph", "button", "image", "video", "icon", "badge",
          "form", "input", "textarea", "checkbox", "tabs", "accordion",
          "card", "pricing-card", "feature-card", "review-card", "faq-item",
          "team-member", "navbar", "footer", "menu"]).toContain(node.type);
      }
    });
  }
});

describe("snapshots (deterministic conversion output)", () => {
  it("matches the hero snapshot", () => {
    const outcome = convertSource(
      '<section class="hero flex items-center gap-8 py-20 px-6">' +
        '<div class="max-w-xl">' +
        '<h1 class="text-4xl font-bold">Build something great</h1>' +
        '<p class="mt-4 text-lg">A description that tells visitors what you do.</p>' +
        '<a class="btn btn-primary" href="/start">Get started</a>' +
        "</div></section>",
    );
    expect(outcome).toMatchSnapshot();
  });

  it("matches the pricing grid snapshot", () => {
    expect(convertSource(PRICING_HTML)).toMatchSnapshot();
  });

  it("matches the contact form snapshot", () => {
    expect(convertSource(CONTACT_HTML)).toMatchSnapshot();
  });

  it("matches the JSX component snapshot", () => {
    const source =
      "export default function Card({ title }) { return (" +
      '<div className="card p-4"><h3 className="font-bold">{title}</h3>' +
      "<p>Static description</p></div>); }";
    expect(convertSource(source)).toMatchSnapshot();
  });
});
