'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

export type CartItem = {
  id: string; // unique id for this cart item
  photoId: string;
  photoName: string;
  photoUrl: string;
  size: string;
  sizeId: string;
  frame: string;
  frameId: string;
  price: number;
  quantity: number;
};

type CartContextType = {
  items: CartItem[];
  itemCount: number;
  total: number;
  isOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
  toggleCart: () => void;
  addItem: (item: Omit<CartItem, 'id' | 'quantity'>) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearItems: () => void;
  clearCart: () => void;
};

const CartContext = createContext<CartContextType | undefined>(undefined);

const CART_STORAGE_KEY = 'mtl-archives-cart';

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  // Load cart from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CART_STORAGE_KEY);
      if (stored) {
        setItems(JSON.parse(stored));
      }
    } catch {
      // Ignore localStorage errors
    }
    setIsHydrated(true);
  }, []);

  // Save cart to localStorage when it changes
  useEffect(() => {
    if (isHydrated) {
      try {
        localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
      } catch {
        // Ignore localStorage errors
      }
    }
  }, [items, isHydrated]);

  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const openCart = useCallback(() => setIsOpen(true), []);
  const closeCart = useCallback(() => setIsOpen(false), []);
  const toggleCart = useCallback(() => setIsOpen(prev => !prev), []);

  const addItem = useCallback((newItem: Omit<CartItem, 'id' | 'quantity'>) => {
    setItems(prev => {
      // Check if same photo + size + frame combo exists
      const existing = prev.find(
        item => 
          item.photoId === newItem.photoId && 
          item.sizeId === newItem.sizeId && 
          item.frameId === newItem.frameId
      );

      if (existing) {
        // Increment quantity
        return prev.map(item =>
          item.id === existing.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }

      // Add new item
      const id = `${newItem.photoId}-${newItem.sizeId}-${newItem.frameId}-${Date.now()}`;
      return [...prev, { ...newItem, id, quantity: 1 }];
    });

    // Open cart drawer when item is added
    setIsOpen(true);
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  }, []);

  const updateQuantity = useCallback((id: string, quantity: number) => {
    if (quantity <= 0) {
      setItems(prev => prev.filter(item => item.id !== id));
    } else {
      setItems(prev =>
        prev.map(item => (item.id === id ? { ...item, quantity } : item))
      );
    }
  }, []);

  const clearItems = useCallback(() => {
    setItems([]);
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setIsOpen(false);
  }, []);

  return (
    <CartContext.Provider
      value={{
        items,
        itemCount,
        total,
        isOpen,
        openCart,
        closeCart,
        toggleCart,
        addItem,
        removeItem,
        updateQuantity,
        clearItems,
        clearCart,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
