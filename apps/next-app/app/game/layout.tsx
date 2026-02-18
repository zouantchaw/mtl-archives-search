import { ClerkScopedProvider } from "@/components/ClerkScopedProvider";

export default function GameLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ClerkScopedProvider>{children}</ClerkScopedProvider>;
}
