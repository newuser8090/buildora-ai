// ---------------------------------------------------------------------------
// Canonical link type used consistently across the editor
// ---------------------------------------------------------------------------

export interface LinkItem {
  text: string;
  href: string;
}

// ---------------------------------------------------------------------------
// Normalize a single link value to canonical LinkItem
// Accepts:
//   - "label"        → { text: "label", href: "#" }
//   - { label, href } → { text: label, href }
//   - { text, href }  → unchanged
//   - invalid          → null
// ---------------------------------------------------------------------------

export function normalizeLinkItem(value: unknown): LinkItem | null {
  if (typeof value === "string") {
    return { text: value, href: "#" };
  }

  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    const href = typeof obj.href === "string" ? obj.href : "#";

    if (typeof obj.text === "string") {
      return { text: obj.text, href };
    }

    // Legacy: support { label, href } → { text, href }
    if (typeof obj.label === "string") {
      return { text: obj.label, href };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Normalize an array of link-like values
// Filters out invalid items
// ---------------------------------------------------------------------------

export function normalizeLinks(values: unknown[]): LinkItem[] {
  return values
    .map(normalizeLinkItem)
    .filter((item): item is LinkItem => item !== null);
}

// ---------------------------------------------------------------------------
// Normalize a CTA-like field that might be a string or {text, href} object
// Returns the text portion only for string-typed fields (e.g. ctaText)
// ---------------------------------------------------------------------------

export function normalizeCtaText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.label === "string") return obj.label;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Normalize a link item field that should be a {text, href} object.
// If it's a plain string, convert to {text, href}.
// If it's already valid, return as-is.
// If it's invalid, return a default.
// ---------------------------------------------------------------------------

export function normalizeLinkField(value: unknown): LinkItem {
  if (typeof value === "string") {
    return { text: value, href: "#" };
  }
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    const text = typeof obj.text === "string" ? obj.text
      : typeof obj.label === "string" ? obj.label
      : "Learn More";
    const href = typeof obj.href === "string" ? obj.href : "#";
    return { text, href };
  }
  return { text: "Learn More", href: "#" };
}

// ---------------------------------------------------------------------------
// Normalize a pricing plan's cta field (should be string, not {text, href})
// ---------------------------------------------------------------------------

export function normalizePricingCta(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.label === "string") return obj.label;
  }
  return "Get Started";
}

// ---------------------------------------------------------------------------
// Section-specific normalization — applies all normalizations for a section
// based on its type. This is the comprehensive normalizer that should be used
// instead of the old ad-hoc approach.
// ---------------------------------------------------------------------------

export interface NormalizedSection {
  type: string;
  order: number;
  props: Record<string, unknown>;
}

export function normalizeSectionProps(section: {
  type: string;
  props: Record<string, unknown>;
  order?: number;
}): NormalizedSection {
  const type = section.type.toLowerCase().trim();
  const props = { ...section.props };

  switch (type) {
    case "header": {
      // Normalize navLinks
      if (props.navLinks) {
        props.navLinks = normalizeLinks(props.navLinks as unknown[]);
      }
      // Normalize ctaText (should be string, not object)
      if (typeof props.ctaText === "object" && props.ctaText !== null) {
        props.ctaText = normalizeCtaText(props.ctaText);
      }
      // Fallback defaults
      if (!props.logoText) props.logoText = "Brand";
      if (!Array.isArray(props.navLinks)) props.navLinks = [];
      break;
    }

    case "hero": {
      // Normalize primaryCta (should be {text, href}, not string)
      if (props.primaryCta !== undefined) {
        props.primaryCta = normalizeLinkField(props.primaryCta);
      }
      // Normalize secondaryCta
      if (props.secondaryCta !== undefined) {
        props.secondaryCta = normalizeLinkField(props.secondaryCta);
      }
      // Normalize headline/subheadline
      if (typeof props.headline === "object" && props.headline !== null) {
        props.headline = normalizeCtaText(props.headline);
      }
      if (typeof props.subheadline === "object" && props.subheadline !== null) {
        props.subheadline = normalizeCtaText(props.subheadline);
      }
      break;
    }

    case "features": {
      // Normalize each feature item
      if (Array.isArray(props.features)) {
        props.features = (props.features as unknown[]).map((f) => {
          if (typeof f === "object" && f !== null) {
            const feat = f as Record<string, unknown>;
            // Normalize any link fields within features
            if (feat.link) {
              feat.link = normalizeLinkField(feat.link);
            }
            return feat;
          }
          return { title: "Feature", description: "", icon: "Zap" };
        });
      }
      if (typeof props.title === "object" && props.title !== null) {
        props.title = normalizeCtaText(props.title);
      }
      break;
    }

    case "pricing": {
      // Normalize each plan's cta field (must be string, not {text, href})
      if (Array.isArray(props.plans)) {
        props.plans = (props.plans as unknown[]).map((p) => {
          if (typeof p === "object" && p !== null) {
            const plan = { ...(p as Record<string, unknown>) };
            // The KEY fix: normalize pricing plan cta from object to string
            if (plan.cta !== undefined) {
              plan.cta = normalizePricingCta(plan.cta);
            }
            return plan;
          }
          return { name: "Plan", price: "$0", cta: "Get Started", features: [] };
        });
      }
      break;
    }

    case "faq": {
      // FAQ items should be fine as they are {question, answer} objects
      if (Array.isArray(props.items)) {
        props.items = (props.items as unknown[]).filter(
          (item) => typeof item === "object" && item !== null
        );
      }
      break;
    }

    case "cta": {
      // Normalize ctaText (should be string, not object)
      if (typeof props.ctaText === "object" && props.ctaText !== null) {
        props.ctaText = normalizeCtaText(props.ctaText);
      }
      if (typeof props.headline === "object" && props.headline !== null) {
        props.headline = normalizeCtaText(props.headline);
      }
      break;
    }

    case "footer": {
      // Normalize links
      if (props.links) {
        props.links = normalizeLinks(props.links as unknown[]);
      }
      if (!Array.isArray(props.links)) props.links = [];
      break;
    }
  }

  return { type, order: section.order ?? 0, props };
}

// ---------------------------------------------------------------------------
// Development-only diagnostic helper
// ---------------------------------------------------------------------------

export function logNormalizationWarning(
  sectionType: string,
  field: string,
  value: unknown,
): void {
  if (process.env.NODE_ENV === "development") {
    const category =
      typeof value === "object" && value !== null
        ? `object with keys [${Object.keys(value).join(", ")}]`
        : typeof value;
    console.warn(
      `[Buildora] Normalized ${sectionType}.${field} (was ${category})`,
    );
  }
}
