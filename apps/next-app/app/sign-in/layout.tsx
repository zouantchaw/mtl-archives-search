import { ClerkScopedProvider } from "@/components/ClerkScopedProvider";

export default function SignInLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ClerkScopedProvider>{children}</ClerkScopedProvider>;
}
