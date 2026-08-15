// ---------------------------------------------------------------------------
// Site templates — deterministic multi-page bundles per supported website type
// (Phase P22-I)
//
// Each site defines 4–5 pages (2–6 page bound), every page carrying a header
// with cross-page navigation and a footer. Only existing valid section types
// are used (header/hero/features/pricing/faq/cta/footer), so generated pages
// render through the existing section registry and export pipeline unchanged.
//
// Determinism guarantees: no random ids, no timestamps, no runtime-dependent
// output. Brand/text are injected by the caller (rule-based analyzer or the
// Gemini completion path).
// ---------------------------------------------------------------------------

import type { PlannedPage, WebsiteType } from "../types/generation-plan";

// ---------------------------------------------------------------------------
// Section spec — a planned section without an order (order assigned per page)
// ---------------------------------------------------------------------------

interface SectionSpec {
  type: string;
  props: Record<string, unknown>;
}

function sec(type: string, props: Record<string, unknown>): SectionSpec {
  return { type, props };
}

// ---------------------------------------------------------------------------
// Link helpers
// ---------------------------------------------------------------------------

interface NavLink {
  text: string;
  href: string;
}

function navLinks(entries: Array<[string, string]>): NavLink[] {
  return entries.map(([text, href]) => ({ text, href }));
}

function featureItem(
  title: string,
  description: string,
  icon = "Zap",
): { title: string; description: string; icon: string } {
  return { title, description, icon };
}

function plan(
  name: string,
  price: string,
  cta: string,
  features: string[],
  description?: string,
  highlighted?: boolean,
): Record<string, unknown> {
  return {
    name,
    price,
    ...(description ? { description } : {}),
    features,
    cta,
    ...(highlighted ? { highlighted: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Page shell — header (with cross-page nav) + middle sections + footer
// ---------------------------------------------------------------------------

function buildSitePage(
  brand: string,
  nav: Array<[string, string]>,
  pageTitle: string,
  slug: string,
  middle: SectionSpec[],
  footerLinks: Array<[string, string]>,
  ctaText?: string,
): PlannedPage {
  const header: SectionSpec = {
    type: "header",
    props: {
      logoText: brand,
      navLinks: navLinks(nav),
      ...(ctaText ? { ctaText } : {}),
    },
  };
  const footer: SectionSpec = {
    type: "footer",
    props: {
      text: `© 2026 ${brand}. All rights reserved.`,
      links: navLinks(footerLinks),
    },
  };
  const sections = [header, ...middle, footer];
  return {
    title: pageTitle,
    slug,
    sections: sections.map((s, i) => ({ ...s, order: i + 1 })),
  };
}

// ---------------------------------------------------------------------------
// Per-type navigation + footer link definitions
// ---------------------------------------------------------------------------

type NavDefinition = Array<[string, string]>;

const NAV: Record<WebsiteType, NavDefinition> = {
  saas: [
    ["Home", "/"],
    ["Features", "/features"],
    ["Pricing", "/pricing"],
    ["About", "/about"],
    ["Contact", "/contact"],
  ],
  ecommerce: [
    ["Home", "/"],
    ["Shop", "/shop"],
    ["About", "/about"],
    ["Contact", "/contact"],
  ],
  restaurant: [
    ["Home", "/"],
    ["Menu", "/menu"],
    ["About", "/about"],
    ["Contact", "/contact"],
  ],
  portfolio: [
    ["Home", "/"],
    ["Projects", "/projects"],
    ["About", "/about"],
    ["Contact", "/contact"],
  ],
  agency: [
    ["Home", "/"],
    ["Services", "/services"],
    ["About", "/about"],
    ["Contact", "/contact"],
  ],
};

const FOOTER_LINKS: Record<WebsiteType, Array<[string, string]>> = {
  saas: [
    ["Features", "/features"],
    ["Pricing", "/pricing"],
    ["About", "/about"],
    ["Contact", "/contact"],
  ],
  ecommerce: [
    ["Shop", "/shop"],
    ["About", "/about"],
    ["Contact", "/contact"],
  ],
  restaurant: [
    ["Menu", "/menu"],
    ["About", "/about"],
    ["Contact", "/contact"],
  ],
  portfolio: [
    ["Projects", "/projects"],
    ["About", "/about"],
    ["Contact", "/contact"],
  ],
  agency: [
    ["Services", "/services"],
    ["About", "/about"],
    ["Contact", "/contact"],
  ],
};

// ---------------------------------------------------------------------------
// SaaS
// ---------------------------------------------------------------------------

function saasSite(brand: string): PlannedPage[] {
  const nav = NAV.saas;
  const footer = FOOTER_LINKS.saas;

  const home = buildSitePage(
    brand,
    nav,
    "Home",
    "/",
    [
      sec("hero", {
        headline: `Build better with ${brand}`,
        subheadline: `${brand} helps teams ship faster with powerful tools and seamless integrations. Try it free today.`,
        primaryCta: { text: "Start Free Trial", href: "#" },
        secondaryCta: { text: "See how it works →", href: "#features" },
      }),
      sec("features", {
        title: "Everything you need to ship fast",
        subtitle: "Powerful features designed for modern product teams.",
        features: [
          featureItem("Real-time Collaboration", `Work together with your team in real time. ${brand} keeps everyone in sync.`, "Zap"),
          featureItem("Smart Automation", "Automate repetitive tasks and focus on what matters most.", "Layers"),
          featureItem("Advanced Analytics", "Get deep insights into your data with beautiful dashboards.", "BarChart"),
          featureItem("Cloud Native", "Deploy anywhere with our global infrastructure.", "Globe"),
          featureItem("Enterprise Security", "Bank-grade encryption and compliance built in.", "Shield"),
          featureItem("API First", "Extend and integrate with our powerful API.", "Star"),
        ],
      }),
      sec("cta", {
        headline: `Ready to get started with ${brand}?`,
        subheadline: "Join thousands of happy customers. Start your free trial today.",
        ctaText: "Start Free Trial",
        ctaHref: "#",
      }),
    ],
    footer,
    "Get Started",
  );

  const features = buildSitePage(
    brand,
    nav,
    "Features",
    "/features",
    [
      sec("features", {
        title: "Everything you need to move fast",
        subtitle: `A closer look at the tools inside every ${brand} plan.`,
        features: [
          featureItem("Lightning Speed", "Pages load instantly on a global edge network.", "Zap"),
          featureItem("Real-time Collaboration", "Co-edit with your team with zero conflicts.", "Layers"),
          featureItem("Deep Analytics", "Understand usage with clear, live dashboards.", "BarChart"),
          featureItem("Bank-grade Security", "SOC 2 compliant infrastructure, encrypted at rest.", "Shield"),
        ],
      }),
      sec("cta", {
        headline: "See every feature in action",
        subheadline: `Start a free trial of ${brand} today — no credit card required.`,
        ctaText: "Start Free Trial",
        ctaHref: "#",
      }),
    ],
    footer,
  );

  const pricing = buildSitePage(
    brand,
    nav,
    "Pricing",
    "/pricing",
    [
      sec("pricing", {
        title: "Simple, transparent pricing",
        subtitle: "No hidden fees. Upgrade anytime.",
        plans: [
          plan("Starter", "$0", "Get Started", ["1 project", "Basic features", "Community support"], "Perfect for getting started."),
          plan("Pro", "$29", "Start Free Trial", ["Unlimited projects", "Advanced features", "Priority support", "Custom domains"], "For professionals and small teams.", true),
          plan("Enterprise", "$99", "Contact Sales", ["Everything in Pro", "Dedicated support", "Custom integrations", "SLA"], "For large organizations."),
        ],
      }),
      sec("faq", {
        title: "Frequently asked questions",
        items: [
          { question: "How does the free trial work?", answer: `You can try ${brand} free for 14 days with no credit card required. Cancel anytime.` },
          { question: "Can I upgrade my plan later?", answer: "Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately." },
          { question: "Do you offer custom plans?", answer: "Yes, contact our sales team for custom enterprise plans tailored to your needs." },
        ],
      }),
      sec("cta", {
        headline: "Choose the plan that fits",
        subheadline: "Start free and upgrade when you're ready.",
        ctaText: "Start Free Trial",
        ctaHref: "#",
      }),
    ],
    footer,
  );

  const about = buildSitePage(
    brand,
    nav,
    "About",
    "/about",
    [
      sec("features", {
        title: `About ${brand}`,
        subtitle: "We're on a mission to make software teams unstoppable.",
        features: [
          featureItem("Our mission", "Give every team the tools to plan, build, and launch with confidence.", "Star"),
          featureItem("Our people", `A remote-first team of builders across the world, obsessed with craft.`, "Layers"),
          featureItem("Our values", "Customer obsession, radical transparency, and shipping every day.", "Shield"),
        ],
      }),
      sec("cta", {
        headline: "Want to join the team?",
        subheadline: `We're always looking for great people. Reach out to ${brand}.`,
        ctaText: "Contact Us",
        ctaHref: "/contact",
      }),
    ],
    footer,
  );

  const contact = buildSitePage(
    brand,
    nav,
    "Contact",
    "/contact",
    [
      sec("cta", {
        headline: `Get in touch with ${brand}`,
        subheadline: "Questions, sales, or support — we'd love to hear from you.",
        ctaText: "Email Us",
        ctaHref: "mailto:hello@example.com",
      }),
    ],
    footer,
  );

  return [home, features, pricing, about, contact];
}

// ---------------------------------------------------------------------------
// E-commerce
// ---------------------------------------------------------------------------

function ecommerceSite(brand: string): PlannedPage[] {
  const nav = NAV.ecommerce;
  const footer = FOOTER_LINKS.ecommerce;

  const home = buildSitePage(
    brand,
    nav,
    "Home",
    "/",
    [
      sec("hero", {
        headline: `Discover the ${brand} collection`,
        subheadline: "Curated products for modern living. Free shipping on all orders over $50.",
        primaryCta: { text: "Shop Now", href: "/shop" },
        secondaryCta: { text: "Explore Categories →", href: "#categories" },
      }),
      sec("features", {
        title: "Why shop with us",
        subtitle: "We're committed to the best shopping experience.",
        features: [
          featureItem("Free Shipping", "Free shipping on all orders over $50. Fast and reliable delivery.", "Zap"),
          featureItem("Easy Returns", "30-day hassle-free return policy. No questions asked.", "Heart"),
          featureItem("Secure Checkout", "Bank-grade encryption protects your payment information.", "Shield"),
          featureItem("24/7 Support", "Our support team is here to help anytime, day or night.", "Star"),
        ],
      }),
      sec("pricing", {
        title: "Featured products",
        subtitle: "Our most popular items this season.",
        plans: [
          plan("Essentials Pack", "$29", "Add to Cart", ["Premium quality", "Eco-friendly", "1-year warranty"], "Everyday essentials at great value."),
          plan("Signature Bundle", "$59", "Add to Cart", ["Everything in Essentials", "Bonus items", "Gift wrapping", "Free shipping"], "Our best-selling collection.", true),
          plan("Premium Set", "$99", "Add to Cart", ["Everything in Signature", "Limited edition", "Priority delivery", "Exclusive access"], "The ultimate experience."),
        ],
      }),
      sec("cta", {
        headline: "Join the community",
        subheadline: "Sign up for exclusive offers and early access to new collections.",
        ctaText: "Subscribe",
        ctaHref: "#",
      }),
    ],
    footer,
    "Cart (0)",
  );

  const shop = buildSitePage(
    brand,
    nav,
    "Shop",
    "/shop",
    [
      sec("features", {
        title: "Shop by category",
        subtitle: "Everything you need, organized your way.",
        features: [
          featureItem("Home & Living", "Minimal pieces designed to last.", "Home"),
          featureItem("Apparel", "Comfortable, timeless essentials.", "Layers"),
          featureItem("Accessories", "The finishing touches.", "Star"),
        ],
      }),
      sec("pricing", {
        title: "Best sellers",
        subtitle: "The products everyone is talking about.",
        plans: [
          plan("Classic Tee", "$19", "Add to Cart", ["Premium cotton", "Unisex fit"], "The everyday essential."),
          plan("Desk Set", "$45", "Add to Cart", ["Everything you need", "Great gift"], "A workspace refresh.", true),
        ],
      }),
      sec("cta", {
        headline: "Can't decide?",
        subheadline: "Browse the full collection or ask our team for a recommendation.",
        ctaText: "Contact Us",
        ctaHref: "/contact",
      }),
    ],
    footer,
  );

  const about = buildSitePage(
    brand,
    nav,
    "About",
    "/about",
    [
      sec("features", {
        title: `About ${brand}`,
        subtitle: "Thoughtful products, honestly made.",
        features: [
          featureItem("Our story", `What started as a small idea became ${brand} — a brand built on quality and care.`, "Star"),
          featureItem("Our materials", "Responsibly sourced materials and durable design.", "Layers"),
          featureItem("Our promise", "If you're not happy, we'll make it right.", "Heart"),
        ],
      }),
      sec("cta", {
        headline: "Learn more about us",
        subheadline: "Follow our journey and meet the people behind the products.",
        ctaText: "Get in Touch",
        ctaHref: "/contact",
      }),
    ],
    footer,
  );

  const contact = buildSitePage(
    brand,
    nav,
    "Contact",
    "/contact",
    [
      sec("cta", {
        headline: `Talk to the ${brand} team`,
        subheadline: "Orders, questions, partnerships — we're here to help.",
        ctaText: "Email Us",
        ctaHref: "mailto:hello@example.com",
      }),
    ],
    footer,
  );

  return [home, shop, about, contact];
}

// ---------------------------------------------------------------------------
// Restaurant
// ---------------------------------------------------------------------------

function restaurantSite(brand: string): PlannedPage[] {
  const nav = NAV.restaurant;
  const footer = FOOTER_LINKS.restaurant;

  const home = buildSitePage(
    brand,
    nav,
    "Home",
    "/",
    [
      sec("hero", {
        headline: `Welcome to ${brand}`,
        subheadline: "Experience exceptional cuisine crafted with the finest ingredients. Every dish tells a story.",
        primaryCta: { text: "View Menu", href: "/menu" },
        secondaryCta: { text: "Make a Reservation →", href: "#reservations" },
      }),
      sec("features", {
        title: "Our menu",
        subtitle: "Carefully curated dishes for every palate.",
        features: [
          featureItem("Appetizers", "Start your meal with our chef's signature starters.", "Star"),
          featureItem("Main Courses", "Hearty mains crafted from locally sourced ingredients.", "Heart"),
          featureItem("Desserts", "Indulge in our handmade desserts and pastries.", "Sparkles"),
          featureItem("Wine Selection", "Curated wine pairings from the world's best vineyards.", "Star"),
        ],
      }),
      sec("cta", {
        headline: "Book your experience",
        subheadline: `Reserve a table at ${brand} for an unforgettable dining experience.`,
        ctaText: "Make a Reservation",
        ctaHref: "#",
      }),
    ],
    footer,
    "Reserve a Table",
  );

  const menu = buildSitePage(
    brand,
    nav,
    "Menu",
    "/menu",
    [
      sec("features", {
        title: "A menu for every season",
        subtitle: "Fresh ingredients, classic technique, and a little imagination.",
        features: [
          featureItem("Starters", "Light bites to begin your meal.", "Star"),
          featureItem("Mains", "Satisfying plates for every appetite.", "Heart"),
          featureItem("Sides", "Perfect complements to any dish.", "Layers"),
        ],
      }),
      sec("pricing", {
        title: "Signature dishes",
        subtitle: "The plates our guests keep coming back for.",
        plans: [
          plan("Chef's Tasting", "$65", "Reserve", ["Five courses", "Wine pairing available"], "A journey through the menu."),
          plan("Garden Feast", "$42", "Reserve", ["Plant-forward menu", "Seasonal produce"], "Our vegetarian showcase.", true),
        ],
      }),
      sec("cta", {
        headline: "Reserve a table",
        subheadline: "Walk-ins welcome, reservations recommended.",
        ctaText: "Book Now",
        ctaHref: "#",
      }),
    ],
    footer,
  );

  const about = buildSitePage(
    brand,
    nav,
    "About",
    "/about",
    [
      sec("features", {
        title: `The story of ${brand}`,
        subtitle: "A kitchen built on craft, community, and local ingredients.",
        features: [
          featureItem("Our kitchen", "A small team of chefs with a big love for flavor.", "Star"),
          featureItem("Our sourcing", "Local farms and producers, visited weekly.", "Globe"),
          featureItem("Our community", `We believe great food brings people together — and ${brand} is where that happens.`, "Heart"),
        ],
      }),
      sec("cta", {
        headline: "Join us for dinner",
        subheadline: "Come hungry. Leave happy.",
        ctaText: "Make a Reservation",
        ctaHref: "#",
      }),
    ],
    footer,
  );

  const contact = buildSitePage(
    brand,
    nav,
    "Contact",
    "/contact",
    [
      sec("cta", {
        headline: `Visit ${brand}`,
        subheadline: "Reservations, private events, and general questions.",
        ctaText: "Contact Us",
        ctaHref: "mailto:hello@example.com",
      }),
    ],
    footer,
  );

  return [home, menu, about, contact];
}

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

function portfolioSite(brand: string): PlannedPage[] {
  const nav = NAV.portfolio;
  const footer = FOOTER_LINKS.portfolio;

  const home = buildSitePage(
    brand,
    nav,
    "Home",
    "/",
    [
      sec("hero", {
        headline: `Hi, I'm ${brand}`,
        subheadline: "I design and build digital experiences that make an impact. Let's create something great together.",
        primaryCta: { text: "View my work", href: "/projects" },
        secondaryCta: { text: "Get in touch →", href: "/contact" },
      }),
      sec("features", {
        title: "Featured work",
        subtitle: "A selection of projects I've recently completed.",
        features: [
          featureItem("E-commerce Platform", "A modern shopping experience built with React and Node.js.", "Zap"),
          featureItem("SaaS Dashboard", "Analytics dashboard serving 10k+ daily active users.", "BarChart"),
          featureItem("Mobile App", "Cross-platform mobile application with 100k+ downloads.", "Globe"),
          featureItem("Brand Identity", "Complete brand redesign for a tech startup.", "Layers"),
        ],
      }),
      sec("cta", {
        headline: "Let's work together",
        subheadline: "I'm always open to new projects and collaborations.",
        ctaText: "Get in touch",
        ctaHref: "/contact",
      }),
    ],
    footer,
  );

  const projects = buildSitePage(
    brand,
    nav,
    "Projects",
    "/projects",
    [
      sec("features", {
        title: "Selected projects",
        subtitle: "A closer look at the work I'm proudest of.",
        features: [
          featureItem("Fintech App", "A mobile-first banking experience for a growing fintech.", "Zap"),
          featureItem("Design System", "A scalable design system adopted across 12 product teams.", "Layers"),
          featureItem("Brand & Web", "Identity and website for a climate-tech startup.", "Globe"),
        ],
      }),
      sec("cta", {
        headline: "Like what you see?",
        subheadline: "Let's build something great together.",
        ctaText: "Start a Project",
        ctaHref: "/contact",
      }),
    ],
    footer,
  );

  const about = buildSitePage(
    brand,
    nav,
    "About",
    "/about",
    [
      sec("features", {
        title: `About ${brand}`,
        subtitle: "Designer, builder, and lifelong learner.",
        features: [
          featureItem("Experience", "8+ years designing and shipping digital products.", "Star"),
          featureItem("Approach", "User-centered, detail-obsessed, and collaborative.", "Layers"),
          featureItem("Beyond work", "Coffee, cameras, and long walks.", "Heart"),
        ],
      }),
      sec("cta", {
        headline: "Want to know more?",
        subheadline: "I'd love to hear about your project.",
        ctaText: "Say hello",
        ctaHref: "/contact",
      }),
    ],
    footer,
  );

  const contact = buildSitePage(
    brand,
    nav,
    "Contact",
    "/contact",
    [
      sec("cta", {
        headline: "Say hello",
        subheadline: "Have a project in mind? Let's talk.",
        ctaText: "Email Me",
        ctaHref: "mailto:hello@example.com",
      }),
    ],
    footer,
  );

  return [home, projects, about, contact];
}

// ---------------------------------------------------------------------------
// Agency
// ---------------------------------------------------------------------------

function agencySite(brand: string): PlannedPage[] {
  const nav = NAV.agency;
  const footer = FOOTER_LINKS.agency;

  const home = buildSitePage(
    brand,
    nav,
    "Home",
    "/",
    [
      sec("hero", {
        headline: "We build brands that matter",
        subheadline: `${brand} is a full-service creative agency. We design, build, and grow digital products for ambitious companies.`,
        primaryCta: { text: "Our Work", href: "/services" },
        secondaryCta: { text: "Contact us →", href: "/contact" },
      }),
      sec("features", {
        title: "Our services",
        subtitle: "End-to-end solutions for your digital presence.",
        features: [
          featureItem("Brand Strategy", "We craft brand identities that resonate with your audience.", "Star"),
          featureItem("Web Development", "Custom websites and web applications built with modern tech.", "Zap"),
          featureItem("UI/UX Design", "User-centered design that drives engagement and conversions.", "Layers"),
          featureItem("Digital Marketing", "Data-driven marketing strategies to grow your reach.", "BarChart"),
        ],
      }),
      sec("cta", {
        headline: "Ready to start your project?",
        subheadline: `Let's talk about how ${brand} can help bring your vision to life.`,
        ctaText: "Get in Touch",
        ctaHref: "/contact",
      }),
    ],
    footer,
    "Start a Project",
  );

  const services = buildSitePage(
    brand,
    nav,
    "Services",
    "/services",
    [
      sec("features", {
        title: "What we do",
        subtitle: "Deep expertise across the entire product lifecycle.",
        features: [
          featureItem("Strategy & Research", "Discover what your customers actually need.", "BarChart"),
          featureItem("Design", "Interfaces people love to use.", "Layers"),
          featureItem("Engineering", "Scalable products built to last.", "Zap"),
          featureItem("Growth", "Marketing and analytics that move the needle.", "Globe"),
        ],
      }),
      sec("faq", {
        title: "How we work",
        items: [
          { question: "What is your process?", answer: "We follow a proven 4-phase process: Discovery, Design, Development, and Launch." },
          { question: "How long does a typical project take?", answer: "Most projects take 4-8 weeks depending on scope and complexity." },
          { question: "Do you offer ongoing support?", answer: "Yes, we offer maintenance and support packages for all our projects." },
        ],
      }),
      sec("cta", {
        headline: "Tell us about your project",
        subheadline: "Free discovery call, no strings attached.",
        ctaText: "Book a Call",
        ctaHref: "/contact",
      }),
    ],
    footer,
  );

  const about = buildSitePage(
    brand,
    nav,
    "About",
    "/about",
    [
      sec("features", {
        title: `About ${brand}`,
        subtitle: "A team of strategists, designers, and engineers.",
        features: [
          featureItem("Our story", `What began as two friends and a laptop is now ${brand}, a studio of 15 specialists.`, "Star"),
          featureItem("Our craft", "We sweat the details so your brand shines.", "Layers"),
          featureItem("Our clients", "Ambitious companies from seed-stage startups to global brands.", "Globe"),
        ],
      }),
      sec("cta", {
        headline: "Work with us",
        subheadline: "Let's build something ambitious together.",
        ctaText: "Get in Touch",
        ctaHref: "/contact",
      }),
    ],
    footer,
  );

  const contact = buildSitePage(
    brand,
    nav,
    "Contact",
    "/contact",
    [
      sec("cta", {
        headline: `Let's talk about your project`,
        subheadline: "Tell us about your goals and we'll get back within one business day.",
        ctaText: "Email Us",
        ctaHref: "mailto:hello@example.com",
      }),
    ],
    footer,
  );

  return [home, services, about, contact];
}

// ---------------------------------------------------------------------------
// Template map
// ---------------------------------------------------------------------------

const SITE_TEMPLATES: Record<WebsiteType, (brand: string) => PlannedPage[]> = {
  saas: saasSite,
  ecommerce: ecommerceSite,
  restaurant: restaurantSite,
  portfolio: portfolioSite,
  agency: agencySite,
};

/**
 * Deterministic multi-page site template for a website type. Every page is
 * schema-valid by construction (existing section vocabulary + cross-page nav).
 * Never returns more than the P22-I site bound (6 pages).
 */
export function getSiteTemplatePages(
  type: WebsiteType,
  brand: string,
): PlannedPage[] {
  const generator = SITE_TEMPLATES[type] ?? SITE_TEMPLATES.saas;
  return generator(brand);
}
