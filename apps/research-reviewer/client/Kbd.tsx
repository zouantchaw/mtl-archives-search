import type { ReactNode } from "react";
// Keyboard hint; hidden on touch layouts where keys do not apply.
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="kbd" aria-hidden="true">
      {children}
    </kbd>
  );
}
