import { ClerkScopedProvider } from "@/components/ClerkScopedProvider";

export default function SignUpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ClerkScopedProvider>{children}</ClerkScopedProvider>;
}
