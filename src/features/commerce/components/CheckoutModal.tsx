"use client";

// ---------------------------------------------------------------------------
// CheckoutModal (Stage 5) — completes the cart journey
//
// Opens from the CartDrawer's "Proceed to Checkout" CTA. Collects customer
// details (name, phone, delivery address) and a payment choice (Cash on
// Delivery or Instant UPI/QR), then confirms the order:
//   - shows the confirmation screen with the order summary + Order ID,
//   - clears the cart (the order snapshot is retained for the receipt),
//   - offers a "Send Receipt to WhatsApp" shortcut (wa.me deep link).
//
// Client-side, transient state only — no durable project schema is touched.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Copy, X } from "lucide-react";
import {
  useCartStore,
  cartTotalPrice,
  formatCartPrice,
  type CartItem,
} from "../cart-store";

type PaymentMethod = "cod" | "upi";

interface OrderSnapshot {
  id: string;
  name: string;
  phone: string;
  address: string;
  payment: PaymentMethod;
  items: CartItem[];
  total: number;
}

/** Readable, collision-safe client order id. */
function generateOrderId(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.floor(Math.random() * 1296)
    .toString(36)
    .toUpperCase()
    .padStart(2, "0");
  return `BUILDORA-${stamp}-${rand}`;
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function CheckoutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const items = useCartStore((s) => s.items);
  const whatsappNumber = useCartStore((s) => s.whatsappNumber);
  const clearCart = useCartStore((s) => s.clearCart);
  const closeCart = useCartStore((s) => s.closeCart);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("cod");
  const [attempted, setAttempted] = useState(false);
  const [order, setOrder] = useState<OrderSnapshot | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  const previousFocusRef = useRef<HTMLElement | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Escape closes + focus restore (same discipline as the other dialogs).
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
    previousFocusRef.current?.focus();
    return undefined;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
  }, [open, onClose]);

  // Focus the name field once per open (state is reset via the mount key —
  // callers remount with a fresh instance, so no setState-in-effect reset).
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => nameRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const nameError = attempted && name.trim().length < 2 ? "Please enter your name" : null;
  const phoneError =
    attempted && digitsOnly(phone).length < 7 ? "Please enter a valid phone number" : null;
  const addressError =
    attempted && address.trim().length < 6 ? "Please enter your delivery address" : null;

  const handlePlaceOrder = useCallback(() => {
    setAttempted(true);
    if (name.trim().length < 2 || digitsOnly(phone).length < 7 || address.trim().length < 6) {
      return;
    }
    // Snapshot BEFORE clearing the cart — the receipt needs the lines.
    const snapshot: OrderSnapshot = {
      id: generateOrderId(),
      name: name.trim(),
      phone: phone.trim(),
      address: address.trim(),
      payment,
      items: items.map((item) => ({ ...item })),
      total: cartTotalPrice(items),
    };
    setOrder(snapshot);
    clearCart();
    closeCart();
  }, [name, phone, address, payment, items, clearCart, closeCart]);

  const whatsappReceiptUri = useCallback((): string | null => {
    if (!order) return null;
    const digits = digitsOnly(whatsappNumber);
    if (digits.length < 8) return null;
    const lines: string[] = [
      `🧾 Order receipt — ${order.id}`,
      `Name: ${order.name}`,
      `Phone: ${order.phone}`,
      `Address: ${order.address}`,
      `Payment: ${order.payment === "cod" ? "Cash on Delivery" : "Instant UPI / QR"}`,
      "",
    ];
    for (const item of order.items) {
      const pack = item.pack ? ` (${item.pack})` : "";
      lines.push(`• ${item.quantity} × ${item.title}${pack} — ${item.price}`);
    }
    lines.push("", `Total: ${formatCartPrice(order.total, order.items)}`);
    return `https://wa.me/${digits}?text=${encodeURIComponent(lines.join("\n"))}`;
  }, [order, whatsappNumber]);

  if (!open) return null;

  const receiptUri = whatsappReceiptUri();

  return (
    <div className="fixed inset-0 z-[70]" data-testid="checkout-modal-root">
      <div
        data-testid="checkout-backdrop"
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Checkout"
        data-testid="checkout-modal"
        className="absolute left-1/2 top-1/2 flex max-h-[90vh] w-[420px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-[0_16px_48px_rgba(0,0,0,0.2)]"
      >
        {!order ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-black/5 px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-[#0d0f14]">Checkout</h2>
                <p className="text-xs text-[#8a8f9c]">
                  {items.length} item{items.length !== 1 ? "s" : ""} ·{" "}
                  {formatCartPrice(cartTotalPrice(items), items)}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close checkout"
                data-testid="checkout-close"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#8a8f9c] transition-colors hover:bg-[#F2F3F5] hover:text-[#0d0f14]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Form */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {items.length === 0 ? (
                <p className="py-6 text-center text-sm text-[#5b5e69]" data-testid="checkout-empty">
                  Your basket is empty — add items before checking out.
                </p>
              ) : (
                <div className="flex flex-col gap-3.5">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-[#0d0f14]">Name</span>
                    <input
                      ref={nameRef}
                      data-testid="checkout-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your full name"
                      className="h-10 rounded-xl border border-black/10 px-3 text-sm text-[#0d0f14] outline-none transition-colors focus:border-[#7D2AE8]"
                    />
                    {nameError && (
                      <span className="text-xs text-red-500" data-testid="checkout-error-name">
                        {nameError}
                      </span>
                    )}
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-[#0d0f14]">Phone Number</span>
                    <input
                      data-testid="checkout-phone"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="10-digit mobile number"
                      inputMode="tel"
                      className="h-10 rounded-xl border border-black/10 px-3 text-sm text-[#0d0f14] outline-none transition-colors focus:border-[#7D2AE8]"
                    />
                    {phoneError && (
                      <span className="text-xs text-red-500" data-testid="checkout-error-phone">
                        {phoneError}
                      </span>
                    )}
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-[#0d0f14]">Delivery Address</span>
                    <textarea
                      data-testid="checkout-address"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Flat / street, area, city, PIN"
                      rows={3}
                      className="resize-none rounded-xl border border-black/10 px-3 py-2 text-sm text-[#0d0f14] outline-none transition-colors focus:border-[#7D2AE8]"
                    />
                    {addressError && (
                      <span className="text-xs text-red-500" data-testid="checkout-error-address">
                        {addressError}
                      </span>
                    )}
                  </label>

                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-[#0d0f14]">Payment Method</span>
                    <div className="flex flex-col gap-2">
                      <label
                        data-testid="checkout-payment-cod"
                        className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                          payment === "cod"
                            ? "border-[#7D2AE8] bg-[#FAF7FE] text-[#0d0f14]"
                            : "border-black/10 text-[#5b5e69] hover:border-black/20"
                        }`}
                      >
                        <input
                          type="radio"
                          name="checkout-payment"
                          checked={payment === "cod"}
                          onChange={() => setPayment("cod")}
                          className="accent-[#7D2AE8]"
                        />
                        <span>💵 Cash on Delivery (COD)</span>
                      </label>
                      <label
                        data-testid="checkout-payment-upi"
                        className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                          payment === "upi"
                            ? "border-[#7D2AE8] bg-[#FAF7FE] text-[#0d0f14]"
                            : "border-black/10 text-[#5b5e69] hover:border-black/20"
                        }`}
                      >
                        <input
                          type="radio"
                          name="checkout-payment"
                          checked={payment === "upi"}
                          onChange={() => setPayment("upi")}
                          className="accent-[#7D2AE8]"
                        />
                        <span>📲 Instant UPI / QR Code</span>
                      </label>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-black/5 pt-3 text-sm">
                    <span className="text-[#5b5e69]">Total payable</span>
                    <span
                      data-testid="checkout-total"
                      className="font-semibold text-[#0d0f14]"
                    >
                      {formatCartPrice(cartTotalPrice(items), items)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            {items.length > 0 && (
              <div className="border-t border-black/5 px-5 py-4">
                <button
                  type="button"
                  data-testid="checkout-place-order"
                  onClick={handlePlaceOrder}
                  className="h-11 w-full rounded-xl bg-gradient-to-r from-[#8B3DFF] to-[#7D2AE8] text-sm font-semibold text-white shadow-[0_2px_10px_rgba(125,42,232,0.35)] transition-all hover:brightness-110 active:scale-[0.99]"
                >
                  Place Order
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Confirmation */}
            <div className="flex items-center justify-between border-b border-black/5 px-5 py-4">
              <h2 className="text-sm font-semibold text-[#0d0f14]">Order confirmed</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close checkout"
                data-testid="checkout-done"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#8a8f9c] transition-colors hover:bg-[#F2F3F5] hover:text-[#0d0f14]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5" data-testid="checkout-confirmation">
              <div className="flex flex-col items-center gap-2 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-green-50">
                  <CheckCircle2 className="h-6 w-6 text-green-500" />
                </span>
                <p className="text-sm font-semibold text-[#0d0f14]">
                  Thanks, {order.name}! Your order is placed.
                </p>
                <button
                  type="button"
                  data-testid="checkout-order-id"
                  onClick={() => {
                    try {
                      void navigator.clipboard?.writeText(order.id);
                      setCopiedId(true);
                      setTimeout(() => setCopiedId(false), 2000);
                    } catch {
                      // Clipboard unavailable — id is still visible.
                    }
                  }}
                  title="Copy order ID"
                  className="flex items-center gap-1.5 rounded-lg bg-[#F2F3F5] px-3 py-1.5 font-mono text-xs text-[#0d0f14] transition-colors hover:bg-[#e8eaef]"
                >
                  {order.id}
                  <Copy className="h-3 w-3 text-[#8a8f9c]" />
                </button>
                {copiedId && <span className="text-xs text-green-600">Copied!</span>}
                {payment === "upi" && (
                  <p className="text-xs text-[#8a8f9c]">
                    Pay instantly via UPI / QR — a payment link will be shared on WhatsApp.
                  </p>
                )}
              </div>

              {/* Order summary */}
              <ul className="mt-4 flex flex-col gap-2 rounded-xl border border-black/5 p-3" data-testid="checkout-summary">
                {order.items.map((item) => (
                  <li key={item.id} className="flex items-center justify-between text-xs">
                    <span className="text-[#5b5e69]">
                      {item.quantity} × {item.title}
                      {item.pack ? ` (${item.pack})` : ""}
                    </span>
                    <span className="font-medium text-[#0d0f14]">{item.price}</span>
                  </li>
                ))}
                <li className="flex items-center justify-between border-t border-black/5 pt-2 text-sm">
                  <span className="text-[#5b5e69]">Total</span>
                  <span className="font-semibold text-[#0d0f14]">
                    {formatCartPrice(order.total, order.items)}
                  </span>
                </li>
              </ul>

              <p className="mt-3 text-xs leading-relaxed text-[#8a8f9c]">
                Delivering to: {order.address} · {order.payment === "cod" ? "Pay cash on delivery" : "Pay via UPI"}
              </p>
            </div>
            <div className="border-t border-black/5 px-5 py-4">
              {receiptUri ? (
                <a
                  href={receiptUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="checkout-whatsapp-receipt"
                  className="flex h-11 w-full items-center justify-center rounded-xl bg-[#25D366] text-sm font-semibold text-white transition-all hover:opacity-90"
                >
                  Send Receipt to WhatsApp
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  data-testid="checkout-whatsapp-receipt"
                  title="This store hasn't configured a WhatsApp number"
                  className="h-11 w-full cursor-not-allowed rounded-xl bg-[#c4c8d0] text-sm font-semibold text-white opacity-60"
                >
                  Send Receipt to WhatsApp
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
