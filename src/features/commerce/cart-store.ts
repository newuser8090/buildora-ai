// ---------------------------------------------------------------------------
// Cart store (Stage 3 — Interactive Cart Drawer & WhatsApp Checkout)
//
// Lightweight client-side commerce state for interactive preview surfaces
// (visitor preview, share sites, exported sites' canvas shells). The cart is
// TRANSIENT runtime state — never part of the durable project schema — so a
// store snapshot can never leak into serialized JSON or history entries.
//
// Pure zustand state + pure helpers (WhatsApp URI building). No React, no DOM
// in the state module itself; the drawer component reads via hooks.
// ---------------------------------------------------------------------------

import { create } from "zustand";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export interface CartItem {
  /** Stable id — typically the source element/plan identity. */
  id: string;
  title: string;
  /** Display price string, e.g. "₹80" (already formatted). */
  price: string;
  /** Optional pack/weight line, e.g. "500 g pack". */
  pack?: string;
  quantity: number;
  /** Optional image URL (asset-resolved by the caller). */
  imageUrl?: string;
}

interface CartState {
  items: CartItem[];
  isOpen: boolean;
  /** Business WhatsApp/phone number for order placement (digits only). */
  whatsappNumber: string;
  // ---- Actions ----
  addItem: (product: Omit<CartItem, "quantity"> & { quantity?: number }) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  openCart: () => void;
  closeCart: () => void;
  toggleCart: () => void;
  setWhatsappNumber: (number: string) => void;
}

/** Hard cap so a runaway loop can never blow the drawer (unbounded arrays). */
const MAX_ITEMS = 100;
/** Per-line quantity cap (matches typical e-commerce cart guards). */
const MAX_QUANTITY = 999;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useCartStore = create<CartState>()((set) => ({
  items: [],
  isOpen: false,
  whatsappNumber: "",

  addItem: (product) =>
    set((state) => {
      const quantity = clampQuantity(product.quantity ?? 1);
      const existing = state.items.find((item) => item.id === product.id);
      if (existing) {
        return {
          ...state,
          items: state.items.map((item) =>
            item.id === product.id
              ? { ...item, quantity: clampQuantity(item.quantity + quantity) }
              : item,
          ),
        };
      }
      if (state.items.length >= MAX_ITEMS) return state;
      const line: CartItem = {
        id: product.id,
        title: product.title,
        price: product.price,
        ...(product.pack !== undefined ? { pack: product.pack } : {}),
        ...(product.imageUrl !== undefined ? { imageUrl: product.imageUrl } : {}),
        quantity,
      };
      return {
        ...state,
        items: [...state.items, line],
      };
    }),

  removeItem: (id) =>
    set((state) => ({
      ...state,
      items: state.items.filter((item) => item.id !== id),
    })),

  updateQuantity: (id, quantity) =>
    set((state) => ({
      ...state,
      items: state.items.map((item) =>
        item.id === id ? { ...item, quantity: clampQuantity(quantity) } : item,
      ),
    })),

  clearCart: () => set((state) => ({ ...state, items: [] })),

  openCart: () => set((state) => ({ ...state, isOpen: true })),
  closeCart: () => set((state) => ({ ...state, isOpen: false })),
  toggleCart: () => set((state) => ({ ...state, isOpen: !state.isOpen })),

  setWhatsappNumber: (number) =>
    set((state) => ({ ...state, whatsappNumber: number })),
}));

function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity < 1) return 1;
  return Math.min(Math.round(quantity), MAX_QUANTITY);
}

// ---------------------------------------------------------------------------
// Derived helpers (pure — usable outside React)
// ---------------------------------------------------------------------------

/** Parse a display price ("₹80", "80", "₹1,299.50") into a finite number. */
export function parsePrice(price: string): number {
  const cleaned = price.replace(/[^0-9.-]/g, "");
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : 0;
}

export function cartTotalPrice(items: CartItem[]): number {
  return items.reduce(
    (sum, item) => sum + parsePrice(item.price) * item.quantity,
    0,
  );
}

export function cartItemCount(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

/** Format a numeric total back into the display currency of the first item. */
export function formatCartPrice(value: number, items: CartItem[]): string {
  const symbol = items[0]?.price.match(/^[^\d\s-]*/)?.[0]?.trim() ?? "₹";
  return `${symbol}${value % 1 === 0 ? value : value.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// WhatsApp order URI (pure, testable)
// ---------------------------------------------------------------------------

/**
 * Build a wa.me deep link carrying the formatted order. Returns null when
 * there is nothing to order or no configured number — callers render the CTA
 * disabled in that case. Lines are plain text; the URI is encoded with
 * encodeURIComponent so newlines/emoji survive cross-platform.
 */
export function buildWhatsAppOrderUri(options: {
  number: string;
  items: CartItem[];
  total: number;
}): string | null {
  const digits = options.number.replace(/\D/g, "");
  if (digits.length < 8 || options.items.length === 0) return null;

  const lines: string[] = ["🛒 New order:"];
  for (const item of options.items) {
    const pack = item.pack ? ` (${item.pack})` : "";
    const lineTotal = parsePrice(item.price) * item.quantity;
    lines.push(
      `• ${item.quantity} × ${item.title}${pack} — ${formatCartPrice(lineTotal, options.items)}`,
    );
  }
  lines.push(`Total: ${formatCartPrice(options.total, options.items)}`);

  const text = lines.join("\n");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** Test/export helper — reset the transient cart (never used at runtime). */
export function resetCartStore(): void {
  useCartStore.setState({ items: [], isOpen: false, whatsappNumber: "" });
}
