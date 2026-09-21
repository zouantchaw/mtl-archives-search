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
      <div className="flex h-[52px] items-center gap-3 px-5 sm:hidden">
        <Link href="/" aria-label="MTL Archives — Accueil" className="flex shrink-0 items-center gap-2">
          <MtlArchivesLogo size={24} />
          <span className="text-[15px] font-semibold text-foreground">mtl archives</span>
        </Link>
        <nav aria-label="Navigation principale" className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
          <div className="flex min-w-max items-center gap-1">
            {navigation.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={active
                    ? 'px-2 py-1 text-xs font-semibold text-primary'
                    : 'px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground'}
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

      <div className="hidden h-14 items-center justify-between px-12 sm:flex">
        <Link href="/" aria-label="MTL Archives — Accueil" className="flex shrink-0 items-center gap-2.5">
          <MtlArchivesLogo size={28} />
          <span className="text-[16px] font-semibold text-foreground">mtl archives</span>
        </Link>
        <div className="flex items-center gap-8">
          <nav aria-label="Navigation principale" className="flex items-center gap-8">
            {navigation.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={active
                    ? 'text-[14px] font-medium text-primary'
                    : 'text-[14px] text-foreground/60 transition-colors hover:text-foreground'}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <button
            onClick={() => {
              events.cartOpened();
              openCart();
            }}
            className="relative p-1.5 text-muted-foreground/70 transition-colors hover:text-muted-foreground"
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
      </div>
    </header>
  );
}
