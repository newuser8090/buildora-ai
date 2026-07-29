import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "./editor-store";
import type { Project } from "@/types/project";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "test-proj",
    name: "Test",
    theme: {
      palette: {
        background: "#ffffff",
        foreground: "#0a0a0a",
        primary: "#7c5cfc",
        primaryForeground: "#ffffff",
        secondary: "#f5f5f5",
        secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5",
        mutedForeground: "#737373",
        accent: "#7c5cfc",
        accentForeground: "#ffffff",
        border: "#e5e5e5",
        card: "#ffffff",
        cardForeground: "#0a0a0a",
      },
      typography: {
        fontFamily: "Geist, system-ui, sans-serif",
        headingFont: "Geist, system-ui, sans-serif",
        baseSize: "16px",
        scale: 1.25,
      },
      spacing: {
        sectionPadding: "6rem 0",
        containerMaxWidth: "1120px",
        gap: "1.5rem",
      },
      radius: {
        sm: "0.375rem",
        md: "0.5rem",
        lg: "0.75rem",
        xl: "1rem",
        full: "9999px",
      },
      shadows: {
        sm: "0 1px 2px rgba(0,0,0,0.05)",
        md: "0 4px 6px rgba(0,0,0,0.07)",
        lg: "0 10px 15px rgba(0,0,0,0.1)",
        xl: "0 20px 25px rgba(0,0,0,0.15)",
      },
    },
    pages: [
      {
        id: "page-1",
        title: "Home",
        slug: "/",
        sections: [
          {
            id: "hero-1",
            type: "hero",
            order: 1,
            visible: true,
            props: {
              headline: "Original Headline",
              subheadline: "Original Sub",
              primaryCta: { text: "Get Started", href: "#" },
            },
            styles: {},
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EditorStore undo/redo with edit sessions", () => {
  beforeEach(() => {
    // Reset store
    useEditorStore.setState({
      project: makeProject(),
      selectedSectionId: null,
      selectedPageId: null,
      viewport: "desktop",
      zoom: 100,
      isGenerating: false,
      generationProgress: 0,
      history: {
        past: [],
        present: makeProject(),
        future: [],
      },
      _editingSession: null,
    });
  });

  it("beginEditSession stores snapshot and commit creates one history entry", () => {
    const store = useEditorStore.getState();
    store.beginEditSession();

    // Multiple mutations during edit session
    useEditorStore.getState().updateSectionProps("hero-1", {
      headline: "Changed 1",
    });
    useEditorStore.getState().updateSectionProps("hero-1", {
      headline: "Changed 2",
    });
    useEditorStore.getState().updateSectionProps("hero-1", {
      headline: "Final Value",
    });

    // No history entries yet
    expect(useEditorStore.getState().history.past.length).toBe(0);

    // Commit
    useEditorStore.getState().commitEditSession();

    // Exactly one history entry now
    expect(useEditorStore.getState().history.past.length).toBe(1);

    // Project has the final value
    const project = useEditorStore.getState().project;
    const section = project.pages[0].sections[0];
    expect(section.props.headline).toBe("Final Value");
  });

  it("cancelEditSession restores the original snapshot", () => {
    const store = useEditorStore.getState();
    store.beginEditSession();

    useEditorStore.getState().updateSectionProps("hero-1", {
      headline: "Should be reverted",
    });

    // Cancel
    useEditorStore.getState().cancelEditSession();

    // Project is restored to original
    const project = useEditorStore.getState().project;
    const section = project.pages[0].sections[0];
    expect(section.props.headline).toBe("Original Headline");

    // No history entry created
    expect(useEditorStore.getState().history.past.length).toBe(0);
  });

  it("Undo restores the original value from before edit session", () => {
    const store = useEditorStore.getState();

    // First set initial state through a non-session update to create history baseline
    // (actually, initProject already set the history)

    store.beginEditSession();
    useEditorStore.getState().updateSectionProps("hero-1", {
      headline: "Edited Value",
    });
    store.commitEditSession();

    // Now undo
    useEditorStore.getState().undo();

    const project = useEditorStore.getState().project;
    const section = project.pages[0].sections[0];
    expect(section.props.headline).toBe("Original Headline");
  });

  it("Redo restores the final edited value", () => {
    const store = useEditorStore.getState();

    store.beginEditSession();
    useEditorStore.getState().updateSectionProps("hero-1", {
      headline: "Redo Value",
    });
    store.commitEditSession();

    // Undo
    store.undo();

    // Redo
    store.redo();

    const project = useEditorStore.getState().project;
    const section = project.pages[0].sections[0];
    expect(section.props.headline).toBe("Redo Value");
  });

  it("typing multiple characters (multiple updates) creates one undo step", () => {
    const store = useEditorStore.getState();

    store.beginEditSession();
    // Simulate typing "Hello" one character at a time
    for (const char of "Hello") {
      const current = useEditorStore.getState().project.pages[0].sections[0]
        .props.headline as string;
      useEditorStore.getState().updateSectionProps("hero-1", {
        headline: current + char,
      });
    }
    store.commitEditSession();

    // Only one history entry
    expect(useEditorStore.getState().history.past.length).toBe(1);

    // Final value is "Original HeadlineHello"
    const section = useEditorStore.getState().project.pages[0].sections[0];
    expect(section.props.headline).toBe("Original HeadlineHello");

    // Undo restores original
    store.undo();
    const undoneSection = useEditorStore.getState().project.pages[0].sections[0];
    expect(undoneSection.props.headline).toBe("Original Headline");
  });
});
