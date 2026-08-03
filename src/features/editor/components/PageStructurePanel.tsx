// ---------------------------------------------------------------------------
// PageStructurePanel — structure / layers panel
//
// Displays the ordered section list for the active page with:
//   - select (syncs with canvas)
//   - pointer drag reorder (DnD-kit sortable)
//   - keyboard drag (DnD-kit KeyboardSensor)
//   - Alt+ArrowUp/Down keyboard reorder on a focused row
//   - move up / move down buttons
//   - duplicate / hide/show / delete action menu
//   - Add Section button
//
// Architectural rules:
//   - drag state never touches the store until drop (single reorderSection)
//   - no project mutation during pointer movement
//   - hidden sections remain visible here (managed from this panel)
//   - no Blob/thumbnail data loaded
// ---------------------------------------------------------------------------

"use client";

import { useCallback, createElement, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  HelpCircle,
  LayoutGrid,
  Megaphone,
  Menu,
  MoreHorizontal,
  PanelBottom,
  Plus,
  Sparkles,
  Tag,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useEditorUiStore } from "@/features/editor/ui/editor-ui-store";
import {
  getSectionLabel,
  getSectionTypeLabel,
} from "@/features/editor/utils/section-labels";
import { scrollStructureRowIntoView } from "@/features/editor/utils/scroll-section-into-view";
import type { BaseSection } from "@/types/section";

// ---------------------------------------------------------------------------
// Icon mapping (section type → lucide icon, with fallback)
// ---------------------------------------------------------------------------

const SECTION_ICONS: Record<string, LucideIcon> = {
  header: Menu,
  hero: Sparkles,
  features: LayoutGrid,
  pricing: Tag,
  faq: HelpCircle,
  cta: Megaphone,
  footer: PanelBottom,
};

const FALLBACK_ICON: LucideIcon = LayoutGrid;

function iconForType(type: string): LucideIcon {
  return SECTION_ICONS[type] ?? FALLBACK_ICON;
}

// ---------------------------------------------------------------------------
// Action menu — accessible dropdown per row
// ---------------------------------------------------------------------------

interface ActionMenuProps {
  section: BaseSection;
  index: number;
  total: number;
  singletonBlocked: boolean;
  onMoveUp: (sectionId: string) => void;
  onMoveDown: (sectionId: string) => void;
  onDuplicate: (sectionId: string) => void;
  onToggleVisible: (sectionId: string) => void;
  onDelete: (sectionId: string) => void;
}

function ActionMenu({
  section,
  index,
  total,
  singletonBlocked,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onToggleVisible,
  onDelete,
}: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [prevFocus, setPrevFocus] = useState<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);

  // Keep the open ref in sync inside an effect (never during render)
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Close on outside click + Escape
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!openRef.current) {
      setPrevFocus(document.activeElement as HTMLElement | null);
    }
    setOpen((v) => !v);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    prevFocus?.focus();
    setPrevFocus(null);
  }, [prevFocus]);

  const run = useCallback(
    (action: (sectionId: string) => void) => (e: React.MouseEvent) => {
      e.stopPropagation();
      close();
      action(section.id);
    },
    [close, section.id],
  );

  interface MenuItem {
    key: string;
    label: string;
    icon: LucideIcon;
    disabled: boolean;
    danger?: boolean;
    onClick: (e: React.MouseEvent) => void;
    ariaDisabledReason?: string;
  }

  const menuItems: MenuItem[] = [
    {
      key: "move-up",
      label: "Move Up",
      icon: ArrowUp,
      disabled: index === 0,
      onClick: run(onMoveUp),
      ariaDisabledReason: index === 0 ? "Already at the top" : undefined,
    },
    {
      key: "move-down",
      label: "Move Down",
      icon: ArrowDown,
      disabled: index === total - 1,
      onClick: run(onMoveDown),
      ariaDisabledReason:
        index === total - 1 ? "Already at the bottom" : undefined,
    },
    {
      key: "duplicate",
      label: "Duplicate",
      icon: Copy,
      disabled: singletonBlocked,
      onClick: run(onDuplicate),
      ariaDisabledReason: singletonBlocked
        ? "This section type can only appear once"
        : undefined,
    },
    {
      key: "toggle-visible",
      label: section.visible ? "Hide" : "Show",
      icon: section.visible ? EyeOff : Eye,
      disabled: false,
      onClick: run(onToggleVisible),
    },
    {
      key: "delete",
      label: "Delete",
      icon: Trash2,
      disabled: total <= 1,
      danger: true,
      onClick: run(onDelete),
      ariaDisabledReason:
        total <= 1 ? "A page must keep at least one section" : undefined,
    },
  ];

  return (
    <div ref={menuRef} className="relative flex-shrink-0">
      <button
        type="button"
        data-testid={`section-menu-${section.id}`}
        aria-label={`Actions for ${getSectionTypeLabel(section.type)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation();
          }
        }}
        className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-base hover:text-text-primary"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          data-testid={`section-menu-${section.id}-items`}
          className="absolute right-0 top-8 z-40 w-44 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-elevated"
        >
          {menuItems.map((item) => {
            // Dynamic icon via createElement (avoids component-created-in-render)
            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={item.onClick}
                data-testid={`section-action-${item.key}`}
                aria-disabled={item.disabled || undefined}
                aria-label={item.ariaDisabledReason ?? item.label}
                title={item.ariaDisabledReason}
                className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  item.danger
                    ? "text-red-400 hover:bg-red-500/10"
                    : "text-text-muted hover:bg-base hover:text-text-primary"
                }`}
              >
                {createElement(item.icon, { className: "h-3.5 w-3.5" })}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable row
// ---------------------------------------------------------------------------

interface StructureRowProps {
  section: BaseSection;
  index: number;
  total: number;
  selected: boolean;
  isDragging: boolean;
  onSelect: (sectionId: string) => void;
  onMoveUp: (sectionId: string) => void;
  onMoveDown: (sectionId: string) => void;
  onDuplicate: (sectionId: string) => void;
  onToggleVisible: (sectionId: string) => void;
  onDelete: (sectionId: string) => void;
}

function StructureRow({
  section,
  index,
  total,
  selected,
  isDragging,
  onSelect,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onToggleVisible,
  onDelete,
}: StructureRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: sortableDragging,
  } = useSortable({ id: section.id, disabled: isDragging });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const label = getSectionLabel(section);
  const singletonBlocked = section.type === "header" || section.type === "footer";

  // Alt+ArrowUp / Alt+ArrowDown keyboard reorder when the row is focused
  const handleRowKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.altKey && e.key === "ArrowUp") {
        e.preventDefault();
        onMoveUp(section.id);
      } else if (e.altKey && e.key === "ArrowDown") {
        e.preventDefault();
        onMoveDown(section.id);
      }
    },
    [section.id, onMoveUp, onMoveDown],
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-structure-row-id={section.id}
      data-section-type={section.type}
      data-testid={`structure-row-${section.id}`}
      data-selected={selected || undefined}
      onClick={() => onSelect(section.id)}
      onKeyDown={handleRowKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`${getSectionTypeLabel(section.type)}: ${label}`}
      aria-current={selected || undefined}
      className={`group flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-2 transition-colors ${
        selected
          ? "border-accent/40 bg-accent/10"
          : "border-transparent hover:bg-base"
      } ${sortableDragging ? "z-10 shadow-lg" : ""}`}
    >
      {/* Drag handle */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${getSectionTypeLabel(section.type)}`}
        data-testid={`drag-handle-${section.id}`}
        className="flex h-7 w-6 flex-shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-text-dim/60 transition-colors hover:text-text-primary active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Section icon — dynamic icon via createElement (avoids
          component-created-in-render lint rule) */}
      <span
        className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md ${
          section.visible ? "bg-card/70 text-text-dim" : "bg-base text-text-dim/40"
        }`}
      >
        {createElement(iconForType(section.type), { className: "h-3.5 w-3.5" })}
      </span>

      {/* Label */}
      <span className="min-w-0 flex-1 truncate text-xs">
        <span className={section.visible ? "text-text-primary" : "text-text-dim/50"}>
          {label}
        </span>
        {!section.visible && (
          <span
            className="ml-1.5 rounded bg-base px-1 py-px text-[10px] font-medium uppercase tracking-wide text-text-dim/60"
            data-testid={`hidden-badge-${section.id}`}
          >
            Hidden
          </span>
        )}
      </span>

      {/* Action menu */}
      <ActionMenu
        section={section}
        index={index}
        total={total}
        singletonBlocked={singletonBlocked}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onDuplicate={onDuplicate}
        onToggleVisible={onToggleVisible}
        onDelete={onDelete}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PageStructurePanel
// ---------------------------------------------------------------------------

export function PageStructurePanel() {
  const project = useEditorStore((s) => s.project);
  const selectedPageId = useEditorStore((s) => s.selectedPageId);
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);
  const selectSection = useEditorStore((s) => s.selectSection);
  const reorderSection = useEditorStore((s) => s.reorderSection);
  const moveSectionUp = useEditorStore((s) => s.moveSectionUp);
  const moveSectionDown = useEditorStore((s) => s.moveSectionDown);
  const duplicateSection = useEditorStore((s) => s.duplicateSection);
  const deleteSection = useEditorStore((s) => s.deleteSection);
  const toggleSectionVisibility = useEditorStore(
    (s) => s.toggleSectionVisibility,
  );
  const openAddSectionDialog = useEditorUiStore(
    (s) => s.openAddSectionDialog,
  );

  const activePage =
    project.pages.find((p) => p.id === selectedPageId) ?? project.pages[0];

  // Ordered, memoized list (structure panel shows hidden sections too)
  const sections = useMemo(() => {
    if (!activePage) return [];
    return [...activePage.sections].sort((a, b) => a.order - b.order);
  }, [activePage]);

  // Scroll selected row into view when selection changes. Self-originated
  // structure selections are excluded (the user is already looking at the row).
  const listRef = useRef<HTMLDivElement>(null);
  const prevSelectedRef = useRef<string | null>(selectedSectionId);
  const selectionSource = useEditorUiStore((s) => s.selectionSource);
  useEffect(() => {
    if (
      selectedSectionId &&
      prevSelectedRef.current !== selectedSectionId &&
      selectionSource !== "structure"
    ) {
      scrollStructureRowIntoView(selectedSectionId, listRef.current);
    }
    prevSelectedRef.current = selectedSectionId;
  }, [selectedSectionId, selectionSource]);

  // ---- DnD sensors ----
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const [activeDragId, setActiveDragId] = useState<UniqueIdentifier | null>(null);
  const activeDragSection = useMemo(
    () => sections.find((s) => s.id === activeDragId) ?? null,
    [sections, activeDragId],
  );
  const draggingIndex = activeDragSection
    ? sections.findIndex((s) => s.id === activeDragSection.id)
    : -1;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(event.active.id);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      const { active, over } = event;
      if (!over || !activePage) return;
      if (active.id === over.id) return;
      reorderSection(activePage.id, String(active.id), String(over.id));
    },
    [reorderSection, activePage],
  );

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
  }, []);

  // ---- Announcements for screen readers (passed via DndContext accessibility)
  const announcements: Announcements = useMemo(
    () => ({
      onDragStart({ active }) {
        const section = sections.find((s) => s.id === active.id);
        const label = section ? getSectionLabel(section) : String(active.id);
        return `${label} picked up. Position ${draggingIndex + 1} of ${sections.length}.`;
      },
      onDragOver({ active, over }) {
        if (!over) return;
        const section = sections.find((s) => s.id === active.id);
        const label = section ? getSectionLabel(section) : String(active.id);
        const overIndex = sections.findIndex((s) => s.id === over.id);
        return `${label} moved to position ${overIndex + 1} of ${sections.length}.`;
      },
      onDragEnd({ active, over }) {
        if (!over) return;
        const section = sections.find((s) => s.id === active.id);
        const label = section ? getSectionLabel(section) : String(active.id);
        const overIndex = sections.findIndex((s) => s.id === over.id);
        return `${label} dropped at position ${overIndex + 1} of ${sections.length}.`;
      },
      onDragCancel({ active }) {
        const section = sections.find((s) => s.id === active.id);
        const label = section ? getSectionLabel(section) : String(active.id);
        return `${label} drag cancelled. Original position restored.`;
      },
    }),
    [sections, draggingIndex],
  );

  // Live region announcements for move up/down + Alt+Arrow reorder
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = useCallback((message: string) => {
    setAnnouncement(message);
    if (announceTimer.current) clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => setAnnouncement(null), 1200);
  }, []);

  const setSelectionSource = useEditorUiStore((s) => s.setSelectionSource);

  const handleSelect = useCallback(
    (sectionId: string) => {
      setSelectionSource("structure");
      selectSection(sectionId);
    },
    [setSelectionSource, selectSection],
  );

  const handleMoveUp = useCallback(
    (sectionId: string) => {
      if (!activePage) return;
      const currentIndex = sections.findIndex((s) => s.id === sectionId);
      const label = getSectionLabel(
        sections[currentIndex] ?? { type: "section", props: {} },
      );
      moveSectionUp(activePage.id, sectionId);
      if (currentIndex > 0) {
        announce(`${label} moved to position ${currentIndex} of ${sections.length}.`);
      }
    },
    [activePage, moveSectionUp, sections, announce],
  );

  const handleMoveDown = useCallback(
    (sectionId: string) => {
      if (!activePage) return;
      const currentIndex = sections.findIndex((s) => s.id === sectionId);
      const label = getSectionLabel(
        sections[currentIndex] ?? { type: "section", props: {} },
      );
      moveSectionDown(activePage.id, sectionId);
      if (currentIndex < sections.length - 1) {
        announce(`${label} moved to position ${currentIndex + 2} of ${sections.length}.`);
      }
    },
    [activePage, moveSectionDown, sections, announce],
  );

  const handleDuplicate = useCallback(
    (sectionId: string) => {
      duplicateSection(sectionId);
    },
    [duplicateSection],
  );

  const handleToggleVisible = useCallback(
    (sectionId: string) => {
      toggleSectionVisibility(sectionId);
    },
    [toggleSectionVisibility],
  );

  const handleDelete = useCallback(
    (sectionId: string) => {
      deleteSection(sectionId);
    },
    [deleteSection],
  );

  if (!activePage) {
    return (
      <div className="px-5 py-8 text-center text-xs text-text-dim">
        No page to display.
      </div>
    );
  }

  const hasSections = sections.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-text-primary">
              {activePage.title || "Page"}
            </h3>
            <p className="text-xs text-text-dim">
              {sections.length} {sections.length === 1 ? "section" : "sections"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => openAddSectionDialog()}
            data-testid="add-section-button"
            className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-xs font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Section
          </button>
        </div>
      </div>        {/* List */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
        {/* Screen-reader announcements for move actions */}
        <div aria-live="polite" className="sr-only" data-testid="structure-announcement">
          {announcement ?? ""}
        </div>

        {!hasSections ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-base">
              <LayoutGrid className="h-5 w-5 text-text-dim/50" />
            </div>
            <p className="text-xs text-text-muted">
              This page has no sections yet.
            </p>
            <button
              type="button"
              onClick={() => openAddSectionDialog()}
              data-testid="structure-empty-add"
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text-muted transition-colors hover:bg-base hover:text-text-primary"
            >
              <Plus className="h-3.5 w-3.5" />
              Add your first section
            </button>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
            accessibility={{ announcements }}
          >
            <SortableContext
              items={sections.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col gap-1">
                {sections.map((section, index) => (
                  <StructureRow
                    key={section.id}
                    section={section}
                    index={index}
                    total={sections.length}
                    selected={selectedSectionId === section.id}
                    isDragging={activeDragId === section.id}
                    onSelect={handleSelect}
                    onMoveUp={handleMoveUp}
                    onMoveDown={handleMoveDown}
                    onDuplicate={handleDuplicate}
                    onToggleVisible={handleToggleVisible}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </SortableContext>

            <DragOverlay dropAnimation={null}>
              {activeDragSection ? (
                <div className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-card px-2 py-2 shadow-elevated">
                  <GripVertical className="h-4 w-4 text-text-dim" />
                  <span className="text-xs font-medium text-text-primary">
                    {getSectionLabel(activeDragSection)}
                  </span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </div>
  );
}
