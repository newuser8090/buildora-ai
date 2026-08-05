"use client";

import { useEffect } from "react";
import { sectionRegistry } from "./section-registry";
import { HeaderSection } from "@/features/editor/sections/HeaderSection";
import { HeroSection } from "@/features/editor/sections/HeroSection";
import { FeaturesSection } from "@/features/editor/sections/FeaturesSection";
import { PricingSection } from "@/features/editor/sections/PricingSection";
import { FaqSection } from "@/features/editor/sections/FaqSection";
import { CtaSection } from "@/features/editor/sections/CtaSection";
import { FooterSection } from "@/features/editor/sections/FooterSection";
import { CustomBlockSection } from "@/features/editor/sections/CustomBlockSection";
import { CUSTOM_BLOCK_SECTION_TYPE } from "@/features/code-import/schemas/custom-block-schema";

/**
 * Client component that registers all built-in section types.
 * Must be rendered once inside a client boundary.
 */
export function useRegisterDefaultSections() {
  useEffect(() => {
    sectionRegistry.registerAll([
      ["header", HeaderSection],
      ["hero", HeroSection],
      ["features", FeaturesSection],
      ["pricing", PricingSection],
      ["faq", FaqSection],
      ["cta", CtaSection],
      ["footer", FooterSection],
      [CUSTOM_BLOCK_SECTION_TYPE, CustomBlockSection],
    ]);
  }, []);
}
