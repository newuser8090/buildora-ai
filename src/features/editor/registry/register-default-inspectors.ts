"use client";

import { useEffect } from "react";
import { inspectorRegistry } from "./inspector-registry";
import { HeaderInspector } from "@/features/editor/inspectors/HeaderInspector";
import { HeroInspector } from "@/features/editor/inspectors/HeroInspector";
import { FeaturesInspector } from "@/features/editor/inspectors/FeaturesInspector";
import { PricingInspector } from "@/features/editor/inspectors/PricingInspector";
import { FaqInspector } from "@/features/editor/inspectors/FaqInspector";
import { CtaInspector } from "@/features/editor/inspectors/CtaInspector";
import { FooterInspector } from "@/features/editor/inspectors/FooterInspector";

export function useRegisterDefaultInspectors() {
  useEffect(() => {
    inspectorRegistry.registerAll([
      ["header", HeaderInspector],
      ["hero", HeroInspector],
      ["features", FeaturesInspector],
      ["pricing", PricingInspector],
      ["faq", FaqInspector],
      ["cta", CtaInspector],
      ["footer", FooterInspector],
    ]);
  }, []);
}
