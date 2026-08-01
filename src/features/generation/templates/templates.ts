import type { WebsiteType, PlannedSection } from "../types/generation-plan";

// ---------------------------------------------------------------------------
// Templates — define ordered sections and default content per website type
// ---------------------------------------------------------------------------

function saasTemplate(brand: string): PlannedSection[] {
  return [
    {
      type: "header",
      order: 1,
      props: {
        logoText: brand,
        navLinks: [
          { text: "Features", href: "#features" },
          { text: "Pricing", href: "#pricing" },
          { text: "FAQ", href: "#faq" },
        ],
        ctaText: "Get Started",
      },
    },
    {
      type: "hero",
      order: 2,
      props: {
        headline: `Build better with ${brand}`,
        subheadline: `${brand} helps teams ship faster with powerful tools and seamless integrations. Try it free today.`,
        primaryCta: { text: "Start Free Trial", href: "#" },
        secondaryCta: { text: "See how it works →", href: "#" },
      },
    },
    {
      type: "features",
      order: 3,
      props: {
        title: "Everything you need to ship fast",
        subtitle: "Powerful features designed for modern product teams.",
        features: [
          { title: "Real-time Collaboration", description: `Work together with your team in real time. ${brand} keeps everyone in sync.`, icon: "Zap" },
          { title: "Smart Automation", description: "Automate repetitive tasks and focus on what matters most.", icon: "Layers" },
          { title: "Advanced Analytics", description: "Get deep insights into your data with beautiful dashboards.", icon: "BarChart" },
          { title: "Cloud Native", description: "Deploy anywhere with our global infrastructure.", icon: "Globe" },
          { title: "Enterprise Security", description: "Bank-grade encryption and compliance built in.", icon: "Shield" },
          { title: "API First", description: "Extend and integrate with our powerful API.", icon: "Star" },
        ],
      },
    },
    {
      type: "pricing",
      order: 4,
      props: {
        title: "Simple, transparent pricing",
        subtitle: "No hidden fees. Upgrade anytime.",
        plans: [
          { name: "Starter", price: "$0", description: "Perfect for getting started.", features: ["1 project", "Basic features", "Community support"], cta: "Get Started" },
          { name: "Pro", price: "$29", description: "For professionals and small teams.", features: ["Unlimited projects", "Advanced features", "Priority support", "Custom domains"], cta: "Start Free Trial", highlighted: true },
          { name: "Enterprise", price: "$99", description: "For large organizations.", features: ["Everything in Pro", "Dedicated support", "Custom integrations", "SLA"], cta: "Contact Sales" },
        ],
      },
    },
    {
      type: "faq",
      order: 5,
      props: {
        title: "Frequently asked questions",
        items: [
          { question: "How does the free trial work?", answer: `You can try ${brand} free for 14 days with no credit card required. Cancel anytime.` },
          { question: "Can I upgrade my plan later?", answer: "Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately." },
          { question: "Do you offer custom plans?", answer: "Yes, contact our sales team for custom enterprise plans tailored to your needs." },
          { question: "Is my data secure?", answer: "Absolutely. We use bank-grade encryption and comply with industry standards to keep your data safe." },
        ],
      },
    },
    {
      type: "cta",
      order: 6,
      props: {
        headline: `Ready to get started with ${brand}?`,
        subheadline: "Join thousands of happy customers. Start your free trial today.",
        ctaText: "Start Free Trial",
        ctaHref: "#",
      },
    },
    {
      type: "footer",
      order: 7,
      props: {
        text: `© 2026 ${brand}. All rights reserved.`,
        links: [
          { text: "Twitter", href: "#" },
          { text: "GitHub", href: "#" },
          { text: "Docs", href: "#" },
          { text: "Privacy", href: "#" },
        ],
      },
    },
  ];
}

function portfolioTemplate(brand: string): PlannedSection[] {
  return [
    {
      type: "header",
      order: 1,
      props: {
        logoText: brand,
        navLinks: [
          { text: "Work", href: "#work" },
          { text: "About", href: "#about" },
          { text: "Contact", href: "#contact" },
        ],
      },
    },
    {
      type: "hero",
      order: 2,
      props: {
        headline: `Hi, I'm ${brand}`,
        subheadline: "I design and build digital experiences that make an impact. Let's create something great together.",
        primaryCta: { text: "View my work", href: "#" },
        secondaryCta: { text: "Get in touch →", href: "#" },
      },
    },
    {
      type: "features",
      order: 3,
      props: {
        title: "Featured work",
        subtitle: "A selection of projects I've recently completed.",
        features: [
          { title: "E-commerce Platform", description: "A modern shopping experience built with React and Node.js.", icon: "Zap" },
          { title: "SaaS Dashboard", description: "Analytics dashboard serving 10k+ daily active users.", icon: "BarChart" },
          { title: "Mobile App", description: "Cross-platform mobile application with 100k+ downloads.", icon: "Globe" },
          { title: "Brand Identity", description: "Complete brand redesign for a tech startup.", icon: "Layers" },
        ],
      },
    },
    {
      type: "cta",
      order: 4,
      props: {
        headline: "Let's work together",
        subheadline: "I'm always open to new projects and collaborations.",
        ctaText: "Get in touch",
        ctaHref: "#",
      },
    },
    {
      type: "footer",
      order: 5,
      props: {
        text: `© 2026 ${brand}. All rights reserved.`,
        links: [
          { text: "Dribbble", href: "#" },
          { text: "GitHub", href: "#" },
          { text: "LinkedIn", href: "#" },
          { text: "Email", href: "#" },
        ],
      },
    },
  ];
}

function agencyTemplate(brand: string): PlannedSection[] {
  return [
    {
      type: "header",
      order: 1,
      props: {
        logoText: brand,
        navLinks: [
          { text: "Services", href: "#services" },
          { text: "Work", href: "#work" },
          { text: "Contact", href: "#contact" },
        ],
        ctaText: "Start a Project",
      },
    },
    {
      type: "hero",
      order: 2,
      props: {
        headline: `We build brands that matter`,
        subheadline: `${brand} is a full-service creative agency. We design, build, and grow digital products for ambitious companies.`,
        primaryCta: { text: "Our Work", href: "#" },
        secondaryCta: { text: "Contact us →", href: "#" },
      },
    },
    {
      type: "features",
      order: 3,
      props: {
        title: "Our services",
        subtitle: "End-to-end solutions for your digital presence.",
        features: [
          { title: "Brand Strategy", description: "We craft brand identities that resonate with your audience.", icon: "Star" },
          { title: "Web Development", description: "Custom websites and web applications built with modern tech.", icon: "Zap" },
          { title: "UI/UX Design", description: "User-centered design that drives engagement and conversions.", icon: "Layers" },
          { title: "Digital Marketing", description: "Data-driven marketing strategies to grow your reach.", icon: "BarChart" },
          { title: "Mobile Development", description: "Native and cross-platform mobile applications.", icon: "Shield" },
          { title: "Cloud Infrastructure", description: "Scalable infrastructure setup and management.", icon: "Globe" },
        ],
      },
    },
    {
      type: "faq",
      order: 4,
      props: {
        title: "How we work",
        items: [
          { question: "What is your process?", answer: "We follow a proven 4-phase process: Discovery, Design, Development, and Launch." },
          { question: "How long does a typical project take?", answer: "Most projects take 4-8 weeks depending on scope and complexity." },
          { question: "Do you offer ongoing support?", answer: "Yes, we offer maintenance and support packages for all our projects." },
        ],
      },
    },
    {
      type: "cta",
      order: 5,
      props: {
        headline: "Ready to start your project?",
        subheadline: `Let's talk about how ${brand} can help bring your vision to life.`,
        ctaText: "Get in Touch",
        ctaHref: "#",
      },
    },
    {
      type: "footer",
      order: 6,
      props: {
        text: `© 2026 ${brand} Agency. All rights reserved.`,
        links: [
          { text: "Twitter", href: "#" },
          { text: "Instagram", href: "#" },
          { text: "LinkedIn", href: "#" },
          { text: "Email", href: "#" },
        ],
      },
    },
  ];
}

function restaurantTemplate(brand: string): PlannedSection[] {
  return [
    {
      type: "header",
      order: 1,
      props: {
        logoText: brand,
        navLinks: [
          { text: "Menu", href: "#menu" },
          { text: "About", href: "#about" },
          { text: "Reservations", href: "#reservations" },
        ],
        ctaText: "Reserve a Table",
      },
    },
    {
      type: "hero",
      order: 2,
      props: {
        headline: `Welcome to ${brand}`,
        subheadline: "Experience exceptional cuisine crafted with the finest ingredients. Every dish tells a story.",
        primaryCta: { text: "View Menu", href: "#" },
        secondaryCta: { text: "Make a Reservation →", href: "#" },
      },
    },
    {
      type: "features",
      order: 3,
      props: {
        title: "Our menu",
        subtitle: "Carefully curated dishes for every palate.",
        features: [
          { title: "Appetizers", description: "Start your meal with our chef's signature starters.", icon: "Star" },
          { title: "Main Courses", description: "Hearty mains crafted from locally sourced ingredients.", icon: "Heart" },
          { title: "Desserts", description: "Indulge in our handmade desserts and pastries.", icon: "Sparkles" },
          { title: "Wine Selection", description: "Curated wine pairings from the world's best vineyards.", icon: "Star" },
        ],
      },
    },
    {
      type: "cta",
      order: 4,
      props: {
        headline: "Book your experience",
        subheadline: `Reserve a table at ${brand} for an unforgettable dining experience.`,
        ctaText: "Make a Reservation",
        ctaHref: "#",
      },
    },
    {
      type: "footer",
      order: 5,
      props: {
        text: `© 2026 ${brand}. All rights reserved.`,
        links: [
          { text: "Hours", href: "#" },
          { text: "Location", href: "#" },
          { text: "Menu", href: "#" },
          { text: "Contact", href: "#" },
        ],
      },
    },
  ];
}

function ecommerceTemplate(brand: string): PlannedSection[] {
  return [
    {
      type: "header",
      order: 1,
      props: {
        logoText: brand,
        navLinks: [
          { text: "Shop", href: "#shop" },
          { text: "Categories", href: "#categories" },
          { text: "Sale", href: "#sale" },
        ],
        ctaText: "Cart (0)",
      },
    },
    {
      type: "hero",
      order: 2,
      props: {
        headline: `Discover the ${brand} collection`,
        subheadline: "Curated products for modern living. Free shipping on all orders over $50.",
        primaryCta: { text: "Shop Now", href: "#" },
        secondaryCta: { text: "Explore Categories →", href: "#" },
      },
    },
    {
      type: "features",
      order: 3,
      props: {
        title: "Why shop with us",
        subtitle: "We're committed to the best shopping experience.",
        features: [
          { title: "Free Shipping", description: "Free shipping on all orders over $50. Fast and reliable delivery.", icon: "Zap" },
          { title: "Easy Returns", description: "30-day hassle-free return policy. No questions asked.", icon: "Heart" },
          { title: "Secure Checkout", description: "Bank-grade encryption protects your payment information.", icon: "Shield" },
          { title: "24/7 Support", description: "Our support team is here to help anytime, day or night.", icon: "Star" },
        ],
      },
    },
    {
      type: "pricing",
      order: 4,
      props: {
        title: "Featured products",
        subtitle: "Our most popular items this season.",
        plans: [
          { name: "Essentials Pack", price: "$29", description: "Everyday essentials at great value.", features: ["Premium quality", "Eco-friendly", "1-year warranty"], cta: "Add to Cart" },
          { name: "Signature Bundle", price: "$59", description: "Our best-selling collection.", features: ["Everything in Essentials", "Bonus items", "Gift wrapping", "Free shipping"], cta: "Add to Cart", highlighted: true },
          { name: "Premium Set", price: "$99", description: "The ultimate experience.", features: ["Everything in Signature", "Limited edition", "Priority delivery", "Exclusive access"], cta: "Add to Cart" },
        ],
      },
    },
    {
      type: "cta",
      order: 5,
      props: {
        headline: "Join the community",
        subheadline: "Sign up for exclusive offers and early access to new collections.",
        ctaText: "Subscribe",
        ctaHref: "#",
      },
    },
    {
      type: "footer",
      order: 6,
      props: {
        text: `© 2026 ${brand}. All rights reserved.`,
        links: [
          { text: "Shipping", href: "#" },
          { text: "Returns", href: "#" },
          { text: "FAQ", href: "#" },
          { text: "Contact", href: "#" },
        ],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Template map
// ---------------------------------------------------------------------------

const TEMPLATES: Record<WebsiteType, (brand: string) => PlannedSection[]> = {
  saas: saasTemplate,
  portfolio: portfolioTemplate,
  agency: agencyTemplate,
  restaurant: restaurantTemplate,
  ecommerce: ecommerceTemplate,
};

export function getTemplateSections(
  type: WebsiteType,
  brand: string,
  // Intentionally unused (underscore prefix signals this to no-unused-vars).
  _theme: string,
): PlannedSection[] {
  const generator = TEMPLATES[type] ?? TEMPLATES.saas;
  return generator(brand);
}
