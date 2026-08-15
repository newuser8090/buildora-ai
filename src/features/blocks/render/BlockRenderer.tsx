"use client";

// ---------------------------------------------------------------------------
// BlockRenderer — native rendering of BlockTree nodes (Phase P3)
//
// Renders the persisted BlockTree through the existing Phase O block registry
// semantics. Used by:
//   - the editor canvas (CustomBlockSection)
//   - thumbnail generation (read-only)
//   - the Import Studio visual preview (read-only)
//
// Security posture:
//   - never executes imported code
//   - no dangerouslySetInnerHTML
//   - no event handlers derived from imported source
//   - images/links render only safe values (http(s) or relative)
//   - unknown/unsupported block types fail safely (fallback container)
// ---------------------------------------------------------------------------

import { createElement, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Star,
  Zap,
  ArrowRight,
  Mail,
  Phone,
  MapPin,
  Clock,
  Sparkles,
  Shield,
  Heart,
  Award,
  Globe,
  Menu,
  User,
  type LucideIcon,
} from "lucide-react";
import type { BlockNode, BlockTree } from "../types";
import type { Page } from "@/types/project";
import {
  performClickAction,
  presentTree,
  resolveAnimationPresentation,
  resolveInteractionPresentation,
  type ResolvedClickAction,
} from "@/features/elements/interactions/present";
import type { ElementTree } from "@/features/elements/types";
import { blockRegistry } from "../registry/block-registry";
import { blockCss, styleTokensToCss } from "./block-style-to-css";
import { applyBlockPresentation } from "./block-presentation";
import { resolveNodeBindingProps } from "@/features/elements/binding/resolve";
import type { Collection, CollectionRecords } from "@/features/elements/collections/types";

// ---------------------------------------------------------------------------
// Safe URL policy (mirrors P1/P2)
// ---------------------------------------------------------------------------

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:", "#"]);

export function isSafeLinkUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  const trimmed = value.trim();
  if (trimmed.startsWith("/")) return true;
  try {
    const url = new URL(trimmed, "https://buildora.local");
    return SAFE_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

export function isSafeImageUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  const trimmed = value.trim();
  if (trimmed.startsWith("/")) return true;
  try {
    const url = new URL(trimmed, "https://buildora.local");
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Icon map (deterministic, curated)
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, LucideIcon> = {
  Check, Star, Zap, ArrowRight, Mail, Phone, MapPin, Clock,
  Sparkles, Shield, Heart, Award, Globe, Menu, User,
};

function resolveIcon(name: unknown): LucideIcon {
  if (typeof name !== "string") return Sparkles;
  return ICON_MAP[name] ?? Sparkles;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textOf(props: Record<string, unknown>, key = "text"): string {
  const value = props[key];
  return typeof value === "string" ? value : "";
}

function levelOf(props: Record<string, unknown>): 1 | 2 | 3 | 4 | 5 | 6 {
  const level = props.level;
  if (typeof level === "number" && level >= 1 && level <= 6) {
    return Math.round(level) as 1 | 2 | 3 | 4 | 5 | 6;
  }
  return 2;
}

// ---------------------------------------------------------------------------
// Inline text editing (canvas only)
// ---------------------------------------------------------------------------

function EditableText({
  node,
  value,
  tag,
  onCommit,
  style,
  placeholder,
  dataAttributes,
}: {
  node: BlockNode;
  value: string;
  tag: keyof React.JSX.IntrinsicElements;
  onCommit: (nodeId: string, next: string) => void;
  style: React.CSSProperties;
  placeholder?: string;
  /** Phase P22-G — animation attributes (data-ba-anim / data-ba-reveal). */
  dataAttributes?: Record<string, string>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const committedRef = useRef<string>(value);
  const current = draft ?? value;

  const handleBlur = () => {
    if (draft !== null && draft.trim() !== committedRef.current) {
      onCommit(node.id, draft);
    }
    setDraft(null);
  };

  const Tag = tag as React.ElementType;
  return (
    <Tag
      data-block-editable="true"
      data-block-id={node.id}
      {...dataAttributes}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      style={{ ...style, outline: "none", cursor: "text" }}
      onDoubleClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        setDraft(value);
      }}
      onInput={(e: React.FormEvent<HTMLElement>) => {
        setDraft((e.target as HTMLElement).innerText);
      }}
      onKeyDown={(e: React.KeyboardEvent<HTMLElement>) => {
        if (e.key === "Enter" && (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6")) {
          e.preventDefault();
          (e.target as HTMLElement).blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(null);
          (e.target as HTMLElement).blur();
        }
        e.stopPropagation();
      }}
      onBlur={handleBlur}
      aria-label={placeholder ?? "Editable text"}
      data-placeholder={draft === null && !value ? (placeholder ?? "Add text") : undefined}
    >
      {current}
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// Block node renderer
// ---------------------------------------------------------------------------

export interface BlockRendererProps {
  tree: BlockTree;
  /** Viewport width used to resolve responsive overrides. */
  viewportWidth?: number;
  /** Selected block id (canvas selection highlight). */
  selectedBlockId?: string | null;
  /** Called when a block is clicked in the canvas. */
  onSelectBlock?: (nodeId: string) => void;
  /** Enables inline text editing (canvas only — never thumbnails/export). */
  editable?: boolean;
  /** Called when an inline text edit is committed (persist via block ops). */
  onEditText?: (nodeId: string, next: string) => void;
  /**
   * Phase P22-G — project pages used to resolve typed NavTargets into safe
   * hrefs for the NON-EDITABLE preview. When absent, navigation targets that
   * need the route table resolve inert (no dead navigations, no unsafe links).
   */
  pages?: Page[];
  /**
   * Phase P22-J — durable collection definitions + runtime records used to
   * resolve element data bindings (additive: nodes without bindings render
   * exactly as before; unresolved bindings keep their static props).
   */
  collections?: Collection[];
  records?: CollectionRecords;
}

// ---------------------------------------------------------------------------
// Scroll-reveal observer (Phase P22-G) — one IntersectionObserver per tree
//
// Elements configured with a scroll/viewport entrance carry `data-ba-reveal`.
// When they enter the viewport the `ba-reveal-in` class is added, which runs
// the (already injected) CSS animation. The observer is created lazily and
// disconnected on unmount; already-revealed ids are never re-hidden.
// ---------------------------------------------------------------------------

function useScrollReveal(
  containerRef: React.RefObject<HTMLDivElement | null>,
  tree: BlockTree,
  revealedRef: React.MutableRefObject<Set<string>>,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const target = entry.target as HTMLElement;
          target.classList.add("ba-reveal-in");
          const id = target.getAttribute("data-ba-reveal");
          if (id) revealedRef.current.add(id);
          observer.unobserve(target);
        }
      },
      { threshold: 0.15 },
    );
    container.querySelectorAll<HTMLElement>("[data-ba-reveal]").forEach((el) => {
      const id = el.getAttribute("data-ba-reveal");
      if (id && revealedRef.current.has(id)) return;
      observer.observe(el);
    });
    return () => observer.disconnect();
  }, [tree, active, revealedRef, containerRef]);
}

// ---------------------------------------------------------------------------
// Interaction content link (Phase P22-G) — non-editable preview only
//
// Wraps a content node's output in a safe interactive element when a click
// interaction is configured (navigate → real anchor so the preview shells
// intercept internal routes; scroll-to / back → keyboard-accessible
// role=link with a bounded click handler). No arbitrary user code is emitted.
// ---------------------------------------------------------------------------

function InteractiveContentLink({
  action,
  children,
}: {
  action: ResolvedClickAction;
  children: React.ReactNode;
}) {
  if (action.kind === "navigate" && action.safe && action.href) {
    if (action.resolvedKind === "back") {
      return (
        <span
          role="link"
          tabIndex={0}
          data-ba-interaction="back"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            performClickAction(action);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              performClickAction(action);
            }
          }}
        >
          {children}
        </span>
      );
    }
    // The click bubbles to the preview shell, which classifies the href and
    // navigates (internal routes in-app; external in a new tab). Never
    // stopPropagation here — that would leave the link dead in the preview.
    return (
      <a href={action.href} data-ba-interaction="navigate">
        {children}
      </a>
    );
  }
  if (action.kind === "scroll-to" && action.safe && action.scrollElementId) {
    return (
      <span
        role="link"
        tabIndex={0}
        data-ba-interaction="scroll-to"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          performClickAction(action);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            performClickAction(action);
          }
        }}
      >
        {children}
      </span>
    );
  }
  return <>{children}</>;
}

export function BlockRenderer({
  tree,
  viewportWidth = 1440,
  selectedBlockId = null,
  onSelectBlock,
  editable = false,
  onEditText,
  pages,
  collections,
  records,
}: BlockRendererProps) {
  // Phase P22-G — deterministic tree-level presentation (keyframes, hover/focus
  // rules, reduced-motion guard). Empty for trees without any animation or
  // interaction data, so existing rendering is byte-for-byte unchanged.
  const presentation = useMemo(
    () => presentTree(tree as unknown as ElementTree, pages ?? []),
    [tree, pages],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const revealedRef = useRef<Set<string>>(new Set());
  useScrollReveal(containerRef, tree, revealedRef, presentation.needsRevealObserver);

  const roots = tree.rootIds.map((rootId) => {
    const root = tree.nodes[rootId];
    if (!root) return null;
    return (
      <BlockNodeRenderer
        key={rootId}
        node={root}
        tree={tree}
        viewportWidth={viewportWidth}
        selectedBlockId={selectedBlockId}
        onSelectBlock={onSelectBlock}
        editable={editable}
        onEditText={onEditText}
        pages={pages}
        collections={collections}
        records={records}
      />
    );
  });

  // A scroll-reveal tree needs a stable container so the observer stays scoped
  // to this tree's own elements.
  if (presentation.needsRevealObserver) {
    return (
      <div ref={containerRef} data-ba-tree="1">
        {presentation.cssText && <style>{presentation.cssText}</style>}
        {roots}
      </div>
    );
  }
  return (
    <>
      {presentation.cssText && <style>{presentation.cssText}</style>}
      {roots}
    </>
  );
}

function BlockNodeRenderer({
  node,
  tree,
  viewportWidth = 1440,
  selectedBlockId,
  onSelectBlock,
  editable,
  onEditText,
  pages,
  collections,
  records,
}: BlockRendererProps & { node: BlockNode; tree: BlockTree }) {
  const definition = blockRegistry.get(node.type);
  // Phase P22-C — fold optional geometry + viewport overrides into the CSS so
  // the canvas reflects inspector/manipulation edits (additive; nodes without
  // these fields render exactly as before).
  const css = applyBlockPresentation(
    node,
    viewportWidth,
    blockCss(node.style, node.responsive, viewportWidth),
  );

  // Phase P22-G — fold the declarative animation + interaction presentation
  // into the rendered output (additive: nodes without these fields render
  // exactly as before). Animation is viewport-independent (P22-G decision 8).
  // BlockNode is structurally assignable to ElementNode (every element field
  // is optional), so the pure resolver accepts it directly.
  const animationPres = resolveAnimationPresentation(node);
  const interactionPres = resolveInteractionPresentation(node, tree, pages ?? []);
  Object.assign(css, animationPres.inlineStyle, animationPres.baseStyle, interactionPres.baseStyle);
  const previewNavigation = !editable;

  const selected = selectedBlockId === node.id;
  const children = node.children
    .map((childId) => tree.nodes[childId])
    .filter((child): child is BlockNode => !!child);

  // Phase P22-J — resolve this node's collection bindings into its props.
  // Pure + additive: unbound nodes and unresolved bindings render exactly as
  // before (static fallback). The resolved node is only used for prop reads.
  const resolvedProps = useMemo(
    () => resolveNodeBindingProps(node, { collections, records }),
    [node, collections, records],
  );

  // Phase P22-H — visibility parity with the export generator: elements with
  // visible=false or hidden=true are not rendered (mirrors the emitted
  // custom-block component's `node.visible !== false` filter). Additive —
  // every existing tree has visible=true, so rendering is unchanged. The
  // guard runs after all hooks so the hook call order stays unconditional.
  if (node.visible === false || node.hidden === true) return null;

  const wrapProps: Record<string, unknown> = {
    // Phase P22-G — the element's own id is also its scroll-to target; the
    // bounded scroll helper resolves it via getElementById (same id the
    // exported custom-block component emits for its nodes).
    id: node.id,
    "data-block-id": node.id,
    "data-block-type": node.type,
    ...animationPres.attributes,
    onClick: (e: React.MouseEvent) => {
      // Editable canvas: selection wins and the click stays within the block
      // tree. Non-editable preview: let the click bubble so the preview shell
      // can intercept safe anchors (internal routes navigate in-app).
      if (onSelectBlock) {
        e.stopPropagation();
        onSelectBlock(node.id);
      }
    },
  };

  const commitText = (nodeId: string, next: string) => {
    onEditText?.(nodeId, next);
  };

  // Selection ring (canvas only). The outline follows the element's own
  // border-radius, so a committed radius is never clobbered; a 6px ring
  // radius is only applied as a fallback when the element has none (Phase
  // P22-C — inspector radius edits must render on the canvas).
  if (selected && onSelectBlock) {
    css.outline = "2px solid var(--accent, #7c5cfc)";
    css.outlineOffset = "2px";
    if (css.borderRadius === undefined) {
      css.borderRadius = "6px";
    }
  }

  const baseChildren = (renderChild: (child: BlockNode) => React.ReactNode) =>
    children.map((child) => renderChild(child));

  const renderChild = (child: BlockNode) => (
    <BlockNodeRenderer
      key={child.id}
      node={child}
      tree={tree}
      viewportWidth={viewportWidth}
      selectedBlockId={selectedBlockId}
      onSelectBlock={onSelectBlock}
      editable={editable}
      onEditText={onEditText}
      pages={pages}
      collections={collections}
      records={records}
    />
  );

  // Content node types that may carry a click interaction. Layout/navigation
  // containers are excluded (wrapping them in an anchor would risk nested
  // anchors / document re-parenting).
  const wrapCapable =
    node.type !== "container" &&
    node.type !== "column" &&
    node.type !== "stack" &&
    node.type !== "row" &&
    node.type !== "grid" &&
    node.type !== "navbar" &&
    node.type !== "footer" &&
    node.type !== "form" &&
    node.type !== "menu" &&
    node.type !== "button" &&
    node.type !== "divider" &&
    node.type !== "spacer";
  const clickAction = interactionPres.click;
  const wrapContent = (elm: React.ReactNode): React.ReactNode => {
    if (
      previewNavigation &&
      wrapCapable &&
      clickAction &&
      clickAction.safe
    ) {
      return (
        <InteractiveContentLink action={clickAction}>{elm}</InteractiveContentLink>
      );
    }
    return elm;
  };

  // Phase P22-G — keyboard focus interactions add a tabIndex so focus effects
  // work with the keyboard in the non-editable preview.
  if (previewNavigation && interactionPres.focusable) {
    wrapProps.tabIndex = 0;
  }

  // ---- Layout blocks ----
  if (node.type === "container" || node.type === "column" || node.type === "stack") {
    return (
      <div {...wrapProps} style={css} data-testid={`block-${node.type}`}>
        {baseChildren(renderChild)}
      </div>
    );
  }

  if (node.type === "row") {
    return (
      <div {...wrapProps} style={css} data-testid="block-row">
        {baseChildren(renderChild)}
      </div>
    );
  }

  if (node.type === "grid") {
    const columns = typeof resolvedProps.columns === "number" ? resolvedProps.columns : 3;
    const gridTemplateColumns =
      typeof css.gridTemplateColumns === "string"
        ? css.gridTemplateColumns
        : `repeat(${Math.min(Math.max(columns, 1), 6)}, minmax(0, 1fr))`;
    const gridStyle: React.CSSProperties = { ...css, gridTemplateColumns };
    return (
      <div {...wrapProps} style={gridStyle} data-testid="block-grid">
        {baseChildren(renderChild)}
      </div>
    );
  }

  if (node.type === "divider") {
    return <hr {...wrapProps} style={css} data-testid="block-divider" aria-hidden="true" />;
  }

  if (node.type === "spacer") {
    return <div {...wrapProps} style={css} data-testid="block-spacer" aria-hidden="true" />;
  }

  // ---- Content blocks ----
  if (node.type === "heading") {
    const text = textOf(resolvedProps);
    const Tag = `h${levelOf(resolvedProps)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
    if (editable) {
      return (
        <EditableText
          node={node}
          value={text}
          tag={Tag}
          onCommit={commitText}
          style={css}
          placeholder="Heading"
          dataAttributes={animationPres.attributes}
        />
      );
    }
    return wrapContent(
      <Tag {...wrapProps} style={css} data-testid="block-heading">
        {text || "Heading"}
      </Tag>,
    );
  }

  if (node.type === "paragraph") {
    const text = textOf(resolvedProps);
    if (editable) {
      return (
        <EditableText
          node={node}
          value={text}
          tag="p"
          onCommit={commitText}
          style={css}
          placeholder="Text"
          dataAttributes={animationPres.attributes}
        />
      );
    }
    return wrapContent(
      <p {...wrapProps} style={css} data-testid="block-paragraph">
        {text || "Text"}
      </p>,
    );
  }

  if (node.type === "button") {
    const text = textOf(resolvedProps);
    const clickAction = interactionPres.click;
    const legacyHref = isSafeLinkUrl(resolvedProps.href) ? (resolvedProps.href as string) : null;
    // A configured interaction click wins; otherwise fall back to the legacy
    // href (unchanged for trees without interactions).
    const actionHref =
      clickAction && clickAction.safe && clickAction.kind === "navigate"
        ? (clickAction.href ?? null)
        : null;
    const actionScroll =
      clickAction && clickAction.safe && clickAction.kind === "scroll-to"
        ? (clickAction.scrollElementId ?? null)
        : null;
    const href = actionHref ?? (clickAction ? null : legacyHref);
    const style: React.CSSProperties = {
      display: "inline-block",
      textDecoration: "none",
      cursor: previewNavigation ? "pointer" : "default",
      ...css,
    };
    const content = editable ? (
      <EditableText node={node} value={text} tag="span" onCommit={commitText} style={style} placeholder="Button" dataAttributes={animationPres.attributes} />
    ) : (
      text || "Button"
    );

    // Non-editable preview (Phase P22-G): click → scroll-to becomes a real
    // anchor; click → navigate becomes a real anchor so the preview shells
    // intercept internal routes and the exported site navigates natively.
    if (previewNavigation && actionScroll) {
      return (
        <a
          href={`#${actionScroll}`}
          role="button"
          {...wrapProps}
          style={style}
          data-testid="block-button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            performClickAction(clickAction!);
          }}
        >
          {content}
        </a>
      );
    }
    if (previewNavigation && href) {
      // Non-editable preview: the anchor click bubbles to the preview shell
      // (internal routes navigate in-app; external open in a new tab). Only
      // "back" is handled inline — it has no href to classify.
      const onAnchorClick =
        clickAction?.resolvedKind === "back"
          ? (e: React.MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              performClickAction(clickAction!);
            }
          : undefined;
      return (
        <a href={href} {...wrapProps} style={style} data-testid="block-button" onClick={onAnchorClick}>
          {content}
        </a>
      );
    }
    if (href) {
      // Editable canvas — keep the href for structure, block navigation, and
      // let the click select the block (existing behavior preserved).
      return (
        <a
          href={href}
          {...wrapProps}
          style={style}
          data-testid="block-button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSelectBlock?.(node.id);
          }}
        >
          {content}
        </a>
      );
    }
    return (
      <span {...wrapProps} style={style} data-testid="block-button">
        {content}
      </span>
    );
  }

  if (node.type === "image") {
    const src = resolvedProps.src;
    const alt = typeof resolvedProps.alt === "string" ? resolvedProps.alt : "";
    const safeSrc = isSafeImageUrl(src) ? (src as string) : "";
    if (!safeSrc) {
      return (
        <div
          {...wrapProps}
          style={{
            ...css,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "96px",
            background: "var(--muted, #f5f5f5)",
            color: "var(--muted-foreground, #737373)",
            fontSize: "0.75rem",
            border: "1px dashed var(--border, #e5e5e5)",
            borderRadius: "0.5rem",
          }}
          data-testid="block-image-placeholder"
        >
          Image
        </div>
      );
    }
    // The editor preview renders user data with loading=lazy and no remote
    // optimizer; next/image is not used because dimensions vary per block.
    return wrapContent(
      // eslint-disable-next-line @next/next/no-img-element -- editor preview
      <img
        {...wrapProps}
        src={safeSrc}
        alt={alt}
        loading="lazy"
        style={css}
        data-testid="block-image"
      />,
    );
  }

  if (node.type === "video") {
    const src = resolvedProps.src;
    const safeSrc = isSafeImageUrl(src) ? (src as string) : "";
    if (!safeSrc) {
      return (
        <div
          {...wrapProps}
          style={{
            ...css,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "120px",
            background: "var(--muted, #f5f5f5)",
            color: "var(--muted-foreground, #737373)",
            fontSize: "0.75rem",
            borderRadius: "0.5rem",
          }}
          data-testid="block-video-placeholder"
        >
          Video
        </div>
      );
    }
    return wrapContent(
      <video {...wrapProps} src={safeSrc} muted playsInline style={css} data-testid="block-video" />,
    );
  }

  if (node.type === "icon") {
    // createElement keeps the resolved icon OUT of JSX position — the
    // react-hooks/static-components rule forbids components created during
    // render being used as JSX tags.
    const Icon = resolveIcon(resolvedProps.icon);
    const size = typeof resolvedProps.size === "number" ? resolvedProps.size : 24;
    return wrapContent(
      <span {...wrapProps} style={{ ...css, display: "inline-flex" }} data-testid="block-icon">
        {createElement(Icon, { size, "aria-hidden": true })}
      </span>,
    );
  }

  if (node.type === "badge") {
    const text = textOf(resolvedProps);
    if (editable) {
      return <EditableText node={node} value={text} tag="span" onCommit={commitText} style={css} placeholder="Badge" dataAttributes={animationPres.attributes} />;
    }
    return wrapContent(
      <span {...wrapProps} style={css} data-testid="block-badge">
        {text || "Badge"}
      </span>,
    );
  }

  // ---- Interactive blocks (static, safe) ----
  if (node.type === "form") {
    return (
      <form {...wrapProps} style={css} data-testid="block-form" onSubmit={(e) => e.preventDefault()}>
        {baseChildren(renderChild)}
      </form>
    );
  }

  if (node.type === "input") {
    const label = typeof resolvedProps.label === "string" ? resolvedProps.label : "Field";
    return (
      <label {...wrapProps} style={css} data-testid="block-input">
        {label}
        <input type="text" readOnly placeholder={typeof resolvedProps.placeholder === "string" ? resolvedProps.placeholder : ""} style={{ width: "100%", padding: "0.5rem 0.75rem", borderRadius: "0.375rem", border: "1px solid var(--border, #e5e5e5)", background: "var(--background, #fff)" }} />
      </label>
    );
  }

  if (node.type === "textarea") {
    const label = typeof resolvedProps.label === "string" ? resolvedProps.label : "Message";
    return (
      <label {...wrapProps} style={css} data-testid="block-textarea">
        {label}
        <textarea readOnly placeholder={typeof resolvedProps.placeholder === "string" ? resolvedProps.placeholder : ""} style={{ width: "100%", padding: "0.5rem 0.75rem", borderRadius: "0.375rem", border: "1px solid var(--border, #e5e5e5)", minHeight: "6rem", background: "var(--background, #fff)" }} />
      </label>
    );
  }

  if (node.type === "checkbox") {
    const label = typeof resolvedProps.label === "string" ? resolvedProps.label : "Checkbox";
    return (
      <label {...wrapProps} style={{ ...css, display: "flex", alignItems: "center", gap: "0.5rem" }} data-testid="block-checkbox">
        <input type="checkbox" checked={resolvedProps.checked === true} readOnly />
        {label}
      </label>
    );
  }

  if (node.type === "tabs" || node.type === "accordion") {
    return wrapContent(
      <div {...wrapProps} style={css} data-testid={`block-${node.type}`}>
        {baseChildren(renderChild)}
      </div>,
    );
  }

  // ---- Composite blocks ----
  if (node.type === "pricing-card") {
    return wrapContent(
      <div {...wrapProps} style={css} data-testid="block-pricing-card">
        {typeof resolvedProps.price === "string" && (
          <div style={{ fontSize: "1.75rem", fontWeight: 700 }}>{resolvedProps.price}</div>
        )}
        {typeof resolvedProps.period === "string" && resolvedProps.period && (
          <div style={{ color: "var(--muted-foreground, #737373)", fontSize: "0.8125rem" }}>{resolvedProps.period}</div>
        )}
        {baseChildren(renderChild)}
      </div>,
    );
  }

  if (node.type === "review-card") {
    const rating = typeof resolvedProps.rating === "number" ? resolvedProps.rating : 0;
    return wrapContent(
      <div {...wrapProps} style={css} data-testid="block-review-card">
        {rating > 0 && (
          <div aria-label={`${rating} out of 5 stars`} style={{ display: "flex", gap: "0.125rem", color: "#f59e0b" }}>
            {Array.from({ length: Math.min(Math.round(rating), 5) }).map((_, i) => (
              <Star key={i} size={14} fill="currentColor" aria-hidden="true" />
            ))}
          </div>
        )}
        {baseChildren(renderChild)}
      </div>,
    );
  }

  if (node.type === "team-member") {
    return wrapContent(
      <div {...wrapProps} style={css} data-testid="block-team-member">
        {baseChildren(renderChild)}
      </div>,
    );
  }

  if (
    node.type === "card" ||
    node.type === "feature-card" ||
    node.type === "faq-item"
  ) {
    return wrapContent(
      <div {...wrapProps} style={css} data-testid={`block-${node.type}`}>
        {baseChildren(renderChild)}
      </div>,
    );
  }

  // ---- Navigation blocks ----
  if (node.type === "navbar") {
    return (
      <nav {...wrapProps} style={css} data-testid="block-navbar">
        {typeof resolvedProps.logoText === "string" && resolvedProps.logoText && (
          <span style={{ fontWeight: 700 }}>{resolvedProps.logoText}</span>
        )}
        {baseChildren(renderChild)}
      </nav>
    );
  }

  if (node.type === "footer") {
    return (
      <footer {...wrapProps} style={css} data-testid="block-footer">
        {baseChildren(renderChild)}
      </footer>
    );
  }

  if (node.type === "menu") {
    const links = Array.isArray(resolvedProps.links) ? resolvedProps.links : [];
    return (
      <ul {...wrapProps} style={{ ...css, listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: "1rem" }} data-testid="block-menu">
        {links.map((link, index) => {
          if (!link || typeof link !== "object") return null;
          const item = link as Record<string, unknown>;
          const href = isSafeLinkUrl(item.href) ? (item.href as string) : "#";
          return (
            <li key={index}>
              <a
                href={href}
                onClick={(e) => {
                  // Phase P22-G — the editable canvas keeps links inert; the
                  // non-editable preview lets safe anchors bubble to the
                  // preview shell (internal routes navigate in-app).
                  if (editable) {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                }}
                style={{ color: "inherit" }}
              >
                {typeof item.text === "string" ? item.text : "Link"}
              </a>
            </li>
          );
        })}
      </ul>
    );
  }

  // ---- Unknown/unsupported type — fail safe ----
  const fallbackLabel = definition?.label ?? node.type;
  return (
    <div
      {...wrapProps}
      style={{
        ...styleTokensToCss(node.style),
        border: "1px dashed var(--border, #e5e5e5)",
        borderRadius: "0.5rem",
        padding: "1rem",
        color: "var(--muted-foreground, #737373)",
        fontSize: "0.8125rem",
      }}
      data-testid="block-unsupported"
      title={`${fallbackLabel} — shown as a container`}
    >
      {baseChildren(renderChild)}
    </div>
  );
}
