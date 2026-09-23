// ---------------------------------------------------------------------------
// Cart store (Stage 3) — unit tests
//
// Covers: add (new + merge), remove, quantity update/clamping, clear,
// open/close/toggle, derived totals/count, price parsing (₹ + commas), and
// the WhatsApp order URI formatting contract.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  useCartStore,
  resetCartStore,
  parsePrice,
  cartTotalPrice,
  cartItemCount,
  formatCartPrice,
  buildWhatsAppOrderUri,
} from "../cart-store";

describe("cart store", () => {
  beforeEach(() => {
    resetCartStore();
  });

  it("adds a new item with quantity 1 by default", () => {
    useCartStore.getState().addItem({ id: "p1", title: "Avocado", price: "₹80" });
    const { items } = useCartStore.getState();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "p1", title: "Avocado", price: "₹80", quantity: 1 });
  });

  it("merges repeated adds of the same product", () => {
    const store = useCartStore.getState();
    store.addItem({ id: "p1", title: "Avocado", price: "₹80" });
    store.addItem({ id: "p1", title: "Avocado", price: "₹80" });
    const { items } = useCartStore.getState();
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
  });

  it("respects an explicit initial quantity", () => {
    useCartStore.getState().addItem({ id: "p2", title: "Milk", price: "₹65", quantity: 3 });
    expect(useCartStore.getState().items[0].quantity).toBe(3);
  });

  it("keeps pack metadata on the line", () => {
    useCartStore
      .getState()
      .addItem({ id: "p3", title: "Bread", price: "₹55", pack: "400 g loaf" });
    expect(useCartStore.getState().items[0].pack).toBe("400 g loaf");
  });

  it("removes an item by id", () => {
    const store = useCartStore.getState();
    store.addItem({ id: "p1", title: "A", price: "₹1" });
    store.addItem({ id: "p2", title: "B", price: "₹2" });
    store.removeItem("p1");
    expect(useCartStore.getState().items.map((i) => i.id)).toEqual(["p2"]);
  });

  it("updates quantity and clamps to >= 1", () => {
    useCartStore.getState().addItem({ id: "p1", title: "A", price: "₹1" });
    useCartStore.getState().updateQuantity("p1", 5);
    expect(useCartStore.getState().items[0].quantity).toBe(5);
    useCartStore.getState().updateQuantity("p1", 0);
    expect(useCartStore.getState().items[0].quantity).toBe(1);
    useCartStore.getState().updateQuantity("p1", Number.NaN);
    expect(useCartStore.getState().items[0].quantity).toBe(1);
  });

  it("clears the cart", () => {
    useCartStore.getState().addItem({ id: "p1", title: "A", price: "₹1" });
    useCartStore.getState().clearCart();
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it("opens, closes, and toggles the drawer", () => {
    const store = useCartStore.getState();
    expect(useCartStore.getState().isOpen).toBe(false);
    store.openCart();
    expect(useCartStore.getState().isOpen).toBe(true);
    store.toggleCart();
    expect(useCartStore.getState().isOpen).toBe(false);
    store.toggleCart();
    expect(useCartStore.getState().isOpen).toBe(true);
    store.closeCart();
    expect(useCartStore.getState().isOpen).toBe(false);
  });

  it("derives the total from price × quantity", () => {
    const store = useCartStore.getState();
    store.addItem({ id: "p1", title: "A", price: "₹80", quantity: 2 });
    store.addItem({ id: "p2", title: "B", price: "₹65", quantity: 1 });
    expect(cartTotalPrice(useCartStore.getState().items)).toBe(225);
    expect(cartItemCount(useCartStore.getState().items)).toBe(3);
  });
});

describe("price helpers", () => {
  it("parses ₹, plain, and comma-formatted prices", () => {
    expect(parsePrice("₹80")).toBe(80);
    expect(parsePrice("80")).toBe(80);
    expect(parsePrice("₹1,299.50")).toBe(1299.5);
    expect(parsePrice("free")).toBe(0);
  });

  it("formats totals back into the first item's currency", () => {
    expect(formatCartPrice(225, [{ id: "x", title: "X", price: "₹80", quantity: 1 }])).toBe("₹225");
    expect(formatCartPrice(10.5, [{ id: "x", title: "X", price: "$4", quantity: 1 }])).toBe("$10.50");
  });
});

describe("buildWhatsAppOrderUri", () => {
  const items = [
    { id: "p1", title: "Organic Hass Avocado", price: "₹80", pack: "500 g pack", quantity: 2 },
    { id: "p2", title: "Whole Farm Milk", price: "₹65", pack: "1 Litre", quantity: 1 },
  ];

  it("builds a wa.me link with digits-only number and encoded order", () => {
    const uri = buildWhatsAppOrderUri({
      number: "+91 98765 43210",
      items,
      total: 225,
    });
    expect(uri).not.toBeNull();
    expect(uri?.startsWith("https://wa.me/919876543210?text=")).toBe(true);
    const text = decodeURIComponent(uri!.split("text=")[1]);
    expect(text).toContain("2 × Organic Hass Avocado (500 g pack) — ₹160");
    expect(text).toContain("1 × Whole Farm Milk (1 Litre) — ₹65");
    expect(text).toContain("Total: ₹225");
    expect(text).toContain("\n");
  });

  it("returns null without a usable number", () => {
    expect(buildWhatsAppOrderUri({ number: "", items, total: 225 })).toBeNull();
    expect(buildWhatsAppOrderUri({ number: "123", items, total: 225 })).toBeNull();
  });

  it("returns null with an empty cart", () => {
    expect(
      buildWhatsAppOrderUri({ number: "919876543210", items: [], total: 0 }),
    ).toBeNull();
  });
});
