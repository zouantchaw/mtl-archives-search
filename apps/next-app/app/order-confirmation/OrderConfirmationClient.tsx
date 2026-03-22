'use client';

import { useEffect } from 'react';
import { events } from '@/lib/analytics';
import { useCart } from '@/lib/cart-context';
import { CHECKOUT_DRAFT_STORAGE_KEY } from '@/lib/checkout';

type OrderConfirmationClientProps = {
  confirmed: boolean;
  sessionId?: string;
  orderId?: string;
  total?: number;
  itemCount?: number;
  itemSummary?: string;
};

export function OrderConfirmationClient({
  confirmed,
  sessionId,
  orderId,
  total,
  itemCount,
  itemSummary,
}: OrderConfirmationClientProps) {
  const { clearCart } = useCart();

  useEffect(() => {
    if (!confirmed || !sessionId) return;

    clearCart();

    try {
      window.sessionStorage.removeItem(CHECKOUT_DRAFT_STORAGE_KEY);

      const trackingKey = `mtl-archives-order-tracked:${sessionId}`;
      if (window.sessionStorage.getItem(trackingKey) === '1') {
        return;
      }

      if (orderId && typeof total === 'number' && typeof itemCount === 'number') {
        events.checkoutCompleted(orderId, total, itemCount, itemSummary);
      }

      window.sessionStorage.setItem(trackingKey, '1');
    } catch {
      // Ignore sessionStorage failures.
    }
  }, [clearCart, confirmed, itemCount, itemSummary, orderId, sessionId, total]);

  return null;
}
