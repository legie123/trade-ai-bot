'use client';

import { useEffect, useState } from 'react';

interface ApiData {
  status: string;
  balance: string;
  is_available?: boolean;
}

interface CreditsResponse {
  openai: ApiData;
  deepseek: ApiData;
}

export default function ApiCreditsDashboard() {
  const [data, setData] = useState<CreditsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCredits = async () => {
    try {
      const res = await fetch('/api/diagnostics/credits');
      if (res.ok) {
         setData(await res.json());
      }
    } catch {
      // Slient ignore on failure
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCredits();
    // Refresh every 60s
    const interval = setInterval(fetchCredits, 60000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string) => {
    if (status === 'ACTIVE') return 'text-green-500 shadow-green-500/50';
    if (status === 'QUOTA_EXCEEDED' || status === 'INACTIVE') return 'text-red-500 shadow-red-500/50';
    if (status === 'MISSING_KEY') return 'text-yellow-500 shadow-yellow-500/50';
    return 'text-zinc-500 shadow-zinc-500/50';
  };

  const getStatusDot = (status: string) => {
    if (status === 'ACTIVE') return 'bg-green-500 animate-pulse';
    if (status === 'QUOTA_EXCEEDED' || status === 'INACTIVE') return 'bg-red-500 animate-pulse';
    if (status === 'MISSING_KEY') return 'bg-yellow-500';
    return 'bg-zinc-500';
  };

  if (loading) {
     return <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl animate-pulse h-32" />;
  }

  return (
    <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl backdrop-blur-md">
      <h3 className="text-[10px] font-bold text-zinc-500 tracking-widest uppercase mb-4 flex items-center gap-2">
        <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
        Neural Core Limits
      </h3>
      
      <div className="grid grid-cols-2 gap-4">
        {/* OpenAI Core */}
        <div className="flex flex-col gap-1 p-3 bg-black/40 rounded-lg border border-zinc-800/50 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent pointer-events-none" />
          <div className="flex items-center justify-between z-10">
            <span className="text-xs font-semibold text-zinc-300">OpenAI (Gpt-4o)</span>
            <div className={`w-2 h-2 rounded-full ${getStatusDot(data?.openai.status || '')}`} />
          </div>
          <div className="mt-1 flex items-baseline gap-2 z-10">
            <span className={`font-mono text-sm font-bold ${getStatusColor(data?.openai.status || '')}`}>
               {data?.openai.status === 'ACTIVE' ? 'ONLINE' : data?.openai.status}
            </span>
            <span className="text-[10px] text-zinc-600">No Limit Tracking</span>
          </div>
        </div>

        {/* DeepSeek Oracle */}
        <div className="flex flex-col gap-1 p-3 bg-black/40 rounded-lg border border-zinc-800/50 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent pointer-events-none" />
          <div className="flex items-center justify-between z-10">
            <span className="text-xs font-semibold text-zinc-300">DeepSeek (Oracle)</span>
            <div className={`w-2 h-2 rounded-full ${getStatusDot(data?.deepseek.status || '')}`} />
          </div>
          <div className="mt-1 flex items-baseline gap-2 z-10">
             <span className={`font-mono text-sm font-bold ${getStatusColor(data?.deepseek.status || '')}`}>
               {data?.deepseek.balance}
             </span>
             <span className="text-[10px] text-zinc-500">{data?.deepseek.status}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
