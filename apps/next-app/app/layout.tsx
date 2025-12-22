import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";

const figtree = Figtree({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0a0a0a',
};

export const metadata: Metadata = {
  title: "MTL Archives - Historical Photos of Montreal",
  description: "Explore and discover historical photos of Montreal. Search by street, neighborhood, or landmark.",
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'MTL Archives',
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${figtree.variable} dark`}>
      <body className="font-sans antialiased bg-neutral-950 text-white overflow-hidden">
        {children}
      </body>
    </html>
  );
}
