// @vitest-environment jsdom

// ---------------------------------------------------------------------------
// CheckoutModal (Stage 5) — component tests
//
// Covers: the form (name/phone/address + COD/UPI), validation blocking an
// incomplete order, Place Order generating a confirmation screen with an
// order id + summary, the cart being CLEARED and the drawer closed on
// placement, and the WhatsApp receipt shortcut contract (enabled with a
// configured number, disabled without one).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CheckoutModal } from "../components/CheckoutModal";
import { CartDrawer } from "../components/CartDrawer";
import { useCartStore, resetCartStore } from "../cart-store";

function seedCart() {
  const store = useCartStore.getState();
  store.addItem({ id: "avocado", title: "Organic Hass Avocado", price: "₹80", pack: "500 g", quantity: 2 });
  store.addItem({ id: "milk", title: "Whole Farm Milk", price: "₹65", pack: "1 Litre", quantity: 1 });
  store.setWhatsappNumber("911234567890");
  store.openCart();
}

function fillValidForm() {
  fireEvent.change(screen.getByTestId("checkout-name"), { target: { value: "Aanya Sharma" } });
  fireEvent.change(screen.getByTestId("checkout-phone"), { target: { value: "9876543210" } });
  fireEvent.change(screen.getByTestId("checkout-address"), {
    target: { value: "12 Green Park, New Delhi 110016" },
  });
}

describe("CheckoutModal", () => {
  beforeEach(() => {
    resetCartStore();
  });

  it("renders nothing when closed", () => {
    render(<CheckoutModal open={false} onClose={() => undefined} />);
    expect(screen.queryByTestId("checkout-modal")).toBeNull();
  });

  it("opens from the drawer's Proceed to Checkout CTA", () => {
    seedCart();
    render(<CartDrawer />);
    fireEvent.click(screen.getByTestId("cart-proceed-checkout"));
    expect(screen.getByTestId("checkout-modal")).toBeTruthy();
  });

  it("shows validation errors and does not place an incomplete order", () => {
    seedCart();
    render(<CartDrawer />);
    fireEvent.click(screen.getByTestId("cart-proceed-checkout"));
    fireEvent.click(screen.getByTestId("checkout-place-order"));

    expect(screen.getByTestId("checkout-error-name")).toBeTruthy();
    expect(screen.getByTestId("checkout-error-phone")).toBeTruthy();
    expect(screen.getByTestId("checkout-error-address")).toBeTruthy();
    // Cart untouched.
    expect(useCartStore.getState().items).toHaveLength(2);
    expect(screen.queryByTestId("checkout-confirmation")).toBeNull();
  });

  it("places the order: confirmation with id + summary, cart cleared, drawer closed", () => {
    seedCart();
    render(<CartDrawer />);
    fireEvent.click(screen.getByTestId("cart-proceed-checkout"));
    fillValidForm();
    fireEvent.click(screen.getByTestId("checkout-place-order"));

    // Confirmation screen with a readable order id and full summary.
    const confirmation = screen.getByTestId("checkout-confirmation");
    expect(confirmation).toBeTruthy();
    const orderId = screen.getByTestId("checkout-order-id").textContent ?? "";
    expect(orderId).toMatch(/^BUILDORA-/);

    const summary = screen.getByTestId("checkout-summary").textContent ?? "";
    expect(summary).toContain("2 × Organic Hass Avocado");
    expect(summary).toContain("Whole Farm Milk");

    // The cart is cleared and the drawer closed by the placement.
    expect(useCartStore.getState().items).toHaveLength(0);
    expect(useCartStore.getState().isOpen).toBe(false);
  });

  it("shows the COD and UPI payment options", () => {
    seedCart();
    render(<CartDrawer />);
    fireEvent.click(screen.getByTestId("cart-proceed-checkout"));
    expect(screen.getByTestId("checkout-payment-cod")).toBeTruthy();
    expect(screen.getByTestId("checkout-payment-upi")).toBeTruthy();
  });

  it("enables the WhatsApp receipt with a configured number", () => {
    seedCart();
    render(<CartDrawer />);
    fireEvent.click(screen.getByTestId("cart-proceed-checkout"));
    fillValidForm();
    fireEvent.click(screen.getByTestId("checkout-place-order"));

    const receipt = screen.getByTestId("checkout-whatsapp-receipt") as HTMLAnchorElement;
    expect(receipt.getAttribute("href")).toContain("https://wa.me/911234567890");
    expect(receipt.getAttribute("href")).toContain("Order%20receipt");
    expect(receipt.textContent).toContain("Send Receipt to WhatsApp");
  });

  it("disables the WhatsApp receipt without a configured number", () => {
    seedCart();
    useCartStore.getState().setWhatsappNumber("");
    render(<CartDrawer />);
    fireEvent.click(screen.getByTestId("cart-proceed-checkout"));
    fillValidForm();
    fireEvent.click(screen.getByTestId("checkout-place-order"));

    const receipt = screen.getByTestId("checkout-whatsapp-receipt") as HTMLButtonElement;
    expect(receipt.getAttribute("href")).toBeNull();
    expect(receipt.hasAttribute("disabled")).toBe(true);
  });
});
