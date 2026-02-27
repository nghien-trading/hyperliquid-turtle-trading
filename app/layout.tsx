import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_NAME = "Nghiện Trading";
const SITE_DESCRIPTION =
  "Live Hyperliquid perpetuals prices, Turtle/Donchian breakout signals, and position sizing. Track mid prices with WebSocket updates and UTC-aligned refresh.";
const SITE_URL = "https://nghien-trading.vercel.app"; // update to your production URL

export const metadata: Metadata = {
  title: {
    default: `${SITE_NAME} | Hyperliquid Turtle Trading`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "Hyperliquid",
    "perpetuals",
    "crypto trading",
    "live prices",
    "Turtle trading",
    "Donchian channel",
    "breakout strategy",
  ],
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: SITE_NAME,
    title: `${SITE_NAME} | Hyperliquid Turtle Trading`,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} | Hyperliquid Turtle Trading`,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
  },
  metadataBase: new URL(SITE_URL),
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
