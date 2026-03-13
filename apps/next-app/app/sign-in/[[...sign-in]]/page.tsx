import { SignIn } from '@clerk/nextjs';
import { AuthShell, clerkV4Appearance } from '@/components/auth/AuthShell';

export default function SignInPage() {
  return (
    <AuthShell>
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" appearance={clerkV4Appearance} />
    </AuthShell>
  );
}
