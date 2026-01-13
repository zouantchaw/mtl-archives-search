'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { X, Minus, Plus, ShoppingBag, ArrowLeft, Check, Loader2 } from 'lucide-react';
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
    decrease: 'Diminuer la quantite',
    increase: 'Augmenter la quantite',
    // Checkout form
    checkoutTitle: 'Finaliser la commande',
    backToCart: 'Retour au panier',
    name: 'Nom complet',
    namePlaceholder: 'Jean Tremblay',
    email: 'Courriel',
    emailPlaceholder: 'jean@exemple.com',
    phone: 'Telephone (optionnel)',
    phonePlaceholder: '514-555-1234',
    address: 'Adresse de livraison',
    addressPlaceholder: '123 Rue Exemple, Montreal, QC H2X 1Y2',
    notes: 'Notes (optionnel)',
    notesPlaceholder: 'Instructions speciales, questions...',
    submitOrder: 'Envoyer la commande',
    processing: 'Traitement en cours...',
    required: 'Requis',
    // Success
    orderSuccess: 'Commande recue!',
    orderSuccessMessage: 'Merci! Un courriel de confirmation a ete envoye a votre adresse.',
    orderSuccessDetails: 'Notre equipe examinera votre commande et vous contactera dans les 24-48 heures pour finaliser le paiement et la livraison.',
    orderNumber: 'Numero de commande',
    checkEmail: 'Verifiez votre boite de reception',
    continueShopping: 'Continuer a explorer',
    // Errors
    errorTitle: 'Erreur',
    errorMessage: 'Une erreur est survenue. Veuillez reessayer.',
    tryAgain: 'Reessayer',
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
    // Checkout form
    checkoutTitle: 'Complete Your Order',
    backToCart: 'Back to cart',
    name: 'Full Name',
    namePlaceholder: 'John Smith',
    email: 'Email',
    emailPlaceholder: 'john@example.com',
    phone: 'Phone (optional)',
    phonePlaceholder: '514-555-1234',
    address: 'Delivery Address',
    addressPlaceholder: '123 Example St, Montreal, QC H2X 1Y2',
    notes: 'Notes (optional)',
    notesPlaceholder: 'Special instructions, questions...',
    submitOrder: 'Submit Order',
    processing: 'Processing...',
    required: 'Required',
    // Success
    orderSuccess: 'Order Received!',
    orderSuccessMessage: 'Thank you! A confirmation email has been sent to your address.',
    orderSuccessDetails: 'Our team will review your order and contact you within 24-48 hours to finalize payment and delivery.',
    orderNumber: 'Order Number',
    checkEmail: 'Check your inbox',
    continueShopping: 'Continue Exploring',
    // Errors
    errorTitle: 'Error',
    errorMessage: 'Something went wrong. Please try again.',
    tryAgain: 'Try Again',
  },
} as const;

type CheckoutState = 'cart' | 'form' | 'submitting' | 'success' | 'error';

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

  // Checkout state
  const [checkoutState, setCheckoutState] = useState<CheckoutState>('cart');
  const [orderId, setOrderId] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Form fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  // Reset state when drawer closes
  useEffect(() => {
    if (!isOpen) {
      // Only reset to cart view, keep form data for convenience
      if (checkoutState === 'success') {
        setCheckoutState('cart');
        setOrderId('');
        // Clear form after successful order
        setName('');
        setEmail('');
        setPhone('');
        setAddress('');
        setNotes('');
      } else if (checkoutState !== 'form') {
        setCheckoutState('cart');
      }
    }
  }, [isOpen, checkoutState]);

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

  const handleCheckout = () => {
    events.checkoutClicked(total, itemCount);
    setCheckoutState('form');
  };

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !email.trim() || !address.trim()) return;

    setCheckoutState('submitting');
    setErrorMessage('');

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: name.trim(),
          customerEmail: email.trim(),
          customerPhone: phone.trim() || undefined,
          customerAddress: address.trim(),
          customerNotes: notes.trim() || undefined,
          items: items.map(item => ({
            photoId: item.photoId,
            photoName: item.photoName,
            photoUrl: item.photoUrl,
            size: item.size,
            frame: item.frame,
            price: item.price,
            quantity: item.quantity,
          })),
          subtotal: total,
          lang,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setOrderId(data.orderId);
        setCheckoutState('success');
        clearCart();
      } else {
        setErrorMessage(data.error || t.errorMessage);
        setCheckoutState('error');
      }
    } catch (error) {
      console.error('Checkout error:', error);
      setErrorMessage(t.errorMessage);
      setCheckoutState('error');
    }
  };

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
            {checkoutState === 'form' ? (
              <button
                onClick={() => setCheckoutState('cart')}
                className="p-1 hover:bg-neutral-100 rounded-full transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            ) : (
              <ShoppingBag className="h-4 w-4" />
            )}
            <span className="text-xs font-medium uppercase tracking-wide">
              {checkoutState === 'form' || checkoutState === 'submitting'
                ? t.checkoutTitle
                : checkoutState === 'success'
                ? t.orderSuccess
                : `${t.cart} ${itemCount > 0 ? `(${itemCount})` : ''}`}
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
          {/* Success State */}
          {checkoutState === 'success' && (
            <div className="flex flex-col items-center justify-center h-full px-6 text-center">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
                <Check className="h-10 w-10 text-green-600" />
              </div>
              <h2 className="text-xl font-semibold text-neutral-900 mb-2">
                {t.orderSuccess}
              </h2>
              <p className="text-sm text-neutral-600 mb-2">
                {t.orderSuccessMessage}
              </p>
              <p className="text-sm text-neutral-500 mb-6 max-w-xs">
                {t.orderSuccessDetails}
              </p>
              <div className="bg-green-50 border border-green-200 px-6 py-4 rounded-xl mb-6 w-full max-w-xs">
                <p className="text-xs text-green-700 uppercase tracking-wide mb-1">
                  {t.orderNumber}
                </p>
                <p className="text-lg font-mono font-semibold text-green-800">{orderId}</p>
              </div>
              <p className="text-xs text-neutral-400 mb-6">
                {t.checkEmail}
              </p>
              <button
                onClick={closeCart}
                className="px-8 py-3 bg-neutral-900 text-white text-sm font-medium rounded-full hover:bg-neutral-800 transition-colors"
              >
                {t.continueShopping}
              </button>
            </div>
          )}

          {/* Error State */}
          {checkoutState === 'error' && (
            <div className="flex flex-col items-center justify-center h-full px-6 text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-6">
                <X className="h-8 w-8 text-red-600" />
              </div>
              <h2 className="text-lg font-medium text-neutral-900 mb-2">
                {t.errorTitle}
              </h2>
              <p className="text-sm text-neutral-500 mb-6">
                {errorMessage || t.errorMessage}
              </p>
              <button
                onClick={() => setCheckoutState('form')}
                className="px-6 py-3 bg-neutral-900 text-white text-sm font-medium rounded-full hover:bg-neutral-800 transition-colors"
              >
                {t.tryAgain}
              </button>
            </div>
          )}

          {/* Checkout Form */}
          {(checkoutState === 'form' || checkoutState === 'submitting') && (
            <form onSubmit={handleSubmitOrder} className="p-4 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wide mb-1.5">
                  {t.name} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t.namePlaceholder}
                  required
                  disabled={checkoutState === 'submitting'}
                  className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent disabled:opacity-50"
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wide mb-1.5">
                  {t.email} <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.emailPlaceholder}
                  required
                  disabled={checkoutState === 'submitting'}
                  className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent disabled:opacity-50"
                />
              </div>

              {/* Phone */}
              <div>
                <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wide mb-1.5">
                  {t.phone}
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t.phonePlaceholder}
                  disabled={checkoutState === 'submitting'}
                  className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent disabled:opacity-50"
                />
              </div>

              {/* Address */}
              <div>
                <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wide mb-1.5">
                  {t.address} <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder={t.addressPlaceholder}
                  required
                  rows={2}
                  disabled={checkoutState === 'submitting'}
                  className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent disabled:opacity-50 resize-none"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wide mb-1.5">
                  {t.notes}
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t.notesPlaceholder}
                  rows={3}
                  disabled={checkoutState === 'submitting'}
                  className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent disabled:opacity-50 resize-none"
                />
              </div>

              {/* Order Summary */}
              <div className="bg-neutral-50 rounded-lg p-4 mt-4">
                <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide mb-2">
                  {t.subtotal}
                </p>
                <p className="text-lg font-medium">${total}</p>
                <p className="text-xs text-neutral-400 mt-1">
                  {itemCount} {itemCount === 1 ? 'item' : 'items'}
                </p>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={checkoutState === 'submitting' || !name.trim() || !email.trim() || !address.trim()}
                className="w-full py-4 bg-neutral-900 text-white text-sm font-medium uppercase tracking-wide rounded-lg hover:bg-neutral-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {checkoutState === 'submitting' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t.processing}
                  </>
                ) : (
                  <>
                    {t.submitOrder} · ${total}
                  </>
                )}
              </button>
            </form>
          )}

          {/* Cart Items */}
          {checkoutState === 'cart' && (
            <>
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
            </>
          )}
        </div>

        {/* Footer - Only show in cart view with items */}
        {checkoutState === 'cart' && items.length > 0 && (
          <div className="border-t border-neutral-100 p-4 space-y-4">
            {/* Subtotal */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-500">{t.subtotal}</span>
              <span className="text-sm font-medium">${total}</span>
            </div>

            {/* Checkout Button */}
            <button
              className="w-full py-4 bg-neutral-900 text-white text-sm font-medium uppercase tracking-wide hover:bg-neutral-800 transition-colors"
              onClick={handleCheckout}
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
