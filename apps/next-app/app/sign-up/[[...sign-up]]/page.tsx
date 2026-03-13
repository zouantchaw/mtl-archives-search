import type { Metadata } from 'next';
import { SignUp } from '@clerk/nextjs';
import { AuthShell, clerkV4Appearance } from '@/components/auth/AuthShell';
import { SITE_URL } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'Créer un compte',
  description: 'Créez un compte MTL Archives pour jouer au jeu quotidien.',
  alternates: { canonical: `${SITE_URL}/sign-up` },
  robots: { index: false, follow: true },
};

export default function SignUpPage() {
  return (
    <AuthShell>
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" appearance={clerkV4Appearance} />
    </AuthShell>
  );
}
