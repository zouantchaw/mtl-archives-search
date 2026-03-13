import { SignUp } from '@clerk/nextjs';
import { AuthShell, clerkV4Appearance } from '@/components/auth/AuthShell';

export default function SignUpPage() {
  return (
    <AuthShell>
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" appearance={clerkV4Appearance} />
    </AuthShell>
  );
}
