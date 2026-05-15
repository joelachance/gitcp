import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "GitFinder",
  description: "Download GitFinder for macOS.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={GeistMono.variable}>
      <body className={`${GeistMono.className} min-h-screen antialiased`}>
        {children}
      </body>
    </html>
  );
}
