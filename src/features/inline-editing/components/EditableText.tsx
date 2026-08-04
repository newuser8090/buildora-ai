"use client";

import { useCallback, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import type { BaseSection } from "@/types/section";
import { useInlineEditPageId } from "../context/InlineEditPageContext";
import { buildDescriptorFromFieldId } from "../registry/editable-field-registry";
import { useInlineEdit } from "../hooks/useInlineEdit";

// ---------------------------------------------------------------------------
// EditableText — renders text with safe inline-editing bindings
//
// When the page context is absent (thumbnail renderer, exports), this renders
// the exact same plain text with NO data attributes and NO handlers, so
// non-editor surfaces are completely unaffected.
// ---------------------------------------------------------------------------

export type EditableTextTag = "span" | "p" | "li" | "button" | "h1" | "h2" | "h3" | "h4";

export interface EditableTextProps {
  section: BaseSection;
  /** Stable registry field id, e.g. "hero.headline" or "features.feature.title". */
  fieldId: string;
  /**
   * Array index (or indices, consumed in order) for fields whose template
   * path has "*" placeholders.
   */
  index?: number | number[];
  value: string;
  as?: EditableTextTag;
  style?: CSSProperties;
  className?: string;
  children?: ReactNode;
  onMouseEnter?: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseLeave?: (e: React.MouseEvent<HTMLElement>) => void;
}

const DEFAULT_STYLE: CSSProperties = {
  cursor: "pointer",
  borderRadius: "2px",
  transition: "box-shadow 120ms ease",
};

export function EditableText({
  section,
  fieldId,
  index,
  value,
  as = "span",
  style,
  className,
  children,
  onMouseEnter,
  onMouseLeave,
}: EditableTextProps) {
  const pageId = useInlineEditPageId();
  const { selectField, beginEditing, clearField } = useInlineEdit();
  const ref = useRef<HTMLElement | null>(null);
  const Tag = as;

  const descriptor = useMemo(
    () =>
      pageId
        ? buildDescriptorFromFieldId(pageId, section, fieldId, index)
        : null,
    [pageId, section, fieldId, index],
  );

  const isEditable = descriptor !== null && descriptor.aiEditable;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!descriptor) return;
      e.preventDefault();
      e.stopPropagation();
      // Selecting a field also selects its section (handled in the hook).
      selectField(descriptor, ref.current);
    },
    [descriptor, selectField],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!descriptor) return;
      e.preventDefault();
      e.stopPropagation();
      selectField(descriptor, ref.current);
      beginEditing();
    },
    [descriptor, selectField, beginEditing],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!descriptor) return;
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        selectField(descriptor, ref.current);
        beginEditing();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        clearField();
      }
    },
    [descriptor, selectField, beginEditing, clearField],
  );

  // ---- Plain rendering when inline editing is unavailable ----
  if (!isEditable) {
    return (
      <Tag
        style={style}
        className={className}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {children ?? value}
      </Tag>
    );
  }

  const pathLabel = descriptor.fieldPath.join(".");

  return (
    <Tag
      ref={ref as never}
      data-editable-field={descriptor.sectionType + "." + pathLabel}
      data-section-id={descriptor.sectionId}
      data-page-id={descriptor.pageId}
      data-field-path={pathLabel}
      data-field-kind={descriptor.kind}
      tabIndex={0}
      role="button"
      aria-label={`Edit ${descriptor.label} of ${descriptor.sectionType} section`}
      title={`Click to edit ${descriptor.label.toLowerCase()}`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ ...DEFAULT_STYLE, ...style }}
      className={className}
    >
      {children ?? value}
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// EditableHeading — heading-level variant (h1–h4)
// ---------------------------------------------------------------------------

export interface EditableHeadingProps extends Omit<EditableTextProps, "as" | "children"> {
  as?: "h1" | "h2" | "h3" | "h4";
}

export function EditableHeading(props: EditableHeadingProps) {
  return <EditableText as={props.as ?? "h2"} {...props} />;
}

// ---------------------------------------------------------------------------
// EditableLinkText — link/button label variant (link text is safe; href is not)
// ---------------------------------------------------------------------------

export function EditableLinkText(props: Omit<EditableTextProps, "as">) {
  return <EditableText as="span" {...props} />;
}
