"use client";

// ---------------------------------------------------------------------------
// CartDrawer (Stage 3) — slide-out basket for interactive preview surfaces
//
// Reads the transient cart store; renders NOTHING while closed (so non-commerce
// projects are byte-for-byte unchanged). Footer exposes the zero-code
// WhatsApp checkout (wa.me deep link with the formatted order) and the
// Stage 5 "Proceed to Checkout" CTA opening CheckoutModal. The modal renders
// INDEPENDENTLY of the drawer's open state, so the order confirmation
// survives the cart being cleared + drawer closing on order placement.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { X, Minus, Plus, Trash2, ShoppingBag } from "lucide-react";
import {
  useCartStore,
  cartTotalPrice,
  cartItemCount,
  formatCartPrice,
  buildWhatsAppOrderUri,
} from "../cart-store";
import { CheckoutModal } from "./CheckoutModal";

// ---------------------------------------------------------------------------

export function CartDrawer() {
  const items = useCartStore((s) => s.items);
  const isOpen = useCartStore((s) => s.isOpen);
  const whatsappNumber = useCartStore((s) => s.whatsappNumber);
  const closeCart = useCartStore((s) => s.closeCart);
  const removeItem = useCartStore((s) => s.removeItem);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const clearCart = useCartStore((s) => s.clearCart);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Escape closes + focus restore (same discipline as the other drawers).
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") closeCart();
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
    previousFocusRef.current?.focus();
    return undefined;
  }, [isOpen, closeCart]);

  const total = cartTotalPrice(items);
  const count = cartItemCount(items);
  const whatsappUri = buildWhatsAppOrderUri({
    number: whatsappNumber,
    items,
    total,
  });

  // The modal is the STABLE first child of the returned fragment — it must
  // never change tree position, or React remounts it on drawer close and the
  // order confirmation (local modal state) is wiped mid-order. The drawer
  // chrome renders conditionally as the fragment's second child; the modal
  // stays mounted whenever the drawer is open OR the checkout flow is
  // active, so the confirmation survives cart clearing + drawer closing.
  // `key={checkoutOpen ? "on" : "off"}` gives a fresh instance per flow, so
  // the modal resets its local state on open without setState-in-effect.
  const checkoutModal = (
    <CheckoutModal
      key={checkoutOpen ? "checkout-on" : "checkout-off"}
      open={checkoutOpen}
      onClose={() => setCheckoutOpen(false)}
    />
  );

  if (!isOpen && !checkoutOpen) return null;

  return (
    <>
      {checkoutModal}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            data-testid="cart-drawer-backdrop"
            aria-hidden="true"
            onClick={closeCart}
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px] transition-opacity"
          />

      {/* Drawer panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Shopping basket"
        data-testid="cart-drawer"
        className="fixed right-0 top-0 z-[61] flex h-full w-[360px] max-w-[92vw] translate-x-0 flex-col bg-white shadow-[-8px_0_32px_rgba(0,0,0,0.15)] animate-[cart-slide-in_220ms_ease-out]"
      >
        <style>{`@keyframes cart-slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-black/5 px-4 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-[#0d0f14]">Your Basket</h2>
            <p className="text-xs text-[#8a8f9c]" data-testid="cart-item-count">
              {count} item{count !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={closeCart}
            aria-label="Close basket"
            data-testid="cart-drawer-close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#8a8f9c] transition-colors hover:bg-[#F2F3F5] hover:text-[#0d0f14]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {items.length === 0 ? (
            <div
              data-testid="cart-empty-state"
              className="flex h-full flex-col items-center justify-center gap-2 text-center"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F2F3F5]">
                <ShoppingBag className="h-5 w-5 text-[#8a8f9c]" />
              </span>
              <p className="text-sm text-[#5b5e69]">
                Your basket is empty. Add fresh items from the store!
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {items.map((item) => (
                <li
                  key={item.id}
                  data-testid="cart-item"
                  className="flex items-center gap-3 rounded-xl border border-black/5 bg-white p-2.5"
                >
                  {item.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="h-11 w-11 flex-shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-[#F2F3F5] text-base"
                    >
                      🛒
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[#0d0f14]">
                      {item.title}
                    </p>
                    {item.pack && (
                      <p className="truncate text-xs text-[#8a8f9c]">{item.pack}</p>
                    )}
                    <p className="text-xs font-semibold text-[#16a34a]">
                      {item.price}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Decrease quantity of ${item.title}`}
                      data-testid={`cart-qty-dec-${item.id}`}
                      onClick={() => {
                        if (item.quantity <= 1) removeItem(item.id);
                        else updateQuantity(item.id, item.quantity - 1);
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-md border border-black/10 text-[#5b5e69] transition-colors hover:bg-[#F2F3F5]"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span
                      data-testid={`cart-qty-${item.id}`}
                      className="min-w-6 text-center text-sm font-medium text-[#0d0f14]"
                    >
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      aria-label={`Increase quantity of ${item.title}`}
                      data-testid={`cart-qty-inc-${item.id}`}
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                      className="flex h-6 w-6 items-center justify-center rounded-md border border-black/10 text-[#5b5e69] transition-colors hover:bg-[#F2F3F5]"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${item.title}`}
                      data-testid={`cart-remove-${item.id}`}
                      onClick={() => removeItem(item.id)}
                      className="ml-1 flex h-6 w-6 items-center justify-center rounded-md text-[#b0b4c0] transition-colors hover:bg-red-50 hover:text-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="border-t border-black/5 px-4 py-3.5">
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="text-[#5b5e69]">Subtotal</span>
              <span
                data-testid="cart-subtotal"
                className="font-semibold text-[#0d0f14]"
              >
                {formatCartPrice(total, items)}
              </span>
            </div>
            <a
              href={whatsappUri ?? "#"}
              onClick={(e) => {
                if (!whatsappUri) e.preventDefault();
              }}
              aria-disabled={!whatsappUri}
              data-testid="cart-order-whatsapp"
              className={`flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition-all ${
                whatsappUri
                  ? "bg-[#25D366] hover:opacity-90"
                  : "cursor-not-allowed bg-[#c4c8d0] opacity-60"
              }`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Order on WhatsApp 📲
            </a>
            <button
              type="button"
              data-testid="cart-proceed-checkout"
              onClick={() => setCheckoutOpen(true)}
              className="mt-2 flex h-10 w-full items-center justify-center rounded-xl border border-black/10 text-sm font-medium text-[#5b5e69] transition-colors hover:bg-[#F2F3F5]"
            >
              Proceed to Checkout
            </button>
            <button
              type="button"
              onClick={clearCart}
              data-testid="cart-clear"
              className="mt-1.5 w-full text-center text-xs text-[#8a8f9c] transition-colors hover:text-red-500"
            >
              Clear basket
            </button>
          </div>
        )}
      </aside>
        </>
      )}
    </>
  );
}
