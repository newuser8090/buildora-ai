// ---------------------------------------------------------------------------
// Binding foundation (Phase P22-A) — future data binding
//
// Elements may eventually bind to Supabase/APIs/collections/auth/user data.
// P22-A only ensures the architecture cannot make binding impossible: the
// field is optional, typed, and data-only. No integrations are implemented.
//
// Pure model: no React, no DOM.
// ---------------------------------------------------------------------------

export type ElementBindingSource =
  | "page"
  | "project"
  | "collection"
  | "form"
  | "auth";

export interface ElementBinding {
  source: ElementBindingSource;
  /** Collection/table identifier when source is "collection". */
  collectionId?: string;
  /** Path into the data record, e.g. "price" or "images[0].src". */
  path?: string;
  /** The element prop the binding feeds, e.g. "src" or "text". */
  field?: string;
}
