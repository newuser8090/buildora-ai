"use client";

// ---------------------------------------------------------------------------
// My Blocks Library (Phase P5) — drag-and-drop provider
//
// ONE root DndContext wraps the whole editor shell so saved blocks can be
// dragged from the library dialog or the block browser onto canvas drop
// zones. Reuses the existing @dnd-kit dependency (no second drag engine).
//
// Rules:
//   - the drag payload is tiny: { blockId, source } — the tree is loaded once
//     from the validated library record at drag start (read-only)
//   - the canvas NEVER mutates during hover — only ONE store commit on drop,
//     routed through the canonical insertMyBlock() service
//   - drag cancel returns everything unchanged
//   - keyboard drag supported via a custom coordinate getter that cycles the
//     registered drop zones (announced for screen readers)
// ---------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { Ban, Check, Image as ImageIcon } from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { MyBlockRecord } from "../types";
import { getMyBlocksAdapter } from "../storage/my-blocks-singleton";
import { useMyBlockThumbnail } from "../thumbnails/useMyBlockThumbnail";
import {
  validateDropZone,
  type MyBlockDropZonePayload,
} from "./drop-zone-utils";

export type MyBlockDragSource = "library" | "browser";

export interface MyBlockDragData {
  /** Saved block id being dragged. */
  blockId: string;
  /** Which surface started the drag. */
  source: MyBlockDragSource;
}

interface MyBlockDragContextValue {
  dragActive: boolean;
  record: MyBlockRecord | null;
  activeZone: MyBlockDropZonePayload | null;
  zoneValid: boolean;
  zoneReason: string | null;
}

const MyBlockDragContext = createContext<MyBlockDragContextValue>({
  dragActive: false,
  record: null,
  activeZone: null,
  zoneValid: true,
  zoneReason: null,
});

export function useMyBlockDragContext(): MyBlockDragContextValue {
  return useContext(MyBlockDragContext);
}

// ---------------------------------------------------------------------------
// Keyboard coordinates — cycle through registered drop zones
// ---------------------------------------------------------------------------

const myBlockKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const { context } = args;
  const ids = Array.from(context.droppableContainers.keys()).filter(
    (id) => id !== context.active?.id,
  );
  if (ids.length === 0) return undefined;

  const currentId = context.over?.id;
  let index = currentId !== undefined ? ids.indexOf(currentId) : -1;
  if (event.key === "ArrowDown" || event.key === "ArrowRight") {
    index = (index + 1) % ids.length;
  } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
    index = (index - 1 + ids.length) % ids.length;
  } else {
    return undefined;
  }
  const targetId = ids[index];
  const rect = context.droppableRects.get(targetId);
  if (!rect) return undefined;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function MyBlockDndProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<MyBlockDragData | null>(null);
  const [record, setRecord] = useState<MyBlockRecord | null>(null);
  const [activeZone, setActiveZone] = useState<MyBlockDropZonePayload | null>(null);
  const project = useEditorStore((s) => s.project);

  // Load the record once at drag start (validated read). Corrupt records
  // leave `record` null and the drop is rejected safely. Clearing the
  // previous record when the active drag changes happens in a render-phase
  // adjustment (never synchronous setState inside an effect).
  const [prevActive, setPrevActive] = useState<MyBlockDragData | null | undefined>(undefined);
  if (prevActive !== active) {
    setPrevActive(active);
    setRecord(null);
  }
  const loadToken = useRef(0);
  useEffect(() => {
    if (!active) return;
    const token = ++loadToken.current;
    let cancelled = false;
    getMyBlocksAdapter()
      .getMyBlock(active.blockId)
      .then((result) => {
        if (cancelled || token !== loadToken.current) return;
        if (result.ok) setRecord(result.value);
      })
      .catch(() => {
        // Corrupt read → record stays null; drop rejected.
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: myBlockKeyboardCoordinates,
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as MyBlockDragData | undefined;
    if (!data?.blockId) return;
    setActive({ blockId: data.blockId, source: data.source ?? "library" });
    setActiveZone(null);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const data = event.over?.data.current as
      | { myBlockDropZone?: MyBlockDropZonePayload }
      | undefined;
    setActiveZone(data?.myBlockDropZone ?? null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const zoneData = event.over?.data.current as
        | { myBlockDropZone?: MyBlockDropZonePayload }
        | undefined;
      const zone = zoneData?.myBlockDropZone ?? null;
      const dragData = event.active.data.current as MyBlockDragData | undefined;
      const blockId = dragData?.blockId ?? active?.blockId ?? null;

      setActive(null);
      setActiveZone(null);
      setRecord(null);
      if (blockId && zone) {
        emitDropRequest(blockId, zone);
      }
    },
    [active],
  );

  const handleDragCancel = useCallback(() => {
    setActive(null);
    setActiveZone(null);
    setRecord(null);
  }, []);

  // Zone validity for the overlay (live project + dragged record).
  const zoneValidity = useMemo(() => {
    if (!activeZone) {
      return { zoneValid: true, zoneReason: null };
    }
    if (!record) {
      return { zoneValid: false, zoneReason: "Loading this saved block…" };
    }
    const result = validateDropZone(activeZone, project, record.tree);
    return result.ok
      ? { zoneValid: true, zoneReason: null }
      : { zoneValid: false, zoneReason: result.reason };
  }, [activeZone, project, record]);

  const announcements: Announcements = useMemo(
    () => ({
      onDragStart() {
        return "Saved block picked up. Use arrow keys to choose where to add it, Enter to drop, Escape to cancel.";
      },
      onDragOver({ over }) {
        if (!over) return "Move over a drop zone to add it there.";
        const data = over.data.current as
          | { myBlockDropZone?: MyBlockDropZonePayload }
          | undefined;
        return data?.myBlockDropZone
          ? `Drop zone: ${data.myBlockDropZone.label}.`
          : "Drop zone.";
      },
      onDragEnd({ over }) {
        // onDragEnd also fires for no-op drops (outside any zone / invalid
        // target) — only announce success when a drop zone was actually hit.
        const data = over?.data.current as
          | { myBlockDropZone?: MyBlockDropZonePayload }
          | undefined;
        return data?.myBlockDropZone
          ? "Saved block added to your page."
          : "Drag cancelled. Nothing changed.";
      },
      onDragCancel() {
        return "Drag cancelled. Nothing changed.";
      },
    }),
    [],
  );

  const contextValue = useMemo<MyBlockDragContextValue>(
    () => ({
      dragActive: active !== null,
      record,
      activeZone,
      zoneValid: zoneValidity.zoneValid,
      zoneReason: zoneValidity.zoneReason,
    }),
    [active, record, activeZone, zoneValidity],
  );

  return (
    <MyBlockDragContext.Provider value={contextValue}>
      <DndContext
        id="my-blocks-dnd"
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
        accessibility={{ announcements }}
        autoScroll
      >
        {children}
        <MyBlockDragOverlay />
      </DndContext>
    </MyBlockDragContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Drop handler — the ONE store-committing path for a drag drop
// ---------------------------------------------------------------------------

type DropRequestListener = (blockId: string, zone: MyBlockDropZonePayload) => void;
const dropListeners = new Set<DropRequestListener>();

function emitDropRequest(blockId: string, zone: MyBlockDropZonePayload): void {
  for (const listener of dropListeners) {
    try {
      listener(blockId, zone);
    } catch {
      // listener isolation — never break the drag teardown
    }
  }
}

/**
 * Subscribe to drag-drop requests. The subscription resolves the zone against
 * the CURRENT store state and calls the canonical insertMyBlock (one history
 * entry, atomic). Mounted once in the editor shell. Returns an unsubscribe.
 */
export function onMyBlockDrop(
  listener: DropRequestListener,
): () => void {
  dropListeners.add(listener);
  return () => {
    dropListeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// DragOverlay — lightweight (thumbnail + name + validity), never the editor
// ---------------------------------------------------------------------------

function MyBlockDragOverlay() {
  const { record, activeZone, zoneValid, zoneReason, dragActive } =
    useMyBlockDragContext();
  if (!dragActive) return null;

  return (
    <DragOverlay dropAnimation={null} zIndex={80}>
      <div
        data-testid="my-block-drag-overlay"
        className="w-48 overflow-hidden rounded-xl border border-accent/50 bg-card shadow-elevated"
        aria-hidden="true"
      >
        <div className="h-24 w-full bg-secondary">
          {record ? (
            <MyBlockOverlayThumb record={record} />
          ) : (
            <div className="flex h-full items-center justify-center text-[10px] text-text-dim">
              Loading…
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-text-primary">
            {record?.name ?? "Saved block"}
          </span>
          <span
            data-testid="my-block-drag-validity"
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold ${
              zoneValid
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-red-500/15 text-red-400"
            }`}
          >
            {zoneValid ? (
              <>
                <Check className="h-3 w-3" aria-hidden="true" />
                Valid
              </>
            ) : (
              <>
                <Ban className="h-3 w-3" aria-hidden="true" />
                No
              </>
            )}
          </span>
        </div>
        {activeZone && (
          <p
            data-testid="my-block-drag-zone-label"
            className="border-t border-border/60 px-2 py-1 text-[9px] text-text-dim"
          >
            {zoneValid ? activeZone.label : zoneReason ?? "Cannot place here"}
          </p>
        )}
      </div>
    </DragOverlay>
  );
}

function MyBlockOverlayThumb({ record }: { record: MyBlockRecord }) {
  const state = useMyBlockThumbnail(record, true);
  if (state.status === "ready" && state.objectUrl) {
    return (
      <img
        src={state.objectUrl}
        alt=""
        className="h-full w-full object-cover object-top"
        draggable={false}
      />
    );
  }
  return (
    <div className="flex h-full items-center justify-center">
      <ImageIcon className="h-6 w-6 text-text-dim/40" aria-hidden="true" />
    </div>
  );
}
