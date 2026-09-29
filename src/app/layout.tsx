import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import Footer from "@/components/Footer";
import Header from "@/components/Header";
import Reveal from "@/components/Reveal";

import "./globals.css";

/**
 * next/font self-hosts Inter at build time: no request to Google on page load,
 * no layout shift while it swaps in, and nothing to preconnect to.
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "700", "800", "900"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "PFC — Professional Fighting Championship",
    template: "%s | PFC — Professional Fighting Championship",
  },
  description:
    "Elite boxing, MMA and strength training in Bothasig, Cape Town. Championship coaching for every level.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-ZA" className={inter.variable}>
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>

        <Header />

        <main id="main">{children}</main>

        <Footer />
        <Reveal />
      </body>
    </html>
  );
}
