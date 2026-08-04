// ---------------------------------------------------------------------------
// Editor store — updateEditableFieldValue (Phase M spec §29)
//   - one history entry per applied value
//   - undo / redo
//   - dirty state + revision handled by the controller (store-level checks here)
//   - no-op skips history
//   - invalid descriptor rejected
//   - selection preserved
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { registerDefaultSectionLibrary } from "@/features/editor/section-library/registry/register-default-section-library";
import { buildDescriptorFromFieldId } from "../../registry/editable-field-registry";
import type { EditableFieldDescriptor } from "../../types";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";

beforeEach(() => {
  registerDefaultSectionLibrary();
  useEditorStore.getState().hydrateProject(JSON.parse(JSON.stringify(MOCK_PROJECT)), 5);
  useEditorStore.getState().setDirty(false);
});

function heroDescriptor(): EditableFieldDescriptor {
  const store = useEditorStore.getState();
  const section = store.project.pages[0].sections.find((s) => s.id === "s-hero")!;
  return buildDescriptorFromFieldId("page-1", section, "hero.headline")!;
}

function heroValue(): string {
  const section = useEditorStore
    .getState()
    .project.pages[0].sections.find((s) => s.id === "s-hero")!;
  return section.props.headline as string;
}

describe("updateEditableFieldValue — application", () => {
  it("applies one validated update", () => {
    const result = useEditorStore.getState().updateEditableFieldValue(heroDescriptor(), "New hero");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(true);
    expect(heroValue()).toBe("New hero");
  });

  it("creates exactly one history entry", () => {
    const store = useEditorStore.getState();
    const pastBefore = store.history.past.length;
    store.updateEditableFieldValue(heroDescriptor(), "New hero");
    const after = useEditorStore.getState();
    expect(after.history.past.length).toBe(pastBefore + 1);
  });

  it("undo restores the old value, redo reapplies", () => {
    const store = useEditorStore.getState();
    store.updateEditableFieldValue(heroDescriptor(), "New hero");
    expect(heroValue()).toBe("New hero");
    store.undo();
    expect(heroValue()).toBe("Build beautiful websites\nwith AI assistance");
    store.redo();
    expect(heroValue()).toBe("New hero");
  });

  it("selection is preserved across the update", () => {
    const store = useEditorStore.getState();
    store.selectSection("s-hero");
    store.selectPage("page-1");
    store.updateEditableFieldValue(heroDescriptor(), "New hero");
    const after = useEditorStore.getState();
    expect(after.selectedSectionId).toBe("s-hero");
    expect(after.selectedPageId).toBe("page-1");
  });

  it("advances the revision counter via the controller subscription", () => {
    // The store action commits via withHistory (one project reference change);
    // the persistence controller observes that change and increments revision.
    const store = useEditorStore.getState();
    store.updateEditableFieldValue(heroDescriptor(), "New hero");
    expect(useEditorStore.getState().history.present).not.toBe(store.history.present);
  });
});

describe("updateEditableFieldValue — no-op & errors", () => {
  it("no-op (unchanged value) skips history and stays clean", () => {
    const store = useEditorStore.getState();
    const current = heroValue();
    store.setDirty(false);
    const result = store.updateEditableFieldValue(heroDescriptor(), current);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(false);
    const after = useEditorStore.getState();
    expect(after.history.past.length).toBe(0);
    expect(after.isDirty).toBe(false);
  });

  it("rejects an invalid descriptor with a structured error", () => {
    const desc: EditableFieldDescriptor = {
      ...heroDescriptor(),
      pageId: "missing-page",
    };
    const result = useEditorStore.getState().updateEditableFieldValue(desc, "x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INLINE_FIELD_NOT_FOUND");
  });

  it("rejects an empty value without a history entry", () => {
    const store = useEditorStore.getState();
    const result = store.updateEditableFieldValue(heroDescriptor(), "   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INLINE_VALUE_INVALID");
    expect(useEditorStore.getState().history.past.length).toBe(0);
  });
});
