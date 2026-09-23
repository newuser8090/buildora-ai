// @vitest-environment jsdom

// ---------------------------------------------------------------------------
// CartDrawer (Stage 3) — component tests
//
// Covers: closed-render (no chrome when closed), open/close/backdrop/Escape,
// empty state copy, item rendering with qty controls, subtotal math, the
// WhatsApp CTA href formatting, and the disabled-without-number contract.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CartDrawer } from "../components/CartDrawer";
import { useCartStore, resetCartStore } from "../cart-store";

describe("CartDrawer", () => {
  beforeEach(() => {
    resetCartStore();
  });

  it("renders nothing while closed", () => {
    render(<CartDrawer />);
    expect(screen.queryByTestId("cart-drawer-root")).toBeNull();
  });

  it("renders the drawer with header and count when opened", () => {
    useCartStore.getState().openCart();
    render(<CartDrawer />);
    expect(screen.getByTestId("cart-drawer")).toBeTruthy();
    expect(screen.getByText("Your Basket")).toBeTruthy();
    expect(screen.getByTestId("cart-item-count").textContent).toContain("0 items");
  });

  it("close button closes the drawer", () => {
    useCartStore.getState().openCart();
    render(<CartDrawer />);
    fireEvent.click(screen.getByTestId("cart-drawer-close"));
    expect(useCartStore.getState().isOpen).toBe(false);
  });

  it("backdrop click closes the drawer", () => {
    useCartStore.getState().openCart();
    render(<CartDrawer />);
    fireEvent.click(screen.getByTestId("cart-drawer-backdrop"));
    expect(useCartStore.getState().isOpen).toBe(false);
  });

  it("Escape closes the drawer", () => {
    useCartStore.getState().openCart();
    render(<CartDrawer />);
    fireEvent(window, new KeyboardEvent("keydown", { key: "Escape" }));
    expect(useCartStore.getState().isOpen).toBe(false);
  });

  it("shows the empty state message", () => {
    useCartStore.getState().openCart();
    render(<CartDrawer />);
    expect(screen.getByTestId("cart-empty-state")).toBeTruthy();
    expect(screen.getByText(/Your basket is empty/)).toBeTruthy();
  });

  it("lists items with title, pack, price, and quantity controls", () => {
    const store = useCartStore.getState();
    store.addItem({ id: "avocado", title: "Organic Hass Avocado", price: "₹80", pack: "500 g pack", quantity: 2 });
    store.openCart();
    render(<CartDrawer />);

    expect(screen.getByText("Organic Hass Avocado")).toBeTruthy();
    expect(screen.getByText("500 g pack")).toBeTruthy();
    expect(screen.getByTestId("cart-qty-avocado").textContent).toBe("2");

    fireEvent.click(screen.getByTestId("cart-qty-inc-avocado"));
    expect(useCartStore.getState().items[0].quantity).toBe(3);

    fireEvent.click(screen.getByTestId("cart-qty-dec-avocado"));
    expect(useCartStore.getState().items[0].quantity).toBe(2);

    fireEvent.click(screen.getByTestId("cart-remove-avocado"));
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it("decrement at quantity 1 removes the line", () => {
    const store = useCartStore.getState();
    store.addItem({ id: "milk", title: "Whole Farm Milk", price: "₹65", quantity: 1 });
    store.openCart();
    render(<CartDrawer />);
    fireEvent.click(screen.getByTestId("cart-qty-dec-milk"));
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it("shows the subtotal", () => {
    const store = useCartStore.getState();
    store.addItem({ id: "a", title: "A", price: "₹80", quantity: 2 });
    store.addItem({ id: "b", title: "B", price: "₹65", quantity: 1 });
    store.openCart();
    render(<CartDrawer />);
    expect(screen.getByTestId("cart-subtotal").textContent).toBe("₹225");
  });

  it("WhatsApp CTA carries the formatted order and opens in a new tab", () => {
    const store = useCartStore.getState();
    store.setWhatsappNumber("919876543210");
    store.addItem({ id: "a", title: "Organic Hass Avocado", price: "₹80", pack: "500 g pack", quantity: 2 });
    store.openCart();
    render(<CartDrawer />);

    const cta = screen.getByTestId("cart-order-whatsapp") as HTMLAnchorElement;
    expect(cta.getAttribute("href")?.startsWith("https://wa.me/919876543210?text=")).toBe(true);
    expect(cta.getAttribute("target")).toBe("_blank");
    expect(cta.getAttribute("rel")).toContain("noopener");
    const text = decodeURIComponent(cta.getAttribute("href")!.split("text=")[1]);
    expect(text).toContain("2 × Organic Hass Avocado (500 g pack) — ₹160");
    expect(text).toContain("Total: ₹160");
  });

  it("WhatsApp CTA is inert without a configured number", () => {
    const store = useCartStore.getState();
    store.addItem({ id: "a", title: "A", price: "₹10", quantity: 1 });
    store.openCart();
    render(<CartDrawer />);
    const cta = screen.getByTestId("cart-order-whatsapp") as HTMLAnchorElement;
    expect(cta.getAttribute("href")).toBe("#");
    expect(cta.getAttribute("aria-disabled")).toBe("true");
  });

  it("clear basket empties the cart", () => {
    const store = useCartStore.getState();
    store.addItem({ id: "a", title: "A", price: "₹10", quantity: 1 });
    store.openCart();
    render(<CartDrawer />);
    fireEvent.click(screen.getByTestId("cart-clear"));
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it("footer (subtotal + CTAs) is hidden for an empty cart", () => {
    useCartStore.getState().openCart();
    render(<CartDrawer />);
    expect(screen.queryByTestId("cart-subtotal")).toBeNull();
    expect(screen.queryByTestId("cart-order-whatsapp")).toBeNull();
  });
});
