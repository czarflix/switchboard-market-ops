import type { Metadata } from "next";
import { Fraunces, Space_Grotesk } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  display: "swap",
  preload: false,
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  display: "swap",
  preload: false,
  variable: "--font-fraunces",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Switchboard | AI sourcing for messy local markets",
  description:
    "Switchboard uses ElevenLabs for live intake and Firecrawl for market evidence, then carries the workflow through outreach to one next-step-ready recommendation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${spaceGrotesk.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body
        suppressHydrationWarning
        className="min-h-full bg-[color:var(--background)] text-[color:var(--foreground)]"
      >
        {children}
      </body>
    </html>
  );
}
