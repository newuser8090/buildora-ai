"use client";

// ---------------------------------------------------------------------------
// EditorDock (Stage 1 — Canva/Wix light shell)
//
// Replaces the persistent wide AI sidebar with a modern 72px vertical icon
// dock. Clicking an icon opens ONE animated 320px white drawer (exactly one
// open at a time — Canva model); clicking the active icon closes it again.
//
//   - Templates drawer: the section library (registry-driven categories),
//     inserted through the SectionFactory + editor store (one history entry).
//   - Elements / Text / Store / Media drawers: the existing P22-D library
//     catalog, inserted through the canonical insertLibraryElement service
//     (one history entry, toasts + scroll-into-view preserved).
//   - AI Magic drawer: hosts the AI composer (the former LeftSidebar chat
//     surface) so the copilot lives inside the flyout; it also opens via the
//     sleek floating button on the canvas (one canonical dock state).
//
// Transient UI state only: the open drawer lives in the editor-ui store;
// nothing here touches project state beyond the existing insertion services.
// ---------------------------------------------------------------------------

import { useCallback, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  Image as ImageIcon,
  LayoutTemplate,
  Loader2,
  Plus,
  Send,
  Shapes,
  ShoppingBag,
  Sparkles,
  Type as TypeIcon,
  X,
} from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import {
  useEditorUiStore,
  type DockPanel,
} from "@/features/editor/ui/editor-ui-store";
import { sectionLibraryRegistry } from "@/features/editor/section-library/registry/section-library-registry";
import { SectionFactory } from "@/features/editor/section-library/services/section-factory";
import type { SectionType } from "@/features/editor/section-library/types";
import {
  buildLibraryCatalog,
  libraryCategoryLabel,
} from "@/features/library/catalog";
import type { LibraryCategoryId, LibraryItem } from "@/features/library/types";
import { insertLibraryElement } from "@/features/library/services/insert-library-element";
import { useMyBlocksUiStore } from "@/features/my-blocks/store/my-blocks-ui-store";
import { scrollSectionIntoView } from "@/features/editor/utils/scroll-section-into-view";
import { useGeneration } from "@/features/generation/hooks/useGeneration";
import { useAiEdit } from "@/features/ai-editing/hooks/useAiEdit";
import { useInlineEdit } from "@/features/inline-editing/hooks/useInlineEdit";
import { useChatStore } from "@/features/chat/store/chat-store";
import { sectionLabel } from "@/features/ai-editing/rules/rule-based-editor";
import { cn } from "@/utils/cn";

// ---------------------------------------------------------------------------
// Rail definition
// ---------------------------------------------------------------------------

interface DockItem {
  panel: Exclude<DockPanel, null>;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  testId: string;
}

const DOCK_ITEMS: DockItem[] = [
  { panel: "templates", label: "Templates", icon: LayoutTemplate, testId: "dock-templates" },
  { panel: "elements", label: "Elements", icon: Shapes, testId: "dock-elements" },
  { panel: "text", label: "Text", icon: TypeIcon, testId: "dock-text" },
  { panel: "store", label: "Store", icon: ShoppingBag, testId: "dock-store" },
  { panel: "media", label: "Media", icon: ImageIcon, testId: "dock-media" },
  { panel: "ai", label: "AI Magic", icon: Sparkles, testId: "dock-ai" },
];

// ---------------------------------------------------------------------------
// Dock rail button
// ---------------------------------------------------------------------------

function DockRailButton({
  item,
  active,
  onClick,
}: {
  item: DockItem;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      data-testid={item.testId}
      data-active={active || undefined}
      onClick={onClick}
      aria-pressed={active}
      aria-label={item.label}
      title={item.label}
      className={cn(
        "group flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2 transition-all duration-150",
        active
          ? "bg-[#F0E7FD] text-[#7D2AE8]"
          : "text-[#5b5e69] hover:bg-[#F2F3F5] hover:text-[#0d0f14]",
      )}
    >
      <Icon className="h-5 w-5" />
      <span className="text-[10px] font-medium leading-none">{item.label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Drawer shell
// ---------------------------------------------------------------------------

function DrawerShell({
  title,
  subtitle,
  testId,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  testId: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.aside
      data-testid={testId}
      initial={{ x: -320, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -320, opacity: 0 }}
      transition={{ type: "tween", duration: 0.2, ease: "easeOut" }}
      className="absolute left-full top-0 z-30 flex h-full w-[320px] flex-shrink-0 flex-col border-r border-black/5 bg-white shadow-[8px_0_24px_rgba(0,0,0,0.06)]"
    >
      <div className="flex items-center justify-between border-b border-black/5 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-[#0d0f14]">{title}</h2>
          {subtitle && <p className="truncate text-xs text-[#8a8f9c]">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-[#8a8f9c] transition-colors hover:bg-[#F2F3F5] hover:text-[#0d0f14]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
    </motion.aside>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function CategoryHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-[#8a8f9c] first:mt-0">
      {children}
    </h3>
  );
}

function HintNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 rounded-lg bg-[#FAF7FE] px-3 py-2 text-xs text-[#7D2AE8]">
      {children}
    </p>
  );
}

function InsertRow({
  label,
  description,
  disabled,
  onClick,
  testId,
}: {
  label: string;
  description?: string;
  disabled?: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full items-center gap-3 rounded-xl border border-black/5 bg-white px-3 py-2.5 text-left transition-all duration-150 hover:border-[#7D2AE8]/25 hover:bg-[#FAF7FE] disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#F2F3F5] text-[#5b5e69] transition-colors group-hover:bg-[#F0E7FD] group-hover:text-[#7D2AE8]">
        <Plus className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-[#0d0f14]">{label}</span>
        {description && (
          <span className="block truncate text-xs text-[#8a8f9c]">{description}</span>
        )}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Insert helpers (ONLY existing services — no new mutation paths)
// ---------------------------------------------------------------------------

function useDockToasts() {
  return useMyBlocksUiStore((s) => s.showToast);
}

/** Insert a section of the given library type at the end of the active page. */
function useInsertSection() {
  const showToast = useDockToasts();
  const setDockPanel = useEditorUiStore((s) => s.setDockPanel);
  return useCallback(
    (type: SectionType, name: string) => {
      const editor = useEditorStore.getState();
      const pageId = editor.selectedPageId ?? editor.project.pages[0]?.id;
      const page = editor.project.pages.find((p) => p.id === pageId);
      if (!pageId || !page) {
        showToast("No page to add to.");
        return;
      }
      const factory = new SectionFactory();
      const created = factory.create({
        type,
        existingIds: new Set(page.sections.map((s) => s.id)),
      });
      if (!created.ok) {
        showToast(created.error.message);
        return;
      }
      const result = editor.insertSection(pageId, created.section, { type: "end" });
      if (!result.ok) {
        showToast(result.error.message);
        return;
      }
      editor.selectSection(created.section.id);
      showToast(`"${name}" added to your page`);
      window.setTimeout(
        () => scrollSectionIntoView(created.section.id, { block: "center" }),
        0,
      );
      setDockPanel(null);
    },
    [showToast, setDockPanel],
  );
}

/** Insert a library element via the canonical P22-D service. */
function useInsertElement() {
  const showToast = useDockToasts();
  const setDockPanel = useEditorUiStore((s) => s.setDockPanel);
  return useCallback(
    (item: LibraryItem) => {
      const result = insertLibraryElement({ type: item.type });
      if (!result.ok) {
        showToast(result.error.message);
        return;
      }
      showToast(`"${item.label}" added to your page`);
      window.setTimeout(
        () => scrollSectionIntoView(result.sectionId, { block: "center" }),
        0,
      );
      setDockPanel(null);
    },
    [showToast, setDockPanel],
  );
}

// ---------------------------------------------------------------------------
// Templates drawer — the section library, grouped by its own categories
// ---------------------------------------------------------------------------

function TemplatesDrawerContent() {
  const insertSection = useInsertSection();
  const groups = useMemo(() => {
    const byCategory = new Map<string, typeof definitions>();
    const definitions = sectionLibraryRegistry.list();
    for (const definition of definitions) {
      const list = byCategory.get(definition.category) ?? [];
      list.push(definition);
      byCategory.set(definition.category, list);
    }
    return [...byCategory.entries()];
  }, []);

  return (
    <div>
      {groups.map(([category, definitions]) => (
        <section key={category}>
          <CategoryHeading>{category}</CategoryHeading>
          <div className="flex flex-col gap-1.5">
            {definitions.map((definition) => (
              <InsertRow
                key={definition.type}
                testId={`dock-template-${definition.type}`}
                label={definition.name}
                description={definition.description}
                onClick={() => insertSection(definition.type, definition.name)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Elements drawer — the P22-D catalog grouped by library category
// ---------------------------------------------------------------------------

function ElementsDrawerContent() {
  const insertElement = useInsertElement();
  const catalog = useMemo(() => buildLibraryCatalog(), []);
  const groups = useMemo(() => {
    const byCategory = new Map<LibraryCategoryId, LibraryItem[]>();
    for (const item of catalog) {
      const list = byCategory.get(item.category) ?? [];
      list.push(item);
      byCategory.set(item.category, list);
    }
    return [...byCategory.entries()];
  }, [catalog]);

  return (
    <div>
      <HintNote>
        Click a section on the canvas to add inside it, or pick an element to add
        as a new section.
      </HintNote>
      {groups.map(([category, items]) => (
        <section key={category}>
          <CategoryHeading>{libraryCategoryLabel(category)}</CategoryHeading>
          <div className="flex flex-col gap-1.5">
            {items.map((item) => (
              <InsertRow
                key={item.type}
                testId={`dock-element-${item.type}`}
                label={item.label}
                description={item.description}
                onClick={() => insertElement(item)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Text / Store / Media drawers — curated slices of the same catalog
// ---------------------------------------------------------------------------

function filterCatalog(
  catalog: LibraryItem[],
  types: ReadonlySet<string>,
): LibraryItem[] {
  return catalog.filter((item) => types.has(item.type));
}

function TextDrawerContent() {
  const insertElement = useInsertElement();
  const items = useMemo(
    () => filterCatalog(buildLibraryCatalog(), new Set(["heading", "paragraph"])),
    [],
  );
  return (
    <div>
      <HintNote>
        Click a section on the canvas first — text inserts inside it (or as a new
        section).
      </HintNote>
      <CategoryHeading>Text</CategoryHeading>
      <div className="flex flex-col gap-1.5">
        {items.map((item) => (
          <InsertRow
            key={item.type}
            testId={`dock-text-${item.type}`}
            label={item.label}
            description={item.description}
            onClick={() => insertElement(item)}
          />
        ))}
      </div>
    </div>
  );
}

function StoreDrawerContent() {
  const insertElement = useInsertElement();
  const items = useMemo(
    () => filterCatalog(buildLibraryCatalog(), new Set(["pricing-card", "review-card"])),
    [],
  );
  return (
    <div>
      <CategoryHeading>Commerce</CategoryHeading>
      <div className="flex flex-col gap-1.5">
        {items.map((item) => (
          <InsertRow
            key={item.type}
            testId={`dock-store-${item.type}`}
            label={item.label}
            description={item.description}
            onClick={() => insertElement(item)}
          />
        ))}
      </div>
    </div>
  );
}

function MediaDrawerContent() {
  const insertElement = useInsertElement();
  const items = useMemo(
    () => filterCatalog(buildLibraryCatalog(), new Set(["image", "video", "carousel", "logo"])),
    [],
  );
  return (
    <div>
      <CategoryHeading>Media</CategoryHeading>
      <div className="flex flex-col gap-1.5">
        {items.map((item) => (
          <InsertRow
            key={item.type}
            testId={`dock-media-${item.type}`}
            label={item.label}
            description={item.description}
            onClick={() => insertElement(item)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Magic drawer — the AI composer (former LeftSidebar chat surface)
// ---------------------------------------------------------------------------

const AI_EXAMPLES = [
  "Create a landing page for an AI productivity startup",
  "Build a luxury restaurant website for Maison Bleu",
  "Design a portfolio for a product designer named Aanya",
];

function AiDrawerContent({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState("");
  const { generate, isLoading } = useGeneration();
  const { edit, isEditing } = useAiEdit();
  const { selectedField, suggest, clearField, isBusy: inlineBusy } = useInlineEdit();
  const messages = useChatStore((s) => s.messages);
  const project = useEditorStore((s) => s.project);
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);
  const clearSelection = useEditorStore((s) => s.clearSelection);

  const selectedSection = selectedSectionId
    ? project.pages.flatMap((p) => p.sections).find((s) => s.id === selectedSectionId)
    : undefined;

  const editTarget = selectedSection
    ? {
        kind: "section" as const,
        sectionId: selectedSection.id,
        type: selectedSection.type,
        label: sectionLabel(selectedSection.type),
        props: selectedSection.props,
        context: { brandName: project.name.split(" — ")[0] || project.name },
      }
    : null;

  const isBusy = isLoading || isEditing || inlineBusy;
  const hasMessages = messages.length > 0;

  const handleSubmit = async () => {
    const prompt = input.trim();
    if (!prompt || isBusy) return;
    setInput("");
    // Phase M inline priority: an inline field selection routes to the quick
    // suggestion flow (same precedence the LeftSidebar composer used).
    if (selectedField) {
      await suggest(prompt);
      return;
    }
    if (editTarget) {
      await edit(prompt, editTarget);
      return;
    }
    await generate(prompt);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!hasMessages ? (
          <div className="flex flex-col gap-2">
            <div className="rounded-2xl bg-[#FAF7FE] px-4 py-3 text-sm leading-relaxed text-[#3a3d46]">
              Hi! I&apos;m Buildora. Describe what you want to build or change —
              I&apos;ll take care of it.
            </div>
            {AI_EXAMPLES.map((text) => (
              <button
                key={text}
                type="button"
                onClick={() => setInput(text)}
                className="w-full rounded-lg border border-black/5 bg-white px-3 py-2 text-left text-xs text-[#5b5e69] transition-colors hover:border-[#7D2AE8]/25 hover:text-[#7D2AE8]"
              >
                {text}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {messages.slice(-8).map((msg) => (
              <div
                key={msg.id}
                data-testid={msg.role === "user" ? "chat-message-user" : "chat-message-assistant"}
                className={cn(
                  "max-w-[92%] rounded-2xl px-3 py-2 text-xs leading-relaxed",
                  msg.role === "user"
                    ? "self-end bg-[#F0E7FD] text-[#3a1d5c]"
                    : msg.status === "error"
                      ? "bg-red-50 text-red-600"
                      : "bg-[#F2F3F5] text-[#3a3d46]",
                )}
              >
                {msg.status === "pending" && msg.role === "assistant" ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin text-[#7D2AE8]" />
                    Working…
                  </span>
                ) : (
                  <span className="whitespace-pre-wrap break-words">{msg.content}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {selectedSection && editTarget && !selectedField && (
          <div className="flex items-center gap-2 rounded-xl bg-[#F0E7FD] px-3 py-2 text-xs text-[#3a1d5c]">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#7D2AE8]" />
            <span className="min-w-0 flex-1 truncate">
              Editing: <span className="font-medium">{editTarget.label}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                clearSelection();
                clearField();
              }}
              aria-label="Stop editing section"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md hover:bg-white/60"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        {selectedField && (
          <div className="flex items-center gap-2 rounded-xl bg-[#F0E7FD] px-3 py-2 text-xs text-[#3a1d5c]">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#7D2AE8]" />
            <span className="min-w-0 flex-1 truncate">
              Editing: <span className="font-medium">{selectedField.label}</span>
            </span>
            <button
              type="button"
              onClick={clearField}
              aria-label="Stop editing field"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md hover:bg-white/60"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          data-testid="prompt-input"
          placeholder={
            selectedField
              ? `Ask AI to improve this ${selectedField.label.toLowerCase()}…`
              : editTarget
                ? `Describe how to edit the ${editTarget.label.toLowerCase()}…`
                : "Describe your website…"
          }
          disabled={isBusy}
          className="w-full resize-none rounded-xl border border-black/10 bg-white px-3 py-2.5 pr-10 text-sm text-[#0d0f14] placeholder:text-[#8a8f9c] focus:border-[#7D2AE8]/40 focus:outline-none focus:ring-2 focus:ring-[#7D2AE8]/10 disabled:opacity-50"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="generate-button"
            onClick={() => void handleSubmit()}
            disabled={isBusy || !input.trim()}
            className="flex h-9 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#8B3DFF] to-[#7D2AE8] text-sm font-medium text-white transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isBusy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Working…
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                {editTarget ? "Apply Edit" : "Generate"}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close AI drawer"
            title="Close"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/10 text-[#5b5e69] hover:bg-[#F2F3F5]"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const DRAWER_TITLES: Record<Exclude<DockPanel, null>, { title: string; subtitle?: string }> = {
  templates: { title: "Templates", subtitle: "Start from a ready-made section" },
  elements: { title: "Elements", subtitle: "Build your page block by block" },
  text: { title: "Text", subtitle: "Headings and body copy" },
  store: { title: "Store", subtitle: "Commerce building blocks" },
  media: { title: "Media", subtitle: "Images, video and more" },
  ai: { title: "AI Magic", subtitle: "Build and edit with AI" },
};

export function EditorDock() {
  const dockPanel = useEditorUiStore((s) => s.dockPanel);
  const toggleDockPanel = useEditorUiStore((s) => s.toggleDockPanel);
  const setDockPanel = useEditorUiStore((s) => s.setDockPanel);

  return (
    <div className="relative flex flex-shrink-0" data-testid="editor-dock">
      <nav
        data-testid="editor-dock-rail"
        aria-label="Editor tool dock"
        className="flex w-[72px] flex-shrink-0 flex-col items-stretch gap-1 border-r border-black/5 bg-white px-2 py-3"
      >
        {DOCK_ITEMS.map((item) => (
          <DockRailButton
            key={item.panel}
            item={item}
            active={dockPanel === item.panel}
            onClick={() => toggleDockPanel(item.panel)}
          />
        ))}
      </nav>

      <AnimatePresence mode="wait">
        {dockPanel !== null && (
          <DrawerShell
            key={dockPanel}
            testId={`dock-drawer-${dockPanel}`}
            title={DRAWER_TITLES[dockPanel].title}
            subtitle={DRAWER_TITLES[dockPanel].subtitle}
            onClose={() => setDockPanel(null)}
          >
            {dockPanel === "templates" && <TemplatesDrawerContent />}
            {dockPanel === "elements" && <ElementsDrawerContent />}
            {dockPanel === "text" && <TextDrawerContent />}
            {dockPanel === "store" && <StoreDrawerContent />}
            {dockPanel === "media" && <MediaDrawerContent />}
            {dockPanel === "ai" && <AiDrawerContent onClose={() => setDockPanel(null)} />}
          </DrawerShell>
        )}
      </AnimatePresence>
    </div>
  );
}
