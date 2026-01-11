import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const figtree = Figtree({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://mtlarchives.com';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'MTL Archives — Photos historiques de Montréal',
    template: '%s | MTL Archives',
  },
  description: 'Explorez 14 822 photos historiques de Montréal. Recherchez par rue, quartier ou lieu emblématique. Explore 14,822 historical photos of Montreal.',
  keywords: [
    'Montreal', 'Montréal', 'archives', 'photos', 'historical', 'historique',
    'history', 'histoire', 'Quebec', 'Québec', 'vintage', 'old photos',
    'Vieux-Montréal', 'Old Montreal', 'patrimoine', 'heritage'
  ],
  authors: [{ name: 'MTL Archives' }],
  creator: 'MTL Archives',
  publisher: 'MTL Archives',
  
  // Open Graph
  openGraph: {
    type: 'website',
    locale: 'fr_CA',
    alternateLocale: 'en_CA',
    url: siteUrl,
    siteName: 'MTL Archives',
    title: 'MTL Archives — Photos historiques de Montréal',
    description: 'Explorez 14 822 photos historiques de Montréal. Recherchez par rue, quartier ou lieu emblématique.',
    images: [
      {
        url: '/og-image.jpg',
        width: 1200,
        height: 630,
        alt: 'MTL Archives - Photos historiques de Montréal',
      },
    ],
  },
  
  // Twitter Card
  twitter: {
    card: 'summary_large_image',
    title: 'MTL Archives — Photos historiques de Montréal',
    description: 'Explorez 14 822 photos historiques de Montréal.',
    images: ['/og-image.jpg'],
    creator: '@mtlarchives',
  },
  
  // Icons - using Next.js generated icons
  // icon.tsx, apple-icon.tsx handle dynamic generation
  
  // App configuration
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'MTL Archives',
  },
  
  // Other
  formatDetection: {
    telephone: false,
  },
  
  // Robots
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  
  // Verification (add your IDs when ready)
  // verification: {
  //   google: 'your-google-verification-code',
  // },
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
