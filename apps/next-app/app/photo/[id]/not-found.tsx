import Link from 'next/link';

export default function PhotoNotFound() {
  return (
    <div className="min-h-screen bg-[#fafafa] flex flex-col items-center justify-center gap-6 px-4">
      <div className="text-center">
        <h2 className="text-lg font-medium text-neutral-900 mb-2">
          Photo non trouvée
        </h2>
        <p className="text-sm text-neutral-500">
          Cette photo n&apos;existe pas ou a été déplacée
        </p>
      </div>

      <Link
        href="/"
        className="px-4 py-2 text-sm font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded-full transition-colors"
      >
        Retour à l&apos;accueil
      </Link>
    </div>
  );
}
