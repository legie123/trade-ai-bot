import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TRADE AI — Command Center",
  description: "Bento Grid Dashboard for Algorithmic Trading",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon-192.png?v=3", type: "image/png" },
    ],
    shortcut: ["/icon-192.png?v=3"],
    apple: [
      { url: "/apple-touch-icon.png?v=3", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TRADE AI",
  },
};

export const viewport = {
  themeColor: "#050505",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased dark">{children}</body>
    </html>
  );
}
