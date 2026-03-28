import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TRADE AI — Command Center",
  description: "Bento Grid Dashboard for Algorithmic Trading",
  manifest: "/manifest.json?v=4",
  icons: {
    icon: [
      { url: "/app-icon-gold.png", type: "image/png" },
    ],
    shortcut: ["/app-icon-gold.png"],
    apple: [
      { url: "/apple-icon-gold.png", sizes: "180x180", type: "image/png" },
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
