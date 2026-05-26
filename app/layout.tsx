import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import ThemeRegistry from "@/components/ThemeRegistry";
import AuthProvider from "@/components/AuthProvider";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Task Board",
  description: "A standalone kanban task board",
};

export const viewport: Viewport = {
  themeColor: "#6366f1",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? "";
  return (
    <html lang="en" className={inter.className}>
      <body>
        <AuthProvider>
          <ThemeRegistry nonce={nonce}>{children}</ThemeRegistry>
        </AuthProvider>
      </body>
    </html>
  );
}
