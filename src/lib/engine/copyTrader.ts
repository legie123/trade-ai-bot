// ============================================================
// Copy Trading — Whale Wallet Tracking on Solana
// Monitors known profitable wallets and mirrors their trades
// ============================================================
import { createLogger } from '@/lib/core/logger';

const log = createLogger('CopyTrader');

// Known whale wallets (Solana-based)
const WHALE_WALLETS: { address: string; label: string; trustScore: number }[] = [
  { address: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', label: 'Whale #1 (SOL DeFi)', trustScore: 85 },
  { address: 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK', label: 'Whale #2 (MEV Bot)', trustScore: 75 },
  { address: 'FmHmABkjKXjwbiR8gUTiuXKHBmvh5EZnK1gPPfGaTJ61', label: 'Whale #3 (Fund)', trustScore: 90 },
];

interface WhaleTransaction {
  wallet: string;
  label: string;
  type: 'BUY' | 'SELL' | 'TRANSFER';
  token: string;
  amount: number;
  usdValue: number | null;
  timestamp: string;
  signature: string;
}

interface CopySignal {
  action: 'BUY' | 'SELL';
  token: string;
  wallet: string;
  walletLabel: string;
  trustScore: number;
  size: 'SMALL' | 'MEDIUM' | 'LARGE';
  suggestedAmount: number;
  reasoning: string;
}

// ─── Monitor Whale Transactions ─────────────────────
export async function getWhaleActivity(): Promise<WhaleTransaction[]> {
  const transactions: WhaleTransaction[] = [];

  for (const whale of WHALE_WALLETS) {
    try {
      // Uses Solana public RPC to get recent transactions
      const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getSignaturesForAddress',
          params: [whale.address, { limit: 5 }],
        }),
      });

      const data = await response.json();
      const signatures = data.result || [];

      for (const sig of signatures) {
        // Parse actual tx type from instruction programs
        let txType: 'BUY' | 'SELL' | 'TRANSFER' = 'TRANSFER';
        let token = 'SOL';
        try {
          const txRes = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0', id: 2,
              method: 'getTransaction',
              params: [sig.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
            }),
          });
          const txData = await txRes.json();
          const instructions = txData.result?.transaction?.message?.instructions || [];
          // Detect DEX swap programs (Jupiter, Raydium, Orca)
          const DEX_PROGRAMS = [
            'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',  // Jupiter v6
            '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM
            'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',  // Orca Whirlpool
          ];
          for (const ix of instructions) {
            const programId = ix.programId || ix.program;
            if (DEX_PROGRAMS.includes(programId)) {
              txType = 'BUY';
              break;
            }
          }
          // Try to detect token from token balance changes
          const postBalances = txData.result?.meta?.postTokenBalances || [];
          if (postBalances.length > 0) {
            token = postBalances[0].mint?.slice(0, 6) || 'SPL';
          }
        } catch {
          // If tx parse fails, keep defaults
        }

        transactions.push({
          wallet: whale.address,
          label: whale.label,
          type: txType,
          token,
          amount: 0,
          usdValue: null,
          timestamp: new Date(sig.blockTime * 1000).toISOString(),
          signature: sig.signature,
        });
      }
    } catch (err) {
      log.error(`Error tracking ${whale.label}`, { error: (err as Error).message });
    }
  }

  // Sort by time
  transactions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return transactions;
}

// ─── Generate Copy Signals ──────────────────────────
export function generateCopySignals(
  transactions: WhaleTransaction[],
  balance: number = 1000
): CopySignal[] {
  const signals: CopySignal[] = [];

  // Group by token to find consensus
  const tokenActivity: Record<string, { buys: number; sells: number; totalValue: number; wallets: string[] }> = {};

  for (const tx of transactions) {
    if (!tokenActivity[tx.token]) {
      tokenActivity[tx.token] = { buys: 0, sells: 0, totalValue: 0, wallets: [] };
    }
    const activity = tokenActivity[tx.token];
    if (tx.type === 'BUY') activity.buys++;
    else if (tx.type === 'SELL') activity.sells++;
    activity.totalValue += tx.usdValue || 0;
    if (!activity.wallets.includes(tx.label)) activity.wallets.push(tx.label);
  }

  for (const [token, activity] of Object.entries(tokenActivity)) {
    if (activity.wallets.length < 1) continue; // Need at least 1 whale

    const action = activity.buys > activity.sells ? 'BUY' : 'SELL';
    const trustScore = WHALE_WALLETS
      .filter(w => activity.wallets.includes(w.label))
      .reduce((acc, w) => acc + w.trustScore, 0) / activity.wallets.length;

    const size = activity.totalValue > 50000 ? 'LARGE' : activity.totalValue > 5000 ? 'MEDIUM' : 'SMALL';
    const suggestedAmount = Math.min(balance * 0.02, 20); // 2% of balance, max $20

    signals.push({
      action,
      token,
      wallet: activity.wallets[0],
      walletLabel: activity.wallets.join(', '),
      trustScore: Math.round(trustScore),
      size,
      suggestedAmount,
      reasoning: `${activity.wallets.length} whale(s) ${action === 'BUY' ? 'buying' : 'selling'} ${token}. Trust: ${Math.round(trustScore)}%`,
    });
  }

  return signals.sort((a, b) => b.trustScore - a.trustScore);
}

// ─── Get Copy Trading Dashboard Data ─────────────────
export async function getCopyTradingData() {
  const activity = await getWhaleActivity();
  const signals = generateCopySignals(activity);

  return {
    wallets: WHALE_WALLETS,
    recentActivity: activity.slice(0, 20),
    signals,
    lastScan: new Date().toISOString(),
    totalWallets: WHALE_WALLETS.length,
  };
}
