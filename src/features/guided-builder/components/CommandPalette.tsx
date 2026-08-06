// ---------------------------------------------------------------------------
// Beginner command palette (Phase N, spec §16)
//
// Plain-language commands only — internal action names are never exposed.
// Search understands synonyms. Keyboard accessible (Arrow keys + Enter +
// Escape), focus trapped, focus restored on close.
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, CornerDownLeft } from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useEditorUiStore } from "@/features/editor/ui/editor-ui-store";
import { useMyBlocksUiStore } from "@/features/my-blocks/store/my-blocks-ui-store";
import { useGuidedBuilderStore } from "../store/guided-builder-store";
import { useGuidedActions } from "../hooks/useGuidedActions";
import { EXPORT_SITE_EVENT } from "../constants";

interface PaletteCommand {
  id: string;
  label: string;
  keywords: string[];
  hint: string;
  run: () => void;
}

function buildCommands(handlers: {
  browseBlocks: (options?: { initialType?: string }) => void;
  addPage: () => void;
  setRightSidebarTab: (tab: "structure" | "design") => void;
  setViewport: (v: "desktop" | "tablet" | "mobile") => void;
  setHasPreviewedMobile: (v: boolean) => void;
  setHasExported: (v: boolean) => void;
  undo: () => void;
  askAi: (scope?: "create" | "section" | "page" | "project") => void;
  importCode: () => void;
  saveSelectedAsBlock: () => void;
  exportSelectedAsBlock: () => void;
}): PaletteCommand[] {
  return [
    {
      id: "import-code",
      label: "Import copied code",
      keywords: [
        "import",
        "paste",
        "code",
        "component",
        "html",
        "react",
        "tailwind",
        "design",
        "bring",
        "copied",
        "button",
        "section",
        "jsx",
      ],
      hint: "Turn pasted code into editable blocks",
      run: () => handlers.importCode(),
    },
    {
      id: "add-something",
      label: "Add something",
      keywords: ["block", "section", "piece", "part", "building block", "add"],
      hint: "Open the building block picker",
      run: () => handlers.browseBlocks(),
    },
    {
      id: "add-page",
      label: "Add a new page",
      keywords: ["page", "new page", "space"],
      hint: "Create a new page",
      run: () => handlers.addPage(),
    },
    {
      id: "change-colors",
      label: "Change colors",
      keywords: ["color", "colour", "theme", "look", "palette"],
      hint: "Open the design settings",
      run: () => handlers.setRightSidebarTab("design"),
    },
    {
      id: "add-button",
      label: "Add a button",
      keywords: ["button", "action", "click"],
      hint: "Add an action section",
      run: () => handlers.browseBlocks({ initialType: "cta" }),
    },
    {
      id: "add-image",
      label: "Add an image",
      keywords: ["image", "picture", "photo", "logo", "visual"],
      hint: "Browse blocks with images",
      run: () => handlers.browseBlocks({ initialType: "hero" }),
    },
    {
      id: "preview-phone",
      label: "Preview on phone",
      keywords: ["phone", "mobile", "responsive", "small screen"],
      hint: "See the mobile view",
      run: () => {
        handlers.setViewport("mobile");
        handlers.setHasPreviewedMobile(true);
      },
    },
    {
      id: "undo",
      label: "Undo my last change",
      keywords: ["undo", "back", "revert", "last change"],
      hint: "Step back one change",
      run: () => handlers.undo(),
    },
    {
      id: "ask-ai",
      label: "Ask AI for help",
      keywords: ["ai", "help", "assistant", "ask"],
      hint: "Get help from the assistant",
      run: () => handlers.askAi("create"),
    },
    {
      id: "check-website",
      label: "Check my website",
      keywords: ["check", "score", "ready", "review", "readiness", "progress"],
      hint: "Open your progress and score",
      run: () => handlers.setRightSidebarTab("structure"),
    },
    {
      id: "export-website",
      label: "Export my website",
      keywords: ["export", "download", "zip", "host", "publish"],
      hint: "Download your website files",
      run: () => {
        handlers.setHasExported(true);
        window.dispatchEvent(new CustomEvent(EXPORT_SITE_EVENT));
      },
    },
    {
      id: "open-my-blocks",
      label: "Open my saved blocks",
      keywords: ["my blocks", "saved blocks", "reusable blocks", "library", "saved pieces", "reuse a design"],
      hint: "Browse designs you saved earlier",
      run: () => useMyBlocksUiStore.getState().openLibrary(),
    },
    {
      id: "save-this-block",
      label: "Save this design to My Blocks",
      keywords: ["save block", "save this block", "save design", "reuse later", "save to library", "remember this"],
      hint: "Reuse this design in any project",
      run: () => handlers.saveSelectedAsBlock(),
    },
    {
      id: "import-saved-block",
      label: "Import a saved block file",
      keywords: ["import saved block", "import block", "block file", "buildora-block"],
      hint: "Add a block file to your library",
      run: () => useMyBlocksUiStore.getState().openImport(),
    },
    {
      id: "export-saved-block",
      label: "Export a saved block file",
      keywords: ["export block", "download block", "share block", "backup block"],
      hint: "Download one saved block as a file",
      run: () => handlers.exportSelectedAsBlock(),
    },
  ];
}

// ---------------------------------------------------------------------------
// Inner panel — owns its search state. Keyed by session so every open starts
// fresh (no setState-in-effect, no stale query).
// ---------------------------------------------------------------------------

function PalettePanel({
  commands,
  onClose,
}: {
  commands: PaletteCommand[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    const tokens = q.split(/\s+/);
    return commands.filter((cmd) => {
      const haystack = [cmd.label, ...cmd.keywords].join(" ").toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
  }, [commands, query]);

  // Focus + restore on mount/unmount.
  useEffect(() => {
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    const raf = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => {
      window.clearTimeout(raf);
      prevFocusRef.current?.focus();
      prevFocusRef.current = null;
    };
  }, []);

  const handleRun = useCallback(
    (index: number) => {
      const command = filtered[index];
      if (!command) return;
      command.run();
      onClose();
    },
    [filtered, onClose],
  );

  return (
    <div
      data-testid="command-palette"
      className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-elevated"
    >
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="h-4 w-4 text-text-dim" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              handleRun(activeIndex);
            }
          }}
          placeholder="What would you like to do?"
          aria-label="Search commands"
          className="h-11 w-full bg-transparent text-sm text-text-primary placeholder:text-text-dim/50 focus:outline-none"
        />
      </div>

      <ul role="listbox" aria-label="Commands" className="max-h-72 overflow-y-auto py-1">
        {filtered.length === 0 && (
          <li className="px-4 py-6 text-center text-xs text-text-dim">
            No command matches that.
          </li>
        )}
        {filtered.map((cmd, index) => (
          <li key={cmd.id} role="option" aria-selected={index === activeIndex}>
            <button
              type="button"
              onClick={() => handleRun(index)}
              onMouseEnter={() => setActiveIndex(index)}
              data-testid={`command-${cmd.id}`}
              className={`flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors ${
                index === activeIndex ? "bg-base" : ""
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-text-primary">{cmd.label}</span>
                <span className="block text-[11px] text-text-muted">{cmd.hint}</span>
              </span>
              {index === activeIndex && (
                <CornerDownLeft className="h-3.5 w-3.5 flex-shrink-0 text-text-dim" />
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root — owns open state + global shortcut + dialog shell
// ---------------------------------------------------------------------------

export function CommandPalette() {
  const open = useGuidedBuilderStore((s) => s.commandPaletteOpen);
  const setOpen = useGuidedBuilderStore((s) => s.setCommandPaletteOpen);
  const [session, setSession] = useState(0);

  const undo = useEditorStore((s) => s.undo);
  const addPage = useEditorStore((s) => s.addPage);
  const setViewport = useEditorStore((s) => s.setViewport);
  const setRightSidebarTab = useEditorUiStore((s) => s.setRightSidebarTab);
  const setHasPreviewedMobile = useGuidedBuilderStore((s) => s.setHasPreviewedMobile);
  const setHasExported = useGuidedBuilderStore((s) => s.setHasExported);
  const { browseBlocks, askAi } = useGuidedActions();
  const selectedPageId = useEditorStore((s) => s.selectedPageId);
  const project = useEditorStore((s) => s.project);
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);

  const importCode = useCallback(() => {
    // Phase P3 — opens the shared Import Studio.
    useEditorUiStore.getState().openCodeImportDialog(
      selectedPageId ? { pageId: selectedPageId } : null,
    );
  }, [selectedPageId]);

  // Phase P4 — save the selected custom-block section to the library.
  const saveSelectedAsBlock = useCallback(() => {
    const section = project.pages
      .flatMap((p) => p.sections)
      .find((s) => s.id === selectedSectionId);
    if (!section || section.type !== "custom-block") {
      useMyBlocksUiStore.getState().showToast(
        "Select an imported design first, then save it.",
      );
      return;
    }
    useMyBlocksUiStore.getState().openSaveDialog({ kind: "section", section });
  }, [project.pages, selectedSectionId]);

  const exportSelectedAsBlock = useCallback(() => {
    useMyBlocksUiStore.getState().openLibrary();
    useMyBlocksUiStore.getState().showToast(
      "Open a saved block and choose Export.",
    );
  }, []);

  const commands = useMemo(
    () =>
      buildCommands({
        browseBlocks,
        addPage,
        setRightSidebarTab,
        setViewport,
        setHasPreviewedMobile,
        setHasExported,
        undo,
        askAi,
        importCode,
        saveSelectedAsBlock,
        exportSelectedAsBlock,
      }),
    [
      browseBlocks,
      addPage,
      setRightSidebarTab,
      setViewport,
      setHasPreviewedMobile,
      setHasExported,
      undo,
      askAi,
      importCode,
      saveSelectedAsBlock,
      exportSelectedAsBlock,
    ],
  );

  const openPalette = useCallback(() => {
    setSession((s) => s + 1);
    setOpen(true);
  }, [setOpen]);

  const closePalette = useCallback(() => {
    setOpen(false);
  }, [setOpen]);

  // Global shortcut: Ctrl/Cmd+K (and "/" for discoverability).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openPalette]);

  // Escape closes the dialog.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closePalette();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, closePalette]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Commands"
      onClick={closePalette}
    >
      {/* Keyed remount gives every open a fresh search state */}
      <div onClick={(e) => e.stopPropagation()}>
        <PalettePanel key={session} commands={commands} onClose={closePalette} />
      </div>
    </div>
  );
}
