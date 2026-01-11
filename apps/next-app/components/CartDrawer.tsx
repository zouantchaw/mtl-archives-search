'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { X, Minus, Plus, ShoppingBag } from 'lucide-react';
import Image from 'next/image';
import { useCart } from '@/lib/cart-context';
import { events } from '@/lib/analytics';

type Lang = 'fr' | 'en';

const translations = {
  fr: {
    cart: 'Panier',
    emptyCart: 'Votre panier est vide',
    remove: 'Retirer',
    subtotal: 'Sous-total',
    checkout: 'Passer la commande',
    clearCart: 'Vider le panier',
    closeCart: 'Fermer le panier',
    decrease: 'Diminuer la quantité',
    increase: 'Augmenter la quantité',
    comingSoon: 'Paiement bientôt disponible!',
  },
  en: {
    cart: 'Cart',
    emptyCart: 'Your cart is empty',
    remove: 'Remove',
    subtotal: 'Subtotal',
    checkout: 'Checkout',
    clearCart: 'Clear cart',
    closeCart: 'Close cart',
    decrease: 'Decrease quantity',
    increase: 'Increase quantity',
    comingSoon: 'Checkout coming soon!',
  },
} as const;

// Wrapper component to handle Suspense boundary for useSearchParams
export function CartDrawer() {
  return (
    <Suspense fallback={null}>
      <CartDrawerInner />
    </Suspense>
  );
}

function CartDrawerInner() {
  const searchParams = useSearchParams();
  const lang = (searchParams.get('lang') as Lang) || 'fr';
  const t = translations[lang];
  
  const { items, itemCount, total, isOpen, closeCart, removeItem, updateQuantity, clearCart } = useCart();

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCart();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [closeCart]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[80] transition-opacity"
        onClick={closeCart}
      />

      {/* Drawer - Right side on all screens */}
      <div className="fixed inset-y-0 right-0 z-[90] w-full max-w-md bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between h-14 px-4 border-b border-neutral-100">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wide">
              {t.cart} {itemCount > 0 && `(${itemCount})`}
            </span>
          </div>
          <button
            onClick={closeCart}
            className="p-2 hover:bg-neutral-100 rounded-full transition-colors"
            aria-label={t.closeCart}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-neutral-400">
              <ShoppingBag className="h-12 w-12 mb-4 stroke-1" />
              <p className="text-sm">{t.emptyCart}</p>
            </div>
          ) : (
            <div className="divide-y divide-neutral-100">
              {items.map((item) => (
                <div key={item.id} className="p-4 flex gap-4">
                  {/* Thumbnail */}
                  <div className="relative w-20 h-20 bg-neutral-100 flex-shrink-0">
                    {item.photoUrl && (
                      <Image
                        src={item.photoUrl}
                        alt={item.photoName}
                        fill
                        sizes="80px"
                        className="object-cover"
                      />
                    )}
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-neutral-900 truncate">
                      {item.photoName}
                    </h3>
                    <p className="text-xs text-neutral-400 mt-0.5">
                      {item.size} · {item.frame}
                    </p>
                    <p className="text-sm font-medium mt-2">${item.price}</p>

                    {/* Quantity controls */}
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        className="p-1 hover:bg-neutral-100 rounded transition-colors"
                        aria-label={t.decrease}
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="text-xs w-6 text-center">{item.quantity}</span>
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        className="p-1 hover:bg-neutral-100 rounded transition-colors"
                        aria-label={t.increase}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => {
                          events.cartItemRemoved(item.photoId);
                          removeItem(item.id);
                        }}
                        className="ml-auto text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
                      >
                        {t.remove}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="border-t border-neutral-100 p-4 space-y-4">
            {/* Subtotal */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-500">{t.subtotal}</span>
              <span className="text-sm font-medium">${total}</span>
            </div>

            {/* Checkout Button */}
            <button
              className="w-full py-4 bg-neutral-900 text-white text-sm font-medium uppercase tracking-wide hover:bg-neutral-800 transition-colors"
              onClick={() => {
                events.checkoutClicked(total, itemCount);
                alert(t.comingSoon);
              }}
            >
              {t.checkout} · ${total}
            </button>

            {/* Clear cart link */}
            <button
              onClick={() => {
                events.cartCleared(itemCount);
                clearCart();
              }}
              className="w-full text-center text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
            >
              {t.clearCart}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
