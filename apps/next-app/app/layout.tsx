import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import Script from "next/script";
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
    <html lang="en" className={`${figtree.variable}`}>
      <head>
        <Script
          src="https://cdn.seline.com/seline.js"
          data-token="ba441af9ffc2d81"
          strategy="afterInteractive"
        />
      </head>
      <body className="font-sans antialiased bg-neutral-50 text-neutral-900 min-h-screen">
        {children}
      </body>
    </html>
  );
}
