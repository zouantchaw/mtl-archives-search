import { ClerkLocalized } from "@/components/ClerkLocalized";

export default function SignUpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ClerkLocalized>{children}</ClerkLocalized>;
}

