'use client';

import { useEffect, useState } from 'react';

interface DeepSeekData {
  balance: number;
  displayBalance: string;
  monthlyExpense: number;
  displayExpense: string;
  warningLevel: 'OK' | 'WARNING' | 'CRITICAL';
  topUpRecommended: boolean;
  totalTokens: number;
  apiRequests: number;
  percentageUsed: string;
  estimatedRunwayDays: number | null;
}

export default function DeepSeekStatus() {
  const [data, setData] = useState<DeepSeekData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/v2/deepseek-status');
        if (!res.ok) throw new Error('Failed to fetch DeepSeek status');
        const json = await res.json();
        setData(json.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
    // Refresh every 5 minutes
    const interval = setInterval(fetchStatus, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div className="text-xs text-gray-500">Loading DeepSeek status...</div>;
  if (error) return <div className="text-xs text-red-500">Error: {error}</div>;
  if (!data) return <div className="text-xs text-gray-500">DeepSeek not configured</div>;

  const bgColor = {
    OK: 'bg-green-900/20 border-green-500/30',
    WARNING: 'bg-yellow-900/20 border-yellow-500/30',
    CRITICAL: 'bg-red-900/20 border-red-500/30',
  }[data.warningLevel];

  const textColor = {
    OK: 'text-green-400',
    WARNING: 'text-yellow-400',
    CRITICAL: 'text-red-400',
  }[data.warningLevel];

  return (
    <div className={`p-3 rounded border ${bgColor} backdrop-blur`}>
      <div className="flex justify-between items-start">
        <div>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            DeepSeek API Credit
          </div>
          <div className={`text-lg font-bold ${textColor} mt-1`}>
            {data.displayBalance}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            Monthly: {data.displayExpense} ({data.percentageUsed}% used)
          </div>
        </div>

        <div className="text-right">
          <div className="text-2xl font-bold text-white">{data.apiRequests.toLocaleString()}</div>
          <div className="text-xs text-gray-400">API requests</div>

          {data.estimatedRunwayDays !== null && (
            <div className="mt-2 text-xs">
              <span className={data.estimatedRunwayDays <= 7 ? 'text-yellow-400' : 'text-gray-400'}>
                ~{data.estimatedRunwayDays}d runway
              </span>
            </div>
          )}
        </div>
      </div>

      {data.topUpRecommended && (
        <div className="mt-3 p-2 bg-red-900/40 rounded border border-red-500/50 text-xs text-red-300">
          ⚠️ Low balance! Top up soon: https://platform.deepseek.com
        </div>
      )}

      <div className="text-xs text-gray-500 mt-2">
        {data.totalTokens.toLocaleString()} total tokens
      </div>
    </div>
  );
}
