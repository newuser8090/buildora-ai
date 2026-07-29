import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "../../store/editor-store";
import type { Project } from "@/types/project";

function makePricingProject(): Project {
  return {
    id: "test-proj",
    name: "Test",
    theme: {
      palette: {
        background: "#ffffff", foreground: "#0a0a0a", primary: "#7c5cfc",
        primaryForeground: "#ffffff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#ffffff", border: "#e5e5e5", card: "#ffffff", cardForeground: "#0a0a0a",
      },
      typography: { fontFamily: "Geist, system-ui, sans-serif", headingFont: "Geist, system-ui, sans-serif", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "6rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    pages: [
      {
        id: "page-1", title: "Home", slug: "/",
        sections: [
          {
            id: "pricing-1", type: "pricing", order: 1, visible: true,
            props: {
              title: "Pricing",
              subtitle: "Choose a plan",
              plans: [
                { name: "Basic", price: "$10", cta: "Buy Basic", features: ["A"], highlighted: false, description: "" },
                { name: "Pro", price: "$50", cta: "Buy Pro", features: ["A", "B"], highlighted: true, description: "" },
              ],
            },
            styles: {},
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("PricingInspector undo behavior", () => {
  beforeEach(() => {
    const project = makePricingProject();
    useEditorStore.setState({
      project,
      selectedSectionId: null,
      selectedPageId: "page-1",
      viewport: "desktop",
      zoom: 100,
      isGenerating: false,
      generationProgress: 0,
      history: { past: [], present: project, future: [] },
      _editingSession: null,
    });
  });

  it("editing plan name and cta in one session creates one history entry", () => {
    useEditorStore.getState().beginEditSession();

    const state = useEditorStore.getState();
    // Simulate editing plan name
    const plans = [...state.project.pages[0].sections[0].props.plans as Array<Record<string, unknown>>];
    plans[0] = { ...plans[0], name: "Premium" };
    useEditorStore.getState().updateSectionProps("pricing-1", { plans } as unknown as Record<string, unknown>);

    // Simulate editing plan CTA in same session
    const latestState = useEditorStore.getState();
    const plans2 = [...latestState.project.pages[0].sections[0].props.plans as Array<Record<string, unknown>>];
    plans2[0] = { ...plans2[0], cta: "Buy Premium" };
    useEditorStore.getState().updateSectionProps("pricing-1", { plans: plans2 } as unknown as Record<string, unknown>);

    // No history yet
    expect(useEditorStore.getState().history.past.length).toBe(0);

    // Commit
    useEditorStore.getState().commitEditSession();

    // Exactly one history entry
    expect(useEditorStore.getState().history.past.length).toBe(1);

    // Final values should be preserved
    const section = useEditorStore.getState().project.pages[0].sections[0];
    const updatedPlans = section.props.plans as Array<Record<string, unknown>>;
    expect(updatedPlans[0].name).toBe("Premium");
    expect(updatedPlans[0].cta).toBe("Buy Premium");
  });

  it("toggling highlight creates one history entry", () => {
    useEditorStore.getState().beginEditSession();

    const state = useEditorStore.getState();
    // Toggle highlight: Basic becomes highlighted, Pro loses it
    const plans = (state.project.pages[0].sections[0].props.plans as Array<Record<string, unknown>>).map((plan, i) => ({
      ...plan,
      highlighted: i === 0, // highlight Basic, unhighlight Pro
    }));
    useEditorStore.getState().updateSectionProps("pricing-1", { plans } as unknown as Record<string, unknown>);
    useEditorStore.getState().commitEditSession();

    expect(useEditorStore.getState().history.past.length).toBe(1);

    const section = useEditorStore.getState().project.pages[0].sections[0];
    const updatedPlans = section.props.plans as Array<Record<string, unknown>>;
    expect(updatedPlans[0].highlighted).toBe(true);
    expect(updatedPlans[1].highlighted).toBe(false);
  });

  it("editing price preserves other plan data", () => {
    useEditorStore.getState().beginEditSession();

    const state = useEditorStore.getState();
    const plans = [...state.project.pages[0].sections[0].props.plans as Array<Record<string, unknown>>];
    plans[1] = { ...plans[1], price: "$99" };
    useEditorStore.getState().updateSectionProps("pricing-1", { plans } as unknown as Record<string, unknown>);
    useEditorStore.getState().commitEditSession();

    const section = useEditorStore.getState().project.pages[0].sections[0];
    const updatedPlans = section.props.plans as Array<Record<string, unknown>>;
    // Pro price changed
    expect(updatedPlans[1].price).toBe("$99");
    // Basic unchanged
    expect(updatedPlans[0].price).toBe("$10");
    expect(updatedPlans[0].name).toBe("Basic");
    // Features preserved
    expect(updatedPlans[0].features).toEqual(["A"]);
    expect(updatedPlans[1].features).toEqual(["A", "B"]);
  });

  it("undo restores original pricing values", () => {
    useEditorStore.getState().beginEditSession();

    const state = useEditorStore.getState();
    const plans = [...state.project.pages[0].sections[0].props.plans as Array<Record<string, unknown>>];
    plans[0] = { ...plans[0], name: "Changed", price: "$100" };
    useEditorStore.getState().updateSectionProps("pricing-1", { plans } as unknown as Record<string, unknown>);
    useEditorStore.getState().commitEditSession();

    // Undo
    useEditorStore.getState().undo();

    const section = useEditorStore.getState().project.pages[0].sections[0];
    const updatedPlans = section.props.plans as Array<Record<string, unknown>>;
    expect(updatedPlans[0].name).toBe("Basic");
    expect(updatedPlans[0].price).toBe("$10");
  });
});
