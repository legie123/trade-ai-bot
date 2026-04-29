import type { Metadata } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: "TRADE AI — Command Center",
  description: "Bento Grid Dashboard for Algorithmic Trading",
  manifest: "/manifest.json",
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
  maximumScale: 5,
  userScalable: true,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // FAZA FE-1 (2026-04-26): theme switch via env.
  // Default = "dragon" (zero regression). Set NEXT_PUBLIC_INSTITUTIONAL_UI_ENABLED=1
  // in Cloud Run env to swap to institutional palette.
  // Reversal: unset env -> auto fallback to Dragon (no code revert needed).
  // Asumptie: Next.js 16 exposes NEXT_PUBLIC_* la build-time -> SSR-safe.
  const uiMode =
    process.env.NEXT_PUBLIC_INSTITUTIONAL_UI_ENABLED === '1' ? 'institutional' : 'dragon';

  return (
    <html lang="en" data-ui={uiMode}>
      <body className="antialiased dark">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
