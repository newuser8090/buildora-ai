"use client";

import { createContext, useContext } from "react";

// ---------------------------------------------------------------------------
// InlineEditPageContext
//
// Provides the pageId that editable field descriptors are built against.
// Absent (thumbnail renderer, exports) → EditableText renders plain text with
// no data attributes and no handlers, so non-editor surfaces are untouched.
// ---------------------------------------------------------------------------

export const InlineEditPageContext = createContext<string | null>(null);

export function InlineEditPageProvider({
  pageId,
  children,
}: {
  pageId: string;
  children: React.ReactNode;
}) {
  return (
    <InlineEditPageContext.Provider value={pageId}>
      {children}
    </InlineEditPageContext.Provider>
  );
}

export function useInlineEditPageId(): string | null {
  return useContext(InlineEditPageContext);
}
