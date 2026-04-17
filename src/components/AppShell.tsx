'use client';

import Sidebar from '@/components/Sidebar';
import BottomNav from '@/components/BottomNav';
import CommandPalette from '@/components/CommandPalette';
import SwRegister from '@/components/SwRegister';
import GoldDust from '@/components/GoldDust';
import ErrorBoundary from '@/components/ErrorBoundary';

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
    <div className="app-shell">
      <GoldDust />
      <Sidebar />
      <main className="app-main" role="main">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
      <BottomNav />
      <CommandPalette />
      <SwRegister />
    </div>
    </ErrorBoundary>
  );
}
