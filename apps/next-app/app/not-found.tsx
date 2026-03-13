import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="min-h-screen bg-background px-5 py-12 sm:px-12">
      <div className="mx-auto flex min-h-[75vh] max-w-3xl flex-col items-center justify-center text-center">
        <p className="mono-metric text-[11px] text-primary">404</p>
        <h1 className="text-display mt-5 text-[3rem] font-semibold tracking-[-0.04em] text-foreground sm:text-[4.4rem]">
          Cette page est introuvable.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-8 text-muted-foreground">
          Le lien a peut-être changé, ou la page n’existe plus dans cette nouvelle couche du site.
        </p>
        <div className="mt-8 flex w-full max-w-xl flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="inline-flex h-12 items-center justify-center rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/92"
          >
            Retour à l’accueil
          </Link>
          <Link
            href="/search"
            className="inline-flex h-12 items-center justify-center rounded-full border border-input px-6 text-sm font-medium text-foreground transition-colors hover:bg-card"
          >
            Explorer les archives
          </Link>
        </div>
      </div>
    </main>
  );
}
