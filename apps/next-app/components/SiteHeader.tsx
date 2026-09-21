'use client';

import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useCart } from '@/lib/cart-context';
import { events } from '@/lib/analytics';
import { MtlArchivesLogo } from './LandingHero';

const navigation = [
  { href: '/search', label: 'Explorer', match: (path: string) => path === '/' || path.startsWith('/search') || path.startsWith('/photo/') },
  { href: '/stories', label: 'Histoires', match: (path: string) => path.startsWith('/stories') },
  { href: '/game', label: 'Jeu', match: (path: string) => path.startsWith('/game') },
  { href: '/print', label: 'Impressions', match: (path: string) => path.startsWith('/print') },
];

/** Shared public-site navigation for editorial routes outside the archive explorer. */
export function SiteHeader() {
  const pathname = usePathname();
  const { itemCount, openCart } = useCart();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-5 sm:px-8 lg:px-12">
        <Link href="/" aria-label="MTL Archives — Accueil" className="flex shrink-0 items-center gap-2.5">
          <MtlArchivesLogo size={27} />
          <span className="text-[15px] font-semibold text-foreground">mtl archives</span>
        </Link>

        <nav aria-label="Navigation principale" className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
          <div className="flex min-w-max items-center gap-1 sm:justify-center sm:gap-2">
            {navigation.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={active
                    ? 'rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background'
                    : 'rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        <button
          onClick={() => {
            events.cartOpened();
            openCart();
          }}
          className="relative shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Panier"
        >
          <ShoppingBag className="h-4 w-4" />
          {itemCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
              {itemCount > 9 ? '9+' : itemCount}
            </span>
          ) : null}
        </button>
      </div>
    </header>
  );
}
