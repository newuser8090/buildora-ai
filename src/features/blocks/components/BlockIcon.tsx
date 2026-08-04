"use client";

import { createElement } from "react";
import {
  Box,
  Boxes,
  Rows3,
  Columns3,
  Grid3x3,
  Minus,
  Expand,
  Heading1,
  Text,
  MousePointerClick,
  Image as ImageIcon,
  Play,
  Sparkles,
  Tag,
  Square,
  User,
  Star,
  HelpCircle,
  Menu,
  PanelBottom,
  List,
  FileText,
  CheckSquare,
  ChevronsDown,
  LayoutGrid,
  TextCursorInput,
  type LucideIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Registry iconKey → Lucide component (Phase O). The block registry stays
// framework-independent; only this UI layer maps keys to icons.
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, LucideIcon> = {
  box: Box,
  boxes: Boxes,
  rows: Rows3,
  columns: Columns3,
  grid: Grid3x3,
  minus: Minus,
  expand: Expand,
  heading: Heading1,
  text: Text,
  "mouse-pointer": MousePointerClick,
  image: ImageIcon,
  video: Play,
  sparkles: Sparkles,
  tag: Tag,
  square: Square,
  user: User,
  star: Star,
  "help-circle": HelpCircle,
  menu: Menu,
  "panel-bottom": PanelBottom,
  list: List,
  "file-text": FileText,
  "check-square": CheckSquare,
  "chevrons-down": ChevronsDown,
  "layout-grid": LayoutGrid,
  input: TextCursorInput,
};

const FALLBACK: LucideIcon = Box;

export function blockIcon(iconKey: string): LucideIcon {
  return ICON_MAP[iconKey] ?? FALLBACK;
}

export function BlockIcon({
  iconKey,
  className,
}: {
  iconKey: string;
  className?: string;
}) {
  // createElement keeps the resolved icon out of JSX so the component is not
  // "created during render" (react-hooks/static-components). blockIcon returns
  // a stable component from a fixed map, so identity is preserved.
  return createElement(blockIcon(iconKey), { className, "aria-hidden": true });
}
