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
import { getMyBlocksAdapter } from "@/features/my-blocks/storage/my-blocks-singleton";
import {
  loadLibraryPreferences,
  saveLibraryPreferences,
} from "@/features/my-blocks/services/library-preferences";
import { useGuidedBuilderStore } from "../store/guided-builder-store";
import { useGuidedActions } from "../hooks/useGuidedActions";
import { EXPORT_SITE_EVENT } from "../constants";
import { usePreviewStore } from "@/features/preview/store/preview-store";
import { useLaunchCenterStore } from "@/features/launch-readiness/store/launch-center-store";
import { useSiteSettingsUiStore } from "@/features/site-settings/store/site-settings-ui-store";
import { usePublishingStore } from "@/features/publishing/store/publishing-store";
import {
  findActiveDeployment,
  safeLiveUrl,
} from "@/features/publishing/services/deployment-utils";
import { usePersonalTemplatesUiStore } from "@/features/personal-templates/store/personal-templates-ui-store";
import { useHelpUiStore } from "@/features/help/store/help-ui-store";
import { useRecoveryUiStore } from "@/features/recovery/store/recovery-ui-store";
import { getRecoveryService } from "@/features/recovery/services/recovery-service";
import {
  openCopilotPanel,
  useCopilotStore,
} from "@/features/ai-copilot/store/copilot-store";
import { openShareDialog } from "@/features/sharing/store/share-ui-store";
import { useWorkspaceAccessStore } from "@/features/workspaces/store/workspace-access-store";
import { useWorkspaceHistoryUiStore } from "@/features/workspaces/store/workspace-history-ui-store";

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
  showFavorites: () => void;
  moveToCollection: () => void;
  toggleLibraryView: () => void;
  insertRecentPiece: (placement: "below" | "end") => void;
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
      id: "open-copilot",
      label: "Open AI Copilot",
      keywords: ["ai", "copilot", "assistant", "help", "ask", "suggest", "improve", "chat", "change"],
      hint: "Ask questions or describe changes — you approve before anything applies",
      run: () => openCopilotPanel(),
    },
    {
      id: "ask-ai-about-page",
      label: "Ask AI about this page",
      keywords: ["ai", "copilot", "ask", "page", "help", "review this page", "improve page", "this page"],
      hint: "Open the Copilot focused on the page you're editing",
      run: () => {
        const editor = useEditorStore.getState();
        const pageId = editor.selectedPageId ?? editor.project.pages[0]?.id;
        if (pageId) {
          useCopilotStore.getState().setScopeChoice({ type: "page", pageId });
        }
        openCopilotPanel();
      },
    },
    {
      id: "ask-ai-about-selection",
      label: "Ask AI about this selection",
      keywords: ["ai", "copilot", "ask", "selected", "selection", "section", "part", "improve this"],
      hint: "Open the Copilot focused on the section you selected",
      run: () => {
        const editor = useEditorStore.getState();
        if (editor.selectedSectionId) {
          const pageId = editor.project.pages.find((p) =>
            p.sections.some((s) => s.id === editor.selectedSectionId),
          )?.id;
          if (pageId) {
            useCopilotStore
              .getState()
              .setScopeChoice({
                type: "section",
                pageId,
                sectionId: editor.selectedSectionId,
              });
          }
        }
        openCopilotPanel();
      },
    },
    {
      id: "check-website",
      label: "Check my website",
      keywords: ["check", "score", "ready", "review", "readiness", "progress", "is my website ready"],
      hint: "Open the Launch Center and your readiness score",
      run: () => useLaunchCenterStore.getState().openLaunchCenter(),
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
      id: "preview-website",
      label: "Preview my website",
      keywords: ["preview", "see", "visitor", "look", "website"],
      hint: "See your site the way visitors do",
      run: () => usePreviewStore.getState().openPreview("/"),
    },
    {
      id: "launch-center",
      label: "Open Launch Center",
      keywords: ["launch", "ready", "check", "publish", "finish", "go live", "is my website ready"],
      hint: "Everything you need before going live",
      run: () => useLaunchCenterStore.getState().openLaunchCenter(),
    },
    {
      id: "site-settings",
      label: "Open site settings",
      keywords: ["settings", "site name", "name", "description", "setup"],
      hint: "Site name, description, and language",
      run: () => useSiteSettingsUiStore.getState().openDialog("basics"),
    },
    {
      id: "seo-settings",
      label: "Search and sharing settings",
      keywords: ["seo", "google", "search", "social", "share", "meta", "preview"],
      hint: "Google title, description, and share card",
      run: () => useSiteSettingsUiStore.getState().openDialog("search"),
    },
    {
      id: "publish-website",
      label: "Publish my website",
      keywords: ["publish", "go live", "launch", "deploy", "live", "put my site online", "live link", "host", "publish updates", "update"],
      hint: "Choose where your site goes",
      run: () => usePublishingStore.getState().openPublishDialog(),
    },
    {
      id: "deployment-history",
      label: "View publish history",
      keywords: ["history", "deployments", "versions", "previous publish", "rollback", "manage publishing"],
      hint: "See every version you've published",
      run: () => usePublishingStore.getState().openHistory(),
    },
    {
      id: "open-live-site",
      label: "Open my live site",
      keywords: ["open live", "live site", "my site", "website", "view live", "open published"],
      hint: "Open the published version of your site",
      run: () => {
        const active = findActiveDeployment(usePublishingStore.getState().deployments);
        const url = active ? safeLiveUrl(active) : null;
        if (url) {
          window.open(url, "_blank", "noopener,noreferrer");
        } else {
          usePublishingStore.getState().openPublishDialog();
        }
      },
    },
    {
      id: "share-website",
      label: "Share this website",
      keywords: ["share", "review link", "share link", "send link", "get feedback", "review", "share with someone"],
      hint: "Create a read-only review link to share with anyone",
      run: () => openShareDialog("create"),
    },
    {
      id: "manage-review-links",
      label: "Manage review links",
      keywords: ["manage links", "review links", "share links", "revoke", "stop sharing", "expire", "regenerate"],
      hint: "Copy, stop, or renew your review links",
      run: () => openShareDialog("create"),
    },
    {
      id: "review-feedback",
      label: "Review feedback",
      keywords: ["feedback", "comments", "review", "what reviewers said", "feedback from viewers", "messages"],
      hint: "Read, resolve, or delete feedback from reviewers",
      run: () => openShareDialog("feedback"),
    },
    {
      id: "copy-live-link",
      label: "Copy my live link",
      keywords: ["copy link", "copy url", "share link", "live link", "copy live"],
      hint: "Copy the link to your published site",
      run: () => {
        const active = findActiveDeployment(usePublishingStore.getState().deployments);
        const url = active ? safeLiveUrl(active) : null;
        if (url) {
          void navigator.clipboard
            .writeText(url)
            .then(() => usePublishingStore.getState().notifyCopy("Link copied."))
            .catch(() => {
              // No silent failure — surface the copy target instead.
              usePublishingStore.getState().notifyCopy("Copy failed — open the site to copy it manually.");
            });
        } else {
          usePublishingStore.getState().openPublishDialog();
        }
      },
    },
    {
      id: "connect-custom-domain",
      label: "Connect a custom domain",
      keywords: ["domain", "custom domain", "own domain", "connect domain", "example.com", "dns", "website address"],
      hint: "Use your own address, like example.com",
      run: () => {
        usePublishingStore.getState().openPublishDialog();
        usePublishingStore.getState().openDomainDialog();
      },
    },
    {
      id: "check-domain",
      label: "Check my domain status",
      keywords: ["domain", "check domain", "dns", "verify", "connection", "domain status"],
      hint: "See if your domain is connected yet",
      run: () => {
        usePublishingStore.getState().openPublishDialog();
        usePublishingStore.getState().openDomainDialog();
      },
    },
    {
      id: "rollback-deployment",
      label: "Restore an older published version",
      keywords: ["rollback", "restore", "older version", "previous version", "go back", "revert publish"],
      hint: "Restore a previous deployment",
      run: () => usePublishingStore.getState().openHistory(),
    },
    {
      id: "save-as-template",
      label: "Save this website as a template",
      keywords: ["template", "save template", "reuse", "save this design", "personal template", "starting point"],
      hint: "Reuse this project as your own private template",
      run: () => usePersonalTemplatesUiStore.getState().openSaveDialog(useEditorStore.getState().project),
    },
    {
      id: "keyboard-shortcuts",
      label: "Show keyboard shortcuts",
      keywords: ["shortcuts", "keys", "help", "keyboard", "hotkeys"],
      hint: "See every shortcut that actually exists",
      run: () => useHelpUiStore.getState().openShortcutsDialog(),
    },
    {
      id: "open-version-history",
      label: "Open version history",
      keywords: ["history", "versions", "version history", "previous version", "restore version", "older version", "changes"],
      hint: "Browse, preview, and restore saved versions",
      run: () => {
        if (useWorkspaceAccessStore.getState().workspaceId) {
          useWorkspaceHistoryUiStore.getState().openDialog("versions");
        }
      },
    },
    {
      id: "save-version",
      label: "Save a version",
      keywords: ["version", "checkpoint", "save version", "snapshot", "mark this point", "save a version"],
      hint: "Create a version checkpoint of this project",
      run: () => {
        if (useWorkspaceAccessStore.getState().workspaceId) {
          useWorkspaceHistoryUiStore.getState().openDialog("versions");
        }
      },
    },
    {
      id: "backups",
      label: "Open backups and recovery",
      keywords: ["backup", "recovery", "restore backup", "undo save", "backups", "last known good"],
      hint: "See saved backups of this project",
      run: () =>
        useRecoveryUiStore.getState().openRecovery(useEditorStore.getState().project.id),
    },
    {
      id: "back-up-now",
      label: "Save a backup now",
      keywords: ["backup", "snapshot", "save backup", "back up now"],
      hint: "Create a backup of the current version",
      run: () => {
        const store = useEditorStore.getState();
        void getRecoveryService()
          .capture({
            project: store.project,
            revision: store.revision,
            reason: "manual",
            force: true,
          })
          .then((result) => {
            if (result.ok && !result.skipped) {
              useRecoveryUiStore.getState().openRecovery(store.project.id);
            }
          });
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
      label: "Export saved blocks",
      keywords: ["export block", "download block", "share block", "backup block"],
      hint: "Download saved blocks as files",
      run: () => handlers.exportSelectedAsBlock(),
    },
    {
      id: "show-favorites",
      label: "Show my favorite pieces",
      keywords: ["favorite", "starred", "favourites", "favorites"],
      hint: "Open your starred saved blocks",
      run: () => handlers.showFavorites(),
    },
    {
      id: "move-to-collection",
      label: "Move pieces into a collection",
      keywords: ["collection", "folder", "organize", "group", "move"],
      hint: "Organize saved blocks into folders",
      run: () => handlers.moveToCollection(),
    },
    {
      id: "import-block-collection",
      label: "Import a saved-blocks file",
      keywords: ["import blocks", "blocks file", "buildora-blocks", "bulk import"],
      hint: "Add a collection of saved blocks",
      run: () => useMyBlocksUiStore.getState().openImport(),
    },
    {
      id: "toggle-library-view",
      label: "Switch My Blocks between grid and list",
      keywords: ["view", "grid", "list", "layout", "switch"],
      hint: "Change how saved blocks are shown",
      run: () => handlers.toggleLibraryView(),
    },
    {
      id: "insert-recent-below",
      label: "Insert a recently used piece below",
      keywords: ["insert piece", "reuse below", "add below", "recent piece"],
      hint: "Add your most recently used saved block below",
      run: () => handlers.insertRecentPiece("below"),
    },
    {
      id: "insert-recent-end",
      label: "Insert a recently used piece at the end",
      keywords: ["insert piece", "reuse at end", "add at end", "recent piece"],
      hint: "Add your most recently used saved block at the end of the page",
      run: () => handlers.insertRecentPiece("end"),
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
      "Choose pieces, then select and Export.",
    );
  }, []);

  // Phase P5 — deterministic command-palette routing through canonical
  // stores/services. No speculative behavior — each command does one thing.
  const showFavorites = useCallback(() => {
    const prefs = loadLibraryPreferences();
    saveLibraryPreferences({ ...prefs, section: "favorites" });
    useMyBlocksUiStore.getState().openLibrary();
  }, []);

  const moveToCollection = useCallback(() => {
    const prefs = loadLibraryPreferences();
    saveLibraryPreferences({ ...prefs, section: "collections" });
    useMyBlocksUiStore.getState().openLibrary();
    useMyBlocksUiStore.getState().showToast(
      "Choose pieces, then select them and choose Move.",
    );
  }, []);

  const toggleLibraryView = useCallback(() => {
    const prefs = loadLibraryPreferences();
    const next = prefs.view === "grid" ? "list" : "grid";
    saveLibraryPreferences({ ...prefs, view: next });
    useMyBlocksUiStore.getState().showToast(
      `My Blocks view switched to ${next} view`,
    );
  }, []);

  const insertRecentPiece = useCallback((placement: "below" | "end") => {
    void (async () => {
      const result = await getMyBlocksAdapter().listMyBlocks();
      if (!result.ok || result.value.length === 0) {
        useMyBlocksUiStore
          .getState()
          .showToast("Save a block first, then insert it.");
        return;
      }
      // Most recently used first, then most recently saved (deterministic).
      const block = [...result.value].sort(
        (a, b) =>
          (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "") ||
          b.updatedAt.localeCompare(a.updatedAt) ||
          a.id.localeCompare(b.id),
      )[0];
      useMyBlocksUiStore.getState().openPlacementPicker(block);
      useMyBlocksUiStore.getState().showToast(
        placement === "below"
          ? "Choose “Below selected part” to add it."
          : "Choose “End of page” to add it.",
      );
    })();
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
        showFavorites,
        moveToCollection,
        toggleLibraryView,
        insertRecentPiece,
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
      showFavorites,
      moveToCollection,
      toggleLibraryView,
      insertRecentPiece,
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
