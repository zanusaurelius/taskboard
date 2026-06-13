import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import Script from "next/script";
import ThemeRegistry from "@/components/ThemeRegistry";
import AuthProvider from "@/components/AuthProvider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://taskboard.spartanatlas.com"),
  title: "Taskboard — Tasks, notes, and journal",
  description: "A full-featured task board with notes, journal, encrypted vault, and file storage.",
  openGraph: {
    title: "Taskboard — Tasks, notes, and journal",
    description: "A full-featured task board with notes, journal, encrypted vault, and file storage.",
    url: "https://taskboard.spartanatlas.com",
    siteName: "Taskboard",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Taskboard — Tasks, notes, and journal",
    description: "A full-featured task board with notes, journal, encrypted vault, and file storage.",
  },
};

export const viewport: Viewport = {
  themeColor: "#6366f1",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? "";
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body>
        {/* Runs before paint to avoid flash of wrong theme */}
        <Script id="theme-init" strategy="beforeInteractive">{`(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){}})();`}</Script>
        <AuthProvider>
          <ThemeRegistry nonce={nonce}>{children}</ThemeRegistry>
        </AuthProvider>
      </body>
    </html>
  );
}
