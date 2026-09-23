"use client";

// ---------------------------------------------------------------------------
// SelectionOverlay (Phase P22-B) — editor-only transform surface
//
// Renders a bounding box around the selected element with 8 resize handles, a
// rotation handle, a move affordance, and a dimensions chip. It is an overlay
// AROUND the canonical renderer — never an alternate renderer. The container
// is pointer-events:none so element content stays fully interactive; only the
// handles/box edges capture pointer events.
//
// All coordinates are LOGICAL canvas units within the scroll container; the
// overlay is rendered inside the scaled frame so CSS pixels == logical px.
//
// Stage 1 (light shell): the heavy right-hand properties sidebar collapses
// into a minimal toggleable drawer, so the canvas hosts a FLOATING CONTEXTUAL
// TOOLBAR directly above the selection box:
//   - text-capable targets: font family, size, color, bold, alignment,
//     layers, delete;
//   - widgets/containers (and composite sets): background, radius,
//     Action/Behavior, layers, delete.
// Every control commits through the same validated inspector field path the
// right-hand inspector uses (one atomic history entry per change) — the
// toolbar is chrome over the existing commit boundary, never a second one.
// ---------------------------------------------------------------------------

import { memo, useState } from "react";
import type { ElementRect, ResizeHandle, Point } from "../engine/geometry";
import { RESIZE_HANDLES } from "../engine/geometry";
import type { LayerAction } from "../engine/layering";
import {
  FONT_FAMILY_OPTIONS,
  interactionField,
} from "@/features/elements/inspector/fields";
import { InteractionField } from "@/features/inspector/components/controls/InteractionField";
import type {
  InspectorFieldDef,
  InspectorResolvedValue,
} from "@/features/elements/inspector/types";
import type { Page } from "@/types/project";
import type { ElementTree } from "@/features/elements/types";

const HANDLE_SIZE = 8;

const HANDLE_POSITION: Record<
  ResizeHandle,
  { left?: string; top?: string; right?: string; bottom?: string; transform?: string }
> = {
  nw: { left: "-4px", top: "-4px" },
  n: { left: "50%", top: "-4px", transform: "translateX(-50%)" },
  ne: { right: "-4px", top: "-4px" },
  e: { right: "-4px", top: "50%", transform: "translateY(-50%)" },
  se: { right: "-4px", bottom: "-4px" },
  s: { left: "50%", bottom: "-4px", transform: "translateX(-50%)" },
  sw: { left: "-4px", bottom: "-4px" },
  w: { left: "-4px", top: "50%", transform: "translateY(-50%)" },
};

// ---------------------------------------------------------------------------
// Toolbar style atoms (light shell — white chrome over the artboard)
// ---------------------------------------------------------------------------

const TOOLBAR_FIELD =
  "h-7 rounded-md border border-black/10 bg-white px-1.5 text-xs text-[#0d0f14] " +
  "transition-colors hover:border-[#7D2AE8]/30 focus:border-[#7D2AE8]/40 focus:outline-none";
const TOOLBAR_ICON =
  "flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[#5b5e69] transition-colors hover:bg-[#F2F3F5] hover:text-[#0d0f14]";
const TOOLBAR_ICON_ACTIVE = "bg-[#F0E7FD] text-[#7D2AE8]";
const TOOLBAR_DIVIDER = <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-black/10" />;

export interface FloatingToolbarApi {
  /** Resolved values for the fields this toolbar edits (by field id). */
  values: Record<string, InspectorResolvedValue | undefined>;
  /** True when the target is text-capable (typography variant). */
  isText: boolean;
  /** Commit one validated inspector field change (single history entry). */
  commitField: (field: InspectorFieldDef, value: unknown) => boolean;
  /** Reset a field (delete the base key / clear the override) — one entry. */
  resetField: (field: InspectorFieldDef) => boolean;
  /** Pages for link targets in the interaction editor. */
  pages: Page[];
  /** The section's element tree (context for the interaction editor). */
  tree: ElementTree;
  sectionId: string;
}

export interface SelectionOverlayProps {
  /** Bounding rect in logical canvas units. */
  rect: ElementRect;
  /** Current rotation in degrees (drives the box transform). */
  rotation?: number;
  /** True when the transform handles should be rendered (durable geometry). */
  manipulable: boolean;
  /** Data id placed on the box for tests. */
  elementId: string;
  /**
   * P27 Slice 2 (D7): count of selected elements. 1 (default) renders the
   * byte-identical single-element box with handles; ≥2 renders the COMPOSITE
   * box — union rect, count chip, move affordance, NO resize/rotate handles
   * (multi-resize is out of scope).
   */
  selectionCount?: number;
  onMoveStart?: (point: Point) => void;
  onRotateStart?: (point: Point) => void;
  onHandleStart?: (handle: ResizeHandle, point: Point) => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  /**
   * P28 Slice 1 (D1): layer ordering affordances — wired by the layer for
   * element/composite selections. Absent on the section-root box (page-level
   * section ordering owns the root surface).
   */
  onLayerAction?: (action: LayerAction) => void;
  /**
   * P28 Slice 1 (REQ-1): per-action boundary flags — the action is a no-op at
   * the corresponding sibling-stack boundary and the button reflects it.
   */
  layerBoundaries?: { atFront?: boolean; atBack?: boolean };
  /**
   * Stage 1 (light shell): the floating contextual toolbar context. Absent on
   * the section-root box (the section keeps its inspector surface) and when
   * no element target is inspected.
   */
  toolbar?: FloatingToolbarApi;
}

/** P28 Slice 1 (D1): the layer-order cluster — one button per action. */
const LAYER_ACTIONS: Array<{
  action: LayerAction;
  testId: string;
  label: string;
  disabledBy: "atFront" | "atBack" | null;
  icon: React.ReactNode;
}> = [
  {
    action: "front",
    testId: "canvas-layer-front",
    label: "Bring to Front",
    disabledBy: "atFront",
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        {/* Box rising above a stack (Figma-style bring-to-front glyph). */}
        <rect x="8" y="3" width="13" height="13" rx="2" />
        <path d="M16 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h3" />
      </svg>
    ),
  },
  {
    action: "forward",
    testId: "canvas-layer-forward",
    label: "Move Forward",
    disabledBy: "atFront",
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="9" y="9" width="12" height="12" rx="2" />
        <path d="M15 5l4 4-4 4" />
      </svg>
    ),
  },
  {
    action: "backward",
    testId: "canvas-layer-backward",
    label: "Move Backward",
    disabledBy: "atBack",
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="12" height="12" rx="2" />
        <path d="M9 19l-4-4 4-4" />
      </svg>
    ),
  },
  {
    action: "back",
    testId: "canvas-layer-back",
    label: "Send to Back",
    disabledBy: "atBack",
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        {/* Box sinking beneath a stack (Figma-style send-to-back glyph). */}
        <rect x="3" y="8" width="13" height="13" rx="2" />
        <path d="M8 8V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-3" />
      </svg>
    ),
  },
];

/**
 * Shared layer-order cluster. Always mounts under the `canvas-layer-actions`
 * testid — inside the contextual toolbar when one is present, standalone
 * above the box otherwise — so callers resolve ONE stable surface.
 */
function LayerButtons({
  onLayerAction,
  layerBoundaries,
}: {
  onLayerAction: (action: LayerAction) => void;
  layerBoundaries?: { atFront?: boolean; atBack?: boolean };
}) {
  return (
    <div
      data-testid="canvas-layer-actions"
      className="flex items-center gap-1"
    >
      {LAYER_ACTIONS.map(({ action, testId, label, disabledBy, icon }) => {
        const disabled =
          (disabledBy === "atFront" && layerBoundaries?.atFront) ||
          (disabledBy === "atBack" && layerBoundaries?.atBack);
        return (
          <button
            key={action}
            type="button"
            data-testid={testId}
            data-action={action}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[#5b5e69] transition-colors hover:bg-[#F2F3F5] hover:text-[#0d0f14] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
            disabled={disabled}
            aria-label={label}
            title={label}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (disabled) return;
              onLayerAction(action);
            }}
          >
            {icon}            </button>
          );
        })}
    </div>
  );
}

/** Text-variant toolbar: font family, size, color, bold, alignment. */
function TextToolbarControls({ api }: { api: FloatingToolbarApi }) {
  const fontFamily = typographyFieldOf(api, "fontFamily");
  const fontSize = typographyFieldOf(api, "fontSize");
  const fontWeight = typographyFieldOf(api, "fontWeight");
  const textAlign = typographyFieldOf(api, "textAlign");
  const color = typographyFieldOf(api, "color");
  const resolved = (id: string) => api.values[id]?.value;
  const commit = (field: InspectorFieldDef | null, value: unknown) =>
    field ? api.commitField(field, value) : false;

  return (
    <>
      {fontFamily && (
        <select
          data-testid="canvas-toolbar-font"
          aria-label="Font family"
          title="Font family"
          className={`${TOOLBAR_FIELD} max-w-[120px]`}
          value={String(resolved("fontFamily") ?? "")}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => commit(fontFamily, e.target.value)}
        >
          {FONT_FAMILY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )}
      {fontSize && (
        <input
          data-testid="canvas-toolbar-font-size"
          aria-label="Font size"
          title="Font size (px)"
          type="number"
          min={fontSize.min}
          max={fontSize.max}
          className={`${TOOLBAR_FIELD} w-14`}
          value={String(resolved("fontSize") ?? "")}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => commit(fontSize, e.target.value === "" ? undefined : Number(e.target.value))}
        />
      )}
      {color && (
        <label
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-black/10 transition-colors hover:border-[#7D2AE8]/30"
          title="Text color"
          aria-label="Text color"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <input
            data-testid="canvas-toolbar-color"
            type="color"
            className="h-4 w-4 cursor-pointer appearance-none rounded border-0 bg-transparent p-0"
            value={normalizeColorInput(resolved("color"))}
            onChange={(e) => commit(color, e.target.value)}
          />
        </label>
      )}
      {fontWeight && (
        <button
          type="button"
          data-testid="canvas-toolbar-bold"
          aria-label="Bold"
          title="Bold"
          aria-pressed={String(resolved("fontWeight") ?? "") === "700"}
          className={`${TOOLBAR_ICON} font-bold ${String(resolved("fontWeight") ?? "") === "700" ? TOOLBAR_ICON_ACTIVE : ""}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            commit(
              fontWeight,
              String(resolved("fontWeight") ?? "") === "700" ? "400" : "700",
            );
          }}
        >
          B
        </button>
      )}
      {textAlign && (
        <select
          data-testid="canvas-toolbar-align"
          aria-label="Text alignment"
          title="Text alignment"
          className={`${TOOLBAR_FIELD} w-[76px]`}
          value={String(resolved("textAlign") ?? "left")}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => commit(textAlign, e.target.value)}
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
          <option value="justify">Justify</option>
        </select>
      )}
    </>
  );
}

function typographyFieldOf(
  api: FloatingToolbarApi,
  id: string,
): InspectorFieldDef | null {
  // Field defs are shared module constants; the toolbar only needs their
  // identity + bounds, rebuilt here to keep the overlay decoupled from the
  // per-type schema (a text-capable type always exposes these five fields).
  switch (id) {
    case "fontFamily":
      return {
        id: "fontFamily", label: "Font", kind: "font-family",
        source: "style", key: "fontFamily", responsiveCapable: true,
      };
    case "fontSize":
      return {
        id: "fontSize", label: "Size", kind: "number",
        source: "style", key: "fontSize", responsiveCapable: true,
        unit: "px", min: 6, max: 200, step: 1,
      };
    case "fontWeight":
      return {
        id: "fontWeight", label: "Weight", kind: "segmented",
        source: "style", key: "fontWeight", responsiveCapable: true,
      };
    case "textAlign":
      return {
        id: "textAlign", label: "Alignment", kind: "alignment",
        source: "style", key: "textAlign", responsiveCapable: true,
      };
    case "color":
      return {
        id: "color", label: "Text color", kind: "color",
        source: "style", key: "color", responsiveCapable: true,
      };
    case "backgroundColor":
      return {
        id: "backgroundColor", label: "Background", kind: "color",
        source: "style", key: "backgroundColor", responsiveCapable: true,
      };
    case "borderRadius":
      return {
        id: "borderRadius", label: "Radius", kind: "radius",
        source: "style", key: "borderRadius", responsiveCapable: true,
        min: 0, max: 200, step: 1,
      };
    default:
      return null;
  }
}

/** Normalize any CSS color into a #rrggbb the native picker accepts. */
function normalizeColorInput(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }
  return "#000000";
}

/** Widget/container-variant toolbar: background, radius, Action/Behavior. */
function WidgetToolbarControls({ api }: { api: FloatingToolbarApi }) {
  const backgroundColor = typographyFieldOf(api, "backgroundColor");
  const borderRadius = typographyFieldOf(api, "borderRadius");
  const resolved = (id: string) => api.values[id]?.value;
  const interaction = interactionField();
  const commit = (field: InspectorFieldDef | null, value: unknown) =>
    field ? api.commitField(field, value) : false;
  const [actionOpen, setActionOpen] = useState(false);

  return (
    <>
      {backgroundColor && (
        <label
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-black/10 transition-colors hover:border-[#7D2AE8]/30"
          title="Background color"
          aria-label="Background color"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <input
            data-testid="canvas-toolbar-background"
            type="color"
            className="h-4 w-4 cursor-pointer appearance-none rounded border-0 bg-transparent p-0"
            value={normalizeColorInput(resolved("backgroundColor"))}
            onChange={(e) => commit(backgroundColor, e.target.value)}
          />
        </label>
      )}
      {borderRadius && (
        <select
          data-testid="canvas-toolbar-radius"
          aria-label="Border radius"
          title="Border radius"
          className={`${TOOLBAR_FIELD} w-[64px]`}
          value={String(resolved("borderRadius") ?? "0")}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) =>
            // "None" is a true RESET: commitField cannot express the reset
            // (the radius validator rejects `undefined`), so it routes through
            // the inspector's reset path which deletes the style key.
            e.target.value === "0"
              ? api.resetField(borderRadius)
              : commit(borderRadius, e.target.value)
          }
        >
          <option value="0">None</option>
          <option value="4px">4px</option>
          <option value="8px">8px</option>
          <option value="12px">12px</option>
          <option value="20px">20px</option>
          <option value="9999px">Pill</option>
        </select>
      )}
      <button
        type="button"
        data-testid="canvas-toolbar-action"
        aria-label="Action / Behavior"
        title="Action / Behavior"
        aria-expanded={actionOpen}
        className={`${TOOLBAR_ICON} ${resolved("interaction") ? TOOLBAR_ICON_ACTIVE : ""}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setActionOpen((v) => !v);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
        </svg>
      </button>
      {/* Action / Behavior popout — the P22-G interaction editor over the
          same validated field path (one atomic commit). */}
      {actionOpen && (
        <div
          data-testid="canvas-toolbar-interaction-popout"
          className="absolute left-0 top-full z-50 mt-1.5 w-[280px] rounded-xl border border-black/10 bg-white p-3 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <InteractionField
            field={interaction}
            value={resolved("interaction") ?? null}
            pages={api.pages}
            tree={api.tree}
            sectionId={api.sectionId}
            onCommit={(next) => api.commitField(interaction, next)}
          />
        </div>
      )}
    </>
  );
}



export const SelectionOverlay = memo(function SelectionOverlay({
  rect,
  rotation = 0,
  manipulable,
  elementId,
  selectionCount = 1,
  onMoveStart,
  onRotateStart,
  onHandleStart,
  onDuplicate,
  onDelete,
  onLayerAction,
  layerBoundaries,
  toolbar,
}: SelectionOverlayProps) {
  const dims = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
  const composite = selectionCount > 1;
  const showToolbar = toolbar !== undefined;

  return (
    <div
      data-testid="canvas-selection-box"
      data-element-id={elementId}
      data-selection-count={composite ? selectionCount : undefined}
      className="pointer-events-none absolute z-30"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        transform: `rotate(${rotation}deg)`,
        transformOrigin: "center",
      }}
    >
      {/* Outline */}
      <div
        className="absolute inset-0 rounded-[2px] border-2 border-[#7D2AE8]"
        style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.7)" }}
        aria-hidden="true"
      />

      {/* Composite count chip (P27 D7) — union dims + selected count. */}
      {composite && (
        <div
          data-testid="canvas-selection-count"
          className="absolute -bottom-7 left-0 rounded-md bg-[#1a2235] px-2 py-0.5 font-mono text-[11px] font-medium text-white shadow-sm"
          style={{ pointerEvents: "none" }}
        >
          {`${selectionCount} selected · ${dims}`}
        </div>
      )}

      {/* Move affordance: a thin grab strip along the top edge */}
      <div
        data-testid="canvas-move-handle"
        className="absolute -top-2 left-1/2 h-2 w-1/2 -translate-x-1/2 cursor-grab rounded-t-sm bg-[#7D2AE8]/0 active:cursor-grabbing"
        style={manipulable ? { pointerEvents: "auto" } : undefined}
        onPointerDown={(e) => {
          if (!manipulable) return;
          e.stopPropagation();
          e.preventDefault();
          onMoveStart?.({ x: e.clientX, y: e.clientY });
        }}
        aria-hidden={!manipulable}
      />

      {/* Resize handles — suppressed on the composite box (no multi-resize). */}
      {manipulable && !composite &&
        RESIZE_HANDLES.map((handle) => (
          <div
            key={handle}
            data-testid={`canvas-resize-handle-${handle}`}
            className="absolute cursor-nwse-resize rounded-[2px] border border-white/80 bg-[#7D2AE8]"
            style={{
              ...HANDLE_POSITION[handle],
              width: HANDLE_SIZE,
              height: HANDLE_SIZE,
              pointerEvents: "auto",
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onHandleStart?.(handle, { x: e.clientX, y: e.clientY });
            }}
          />
        ))}

      {/* Rotation handle — suppressed on the composite box. */}
      {manipulable && !composite && (
        <div
          data-testid="canvas-rotate-handle"
          className="absolute -top-9 left-1/2 cursor-grab rounded-full border border-white/80 bg-[#7D2AE8]"
          style={{
            width: 10,
            height: 10,
            transform: "translateX(-50%)",
            pointerEvents: "auto",
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onRotateStart?.({ x: e.clientX, y: e.clientY });
          }}
        />
      )}

      {/* Dimensions chip */}
      <div
        data-testid="canvas-selection-dims"
        className="absolute -bottom-7 left-0 rounded-md bg-[#1a2235] px-2 py-0.5 font-mono text-[11px] font-medium text-white shadow-sm"
        style={{ pointerEvents: "none" }}
      >
        {dims}
      </div>

      {/* Stage 1 — FLOATING CONTEXTUAL TOOLBAR. Sits directly above the
          selection box (below the rotate handle plane). Every control stops
          propagation so chrome never rewrites the selection it edits, and
          commits through the inspector field path (one history entry). */}
      {showToolbar && toolbar && (
        <div
          data-testid="canvas-floating-toolbar"
          className="absolute -top-[64px] left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-black/10 bg-white px-1.5 py-1 shadow-[0_6px_20px_rgba(0,0,0,0.10)]"
          style={{ pointerEvents: "auto" }}
        >
          {toolbar.isText ? (
            <TextToolbarControls api={toolbar} />
          ) : (
            <WidgetToolbarControls api={toolbar} />
          )}
          {TOOLBAR_DIVIDER}
          {onLayerAction && (
            <LayerButtons onLayerAction={onLayerAction} layerBoundaries={layerBoundaries} />
          )}
          {onDelete && (
            <button
              type="button"
              data-testid="canvas-delete"
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[#5b5e69] transition-colors hover:bg-red-50 hover:text-red-500"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              aria-label="Delete"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* P28 Slice 1 (D1) fallback: when no toolbar context exists (e.g.
          section-root box or a target without inspector context) the layer
          cluster still renders standalone so layer ordering stays reachable. */}
      {!showToolbar && onLayerAction && (
        <div
          className="absolute -top-7 right-0 flex items-center gap-1 rounded-md bg-[#1a2235] py-0.5 pl-1.5 pr-1.5 shadow-sm"
          style={{ pointerEvents: "auto", transform: "translateX(calc(-100% - 16px))" }}
        >
          <LayerButtons onLayerAction={onLayerAction} layerBoundaries={layerBoundaries} />
        </div>
      )}

      {/* Quick actions — duplicate lives beside the delete button whenever the
          contextual toolbar is present; falls back to the classic dark chip
          cluster when it is not. */}
      {showToolbar ? (
        onDuplicate ? (
          <button
            type="button"
            data-testid="canvas-duplicate"
            className="pointer-events-auto absolute -top-7 right-0 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-white text-[#5b5e69] shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-colors hover:text-[#7D2AE8]"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
            aria-label="Duplicate"
            title="Duplicate"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        ) : null
      ) : (
        <div
          className="absolute -top-7 right-0 flex items-center gap-1 rounded-md bg-[#1a2235] px-1.5 py-0.5 shadow-sm"
          style={{ pointerEvents: "auto" }}
        >
          {onDuplicate && (
            <button
              type="button"
              data-testid="canvas-duplicate"
              className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-white/90 hover:bg-white/20"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate();
              }}
              aria-label="Duplicate"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              data-testid="canvas-delete"
              className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-white/90 hover:bg-white/20 hover:text-red-300"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              aria-label="Delete"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
});
