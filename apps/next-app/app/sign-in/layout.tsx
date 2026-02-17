import { ClerkLocalized } from "@/components/ClerkLocalized";

export default function SignInLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ClerkLocalized>{children}</ClerkLocalized>;
}

