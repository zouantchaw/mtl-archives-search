import { ClerkLocalized } from "@/components/ClerkLocalized";

export default function GameLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ClerkLocalized>{children}</ClerkLocalized>;
}

