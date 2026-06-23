import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

// Use NEXT_PUBLIC_SITE_URL when set so OG images resolve to absolute URLs
// in production. Falls back to a sensible default in local dev.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://dashboard.leadpoet.com'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Leadpoet · Live Subnet Dashboard',
    template: '%s · Leadpoet',
  },
  description:
    'Real-time fulfillment reporting and FAQ for Leadpoet on Bittensor Subnet 71.',
  applicationName: 'Leadpoet Subnet Dashboard',
  icons: {
    icon: '/icon.png',
    apple: '/icon-64.png',
  },
  openGraph: {
    type: 'website',
    siteName: 'Leadpoet',
    title: 'Leadpoet · Live Subnet Dashboard',
    description:
      'Real-time fulfillment reporting and FAQ for Bittensor Subnet 71.',
    url: SITE_URL,
    images: [
      {
        url: '/icon-64.png',
        width: 512,
        height: 512,
        alt: 'Leadpoet',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: 'Leadpoet · Live Subnet Dashboard',
    description:
      'Real-time fulfillment reporting and FAQ for Bittensor Subnet 71.',
    images: ['/icon-64.png'],
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
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
      </body>
    </html>
  );
}
