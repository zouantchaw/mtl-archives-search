'use client';

import { Suspense, useEffect } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { ShoppingBag, X } from 'lucide-react';
import { useCart } from '@/lib/cart-context';
import { events } from '@/lib/analytics';
import { appendLangParam, getLangFromSearchParams } from '@/lib/i18n';

const translations = {
  fr: {
    cart: 'Panier',
    emptyCart: 'Votre panier est vide',
    remove: 'Retirer',
    subtotal: 'Sous-total',
    shippingLater: 'Livraison et paiement sécurisés à l’étape suivante',
    checkout: 'Passer la commande',
    closeCart: 'Fermer le panier',
    fulfillment: 'Imprime a Montreal · Le delai estime s’ajuste selon la destination',
    clearCart: 'Vider le panier',
  },
  en: {
    cart: 'Cart',
    emptyCart: 'Your cart is empty',
    remove: 'Remove',
    subtotal: 'Subtotal',
    shippingLater: 'Shipping and secure payment handled at checkout',
    checkout: 'Proceed to checkout',
    closeCart: 'Close cart',
    fulfillment: 'Printed in Montreal · Delivery estimate adjusts by destination',
    clearCart: 'Clear cart',
  },
} as const;

export function CartDrawer() {
  return (
    <Suspense fallback={null}>
      <CartDrawerInner />
    </Suspense>
  );
}

function CartDrawerInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const lang = getLangFromSearchParams(searchParams);
  const t = translations[lang];
  const { items, itemCount, total, isOpen, closeCart, removeItem, clearCart } = useCart();

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeCart();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [closeCart, isOpen]);

  if (!isOpen) return null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[80] bg-brand-charcoal/22 backdrop-blur-sm"
        onClick={closeCart}
        aria-label={t.closeCart}
      />

      <aside className="fixed inset-y-0 right-0 z-[90] flex w-full max-w-[28rem] flex-col bg-background shadow-[var(--shadow-floating)]">
        <header className="flex items-center justify-between border-b border-border px-5 py-5">
          <div className="flex items-center gap-3">
            <ShoppingBag className="h-4 w-4 text-foreground" />
            <h2 className="text-display text-[2rem] font-semibold leading-none tracking-[-0.03em] text-foreground">
              {t.cart}
            </h2>
          </div>
          <button
            type="button"
            onClick={closeCart}
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t.closeCart}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5">
          {items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <ShoppingBag className="h-10 w-10 text-muted-foreground/45" />
              <p className="text-sm text-muted-foreground">{t.emptyCart}</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {items.map((item) => (
                <div key={item.id} className="flex gap-3 py-4">
                  <div className="relative h-15 w-20 overflow-hidden rounded-xl bg-muted">
                    {item.photoUrl ? (
                      <Image src={item.photoUrl} alt={item.photoName} fill className="object-cover" sizes="80px" unoptimized />
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="line-clamp-2 text-sm font-medium text-foreground">{item.photoName}</p>
                        <p className="mono-metric mt-1 text-[10px] text-muted-foreground">
                          {item.size} · {item.frame}
                          {item.quantity > 1 ? ` · ${item.quantity}x` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          events.cartItemRemoved(item.photoId);
                          removeItem(item.id);
                        }}
                        className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        aria-label={t.remove}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="mt-2 text-xl font-semibold tracking-[-0.02em] text-foreground">{item.price * item.quantity} $</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {items.length > 0 ? (
          <footer className="border-t border-border px-5 py-5">
            <div className="flex items-center justify-between text-lg font-semibold tracking-[-0.02em] text-foreground">
              <span>{t.subtotal}</span>
              <span>{total} $</span>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{t.shippingLater}</p>
            <button
              type="button"
              className="mt-5 inline-flex h-12 w-full items-center justify-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/92"
              onClick={() => {
                events.checkoutClicked(total, itemCount);
                closeCart();
                router.push(appendLangParam('/checkout', lang));
              }}
            >
              {t.checkout}
            </button>
            <p className="mt-4 text-center text-xs text-muted-foreground">{t.fulfillment}</p>
            <button
              type="button"
              onClick={() => {
                events.cartCleared(itemCount);
                clearCart();
              }}
              className="mt-4 w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {t.clearCart}
            </button>
          </footer>
        ) : null}
      </aside>
    </>
  );
}
