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

import { createElement, useRef, useState } from "react";
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
import { blockRegistry } from "../registry/block-registry";
import { blockCss, styleTokensToCss } from "./block-style-to-css";

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

function textOf(node: BlockNode, key = "text"): string {
  const value = node.props[key];
  return typeof value === "string" ? value : "";
}

function levelOf(node: BlockNode): 1 | 2 | 3 | 4 | 5 | 6 {
  const level = node.props.level;
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
}: {
  node: BlockNode;
  value: string;
  tag: keyof React.JSX.IntrinsicElements;
  onCommit: (nodeId: string, next: string) => void;
  style: React.CSSProperties;
  placeholder?: string;
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
}

export function BlockRenderer({
  tree,
  viewportWidth = 1440,
  selectedBlockId = null,
  onSelectBlock,
  editable = false,
  onEditText,
}: BlockRendererProps) {
  return (
    <>
      {tree.rootIds.map((rootId) => {
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
          />
        );
      })}
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
}: BlockRendererProps & { node: BlockNode; tree: BlockTree }) {
  const definition = blockRegistry.get(node.type);
  const css = blockCss(node.style, node.responsive, viewportWidth);
  const selected = selectedBlockId === node.id;
  const children = node.children
    .map((childId) => tree.nodes[childId])
    .filter((child): child is BlockNode => !!child);

  const wrapProps: Record<string, unknown> = {
    "data-block-id": node.id,
    "data-block-type": node.type,
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelectBlock?.(node.id);
    },
  };

  const commitText = (nodeId: string, next: string) => {
    onEditText?.(nodeId, next);
  };

  // Selection ring (canvas only).
  if (selected && onSelectBlock) {
    css.outline = "2px solid var(--accent, #7c5cfc)";
    css.outlineOffset = "2px";
    css.borderRadius = "6px";
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
    />
  );

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
    const columns = typeof node.props.columns === "number" ? node.props.columns : 3;
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
    const text = textOf(node);
    const Tag = `h${levelOf(node)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
    if (editable) {
      return (
        <EditableText
          node={node}
          value={text}
          tag={Tag}
          onCommit={commitText}
          style={css}
          placeholder="Heading"
        />
      );
    }
    return (
      <Tag {...wrapProps} style={css} data-testid="block-heading">
        {text || "Heading"}
      </Tag>
    );
  }

  if (node.type === "paragraph") {
    const text = textOf(node);
    if (editable) {
      return (
        <EditableText
          node={node}
          value={text}
          tag="p"
          onCommit={commitText}
          style={css}
          placeholder="Text"
        />
      );
    }
    return (
      <p {...wrapProps} style={css} data-testid="block-paragraph">
        {text || "Text"}
      </p>
    );
  }

  if (node.type === "button") {
    const text = textOf(node);
    const href = node.props.href;
    const safeHref = isSafeLinkUrl(href) ? (href as string) : null;
    const style: React.CSSProperties = {
      display: "inline-block",
      textDecoration: "none",
      cursor: "default",
      ...css,
    };
    const content = editable ? (
      <EditableText node={node} value={text} tag="span" onCommit={commitText} style={style} placeholder="Button" />
    ) : (
      text || "Button"
    );
    if (safeHref) {
      return (
        <a href={safeHref} {...wrapProps} style={style} data-testid="block-button" onClick={(e) => e.preventDefault()}>
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
    const src = node.props.src;
    const alt = typeof node.props.alt === "string" ? node.props.alt : "";
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
    return (
      // eslint-disable-next-line @next/next/no-img-element -- editor preview
      <img
        {...wrapProps}
        src={safeSrc}
        alt={alt}
        loading="lazy"
        style={css}
        data-testid="block-image"
      />
    );
  }

  if (node.type === "video") {
    const src = node.props.src;
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
    return <video {...wrapProps} src={safeSrc} muted playsInline style={css} data-testid="block-video" />;
  }

  if (node.type === "icon") {
    // createElement keeps the resolved icon OUT of JSX position — the
    // react-hooks/static-components rule forbids components created during
    // render being used as JSX tags.
    const Icon = resolveIcon(node.props.icon);
    const size = typeof node.props.size === "number" ? node.props.size : 24;
    return (
      <span {...wrapProps} style={{ ...css, display: "inline-flex" }} data-testid="block-icon">
        {createElement(Icon, { size, "aria-hidden": true })}
      </span>
    );
  }

  if (node.type === "badge") {
    const text = textOf(node);
    if (editable) {
      return <EditableText node={node} value={text} tag="span" onCommit={commitText} style={css} placeholder="Badge" />;
    }
    return (
      <span {...wrapProps} style={css} data-testid="block-badge">
        {text || "Badge"}
      </span>
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
    const label = typeof node.props.label === "string" ? node.props.label : "Field";
    return (
      <label {...wrapProps} style={css} data-testid="block-input">
        {label}
        <input type="text" readOnly placeholder={typeof node.props.placeholder === "string" ? node.props.placeholder : ""} style={{ width: "100%", padding: "0.5rem 0.75rem", borderRadius: "0.375rem", border: "1px solid var(--border, #e5e5e5)", background: "var(--background, #fff)" }} />
      </label>
    );
  }

  if (node.type === "textarea") {
    const label = typeof node.props.label === "string" ? node.props.label : "Message";
    return (
      <label {...wrapProps} style={css} data-testid="block-textarea">
        {label}
        <textarea readOnly placeholder={typeof node.props.placeholder === "string" ? node.props.placeholder : ""} style={{ width: "100%", padding: "0.5rem 0.75rem", borderRadius: "0.375rem", border: "1px solid var(--border, #e5e5e5)", minHeight: "6rem", background: "var(--background, #fff)" }} />
      </label>
    );
  }

  if (node.type === "checkbox") {
    const label = typeof node.props.label === "string" ? node.props.label : "Checkbox";
    return (
      <label {...wrapProps} style={{ ...css, display: "flex", alignItems: "center", gap: "0.5rem" }} data-testid="block-checkbox">
        <input type="checkbox" checked={node.props.checked === true} readOnly />
        {label}
      </label>
    );
  }

  if (node.type === "tabs" || node.type === "accordion") {
    return (
      <div {...wrapProps} style={css} data-testid={`block-${node.type}`}>
        {baseChildren(renderChild)}
      </div>
    );
  }

  // ---- Composite blocks ----
  if (node.type === "pricing-card") {
    return (
      <div {...wrapProps} style={css} data-testid="block-pricing-card">
        {typeof node.props.price === "string" && (
          <div style={{ fontSize: "1.75rem", fontWeight: 700 }}>{node.props.price}</div>
        )}
        {typeof node.props.period === "string" && node.props.period && (
          <div style={{ color: "var(--muted-foreground, #737373)", fontSize: "0.8125rem" }}>{node.props.period}</div>
        )}
        {baseChildren(renderChild)}
      </div>
    );
  }

  if (node.type === "review-card") {
    const rating = typeof node.props.rating === "number" ? node.props.rating : 0;
    return (
      <div {...wrapProps} style={css} data-testid="block-review-card">
        {rating > 0 && (
          <div aria-label={`${rating} out of 5 stars`} style={{ display: "flex", gap: "0.125rem", color: "#f59e0b" }}>
            {Array.from({ length: Math.min(Math.round(rating), 5) }).map((_, i) => (
              <Star key={i} size={14} fill="currentColor" aria-hidden="true" />
            ))}
          </div>
        )}
        {baseChildren(renderChild)}
      </div>
    );
  }

  if (node.type === "team-member") {
    return (
      <div {...wrapProps} style={css} data-testid="block-team-member">
        {baseChildren(renderChild)}
      </div>
    );
  }

  if (
    node.type === "card" ||
    node.type === "feature-card" ||
    node.type === "faq-item"
  ) {
    return (
      <div {...wrapProps} style={css} data-testid={`block-${node.type}`}>
        {baseChildren(renderChild)}
      </div>
    );
  }

  // ---- Navigation blocks ----
  if (node.type === "navbar") {
    return (
      <nav {...wrapProps} style={css} data-testid="block-navbar">
        {typeof node.props.logoText === "string" && node.props.logoText && (
          <span style={{ fontWeight: 700 }}>{node.props.logoText}</span>
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
    const links = Array.isArray(node.props.links) ? node.props.links : [];
    return (
      <ul {...wrapProps} style={{ ...css, listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: "1rem" }} data-testid="block-menu">
        {links.map((link, index) => {
          if (!link || typeof link !== "object") return null;
          const item = link as Record<string, unknown>;
          const href = isSafeLinkUrl(item.href) ? (item.href as string) : "#";
          return (
            <li key={index}>
              <a href={href} onClick={(e) => e.preventDefault()} style={{ color: "inherit" }}>
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
