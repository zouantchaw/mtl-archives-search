import type { Metadata } from 'next';
import { SignIn } from '@clerk/nextjs';
import { AuthShell, clerkV4Appearance } from '@/components/auth/AuthShell';
import { SITE_URL } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'Se connecter',
  description: 'Connectez-vous à MTL Archives pour accéder au jeu quotidien.',
  alternates: { canonical: `${SITE_URL}/sign-in` },
  robots: { index: false, follow: true },
};

export default function SignInPage() {
  return (
    <AuthShell>
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" appearance={clerkV4Appearance} />
    </AuthShell>
  );
}
