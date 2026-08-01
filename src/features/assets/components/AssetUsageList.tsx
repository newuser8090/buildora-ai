"use client";

import type { AssetUsageReference } from "@/features/assets/services/reference-analyzer";

const SECTION_LABELS: Record<string, string> = {
  header: "Header",
  hero: "Hero",
  features: "Features",
  pricing: "Pricing",
  faq: "FAQ",
  cta: "CTA",
  footer: "Footer",
};

const FIELD_LABELS: Record<string, string> = {
  logoImage: "Logo",
  heroImage: "Hero image",
  backgroundImage: "Background",
  iconImage: "Icon",
};

function labelSection(type: string): string {
  return SECTION_LABELS[type] || type;
}

function labelField(field: string): string {
  // Handle feature items like "features[0].iconImage"
  const match = field.match(/features\[\d+\]\.(iconImage)/);
  if (match) return FIELD_LABELS[match[1]] || match[1];
  return FIELD_LABELS[field] || field;
}

export interface AssetUsageListProps {
  references: AssetUsageReference[];
}

export function AssetUsageList({ references }: AssetUsageListProps) {
  if (references.length === 0) {
    return (
      <p className="text-xs text-text-dim/60">
        This asset is not currently used in any section.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-text-muted">
        Used in {references.length} {references.length === 1 ? "place" : "places"}:
      </p>
      <ul className="flex flex-col gap-1">
        {references.map((ref, i) => (
          <li key={i} className="flex items-center gap-2 text-xs text-text-dim">
            <span className="flex h-1.5 w-1.5 rounded-full bg-accent/60" />
            <span>
              {ref.pageName && <span className="text-text-muted">{ref.pageName} &mdash; </span>}
              <span className="text-text-muted">{labelSection(ref.sectionType)}</span>
              <span className="text-text-dim/60"> &mdash; {labelField(ref.field)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
