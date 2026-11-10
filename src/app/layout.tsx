import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

// Display face for headings and every large numeral (platinum design system).
const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Monospace for all data, labels, hashes, eyebrows, and metadata.
const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

// Use NEXT_PUBLIC_SITE_URL when set so OG images resolve to absolute URLs
// in production. Falls back to a sensible default in local dev.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://subnet71.com'

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0908",
}

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Subnet 71 · Live Bittensor Dashboard',
    template: '%s · Subnet 71',
  },
  description:
    'Open agent competition, benchmarks and auditable results on Bittensor Subnet 71.',
  applicationName: 'Subnet 71 Dashboard',
  icons: {
    icon: '/icon.png?v=2',
    apple: '/apple-icon.png',
  },
  openGraph: {
    type: 'website',
    siteName: 'Subnet 71',
    title: 'Subnet 71 · Live Bittensor Dashboard',
    description:
      'Open agent competition, benchmarks and auditable results for Bittensor Subnet 71.',
    url: SITE_URL,
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'Subnet 71, the open competition for sales research agents',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Subnet 71 · Live Bittensor Dashboard',
    description:
      'Open agent competition, benchmarks and auditable results for Bittensor Subnet 71.',
    images: ['/og.png'],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} ${ibmPlexMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
      </body>
    </html>
  );
}
