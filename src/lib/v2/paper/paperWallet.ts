// ============================================================
// Paper Wallet Engine — AUDIT BUILD CRITIC-2
// Real capital tracking per gladiator with fees, slippage, compounding
// ============================================================
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PaperWallet');

export interface PaperWalletState {
  gladiatorId: string;
  balance: number;           // Current USDT balance
  startBalance: number;      // Initial deposit
  totalTrades: number;
  totalFeesPaid: number;     // Cumulative fees
  totalSlippage: number;     // Cumulative slippage cost
  peakBalance: number;       // All-time high for drawdown calc
  maxDrawdownPercent: number; // Worst drawdown observed
  lastUpdated: number;
}

export interface PaperTradeResult {
  gladiatorId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  quantity: number;
  usdAmount: number;
  fee: number;               // Fee deducted
  slippage: number;          // Slippage deducted
  executed: boolean;
  error?: string;
  balanceAfter: number;
}

// ─── Configuration ──────────────────────────
const PAPER_CONFIG = {
  DEFAULT_START_BALANCE: 10000,    // $10k per gladiator
  FEE_RATE: 0.002,                 // 0.2% per side (MEXC taker fee)
  SLIPPAGE_MIN: 0.0005,            // 0.05% minimum slippage
  SLIPPAGE_MAX: 0.0015,            // 0.15% maximum slippage
  MAX_POSITION_PERCENT: 0.05,      // 5% of balance per trade
  MIN_TRADE_USD: 10,               // Minimum $10 per trade
};

// ─── In-memory wallet store (persisted via DB) ──
const wallets = new Map<string, PaperWalletState>();

/**
 * Get or create a paper wallet for a gladiator
 */
export function getWallet(gladiatorId: string): PaperWalletState {
  if (!wallets.has(gladiatorId)) {
    wallets.set(gladiatorId, {
      gladiatorId,
      balance: PAPER_CONFIG.DEFAULT_START_BALANCE,
      startBalance: PAPER_CONFIG.DEFAULT_START_BALANCE,
      totalTrades: 0,
      totalFeesPaid: 0,
      totalSlippage: 0,
      peakBalance: PAPER_CONFIG.DEFAULT_START_BALANCE,
      maxDrawdownPercent: 0,
      lastUpdated: Date.now(),
    });
  }
  return wallets.get(gladiatorId)!;
}

/**
 * Initialize a wallet with custom balance
 */
export function initWallet(gladiatorId: string, startBalance: number = PAPER_CONFIG.DEFAULT_START_BALANCE): PaperWalletState {
  const wallet: PaperWalletState = {
    gladiatorId,
    balance: startBalance,
    startBalance,
    totalTrades: 0,
    totalFeesPaid: 0,
    totalSlippage: 0,
    peakBalance: startBalance,
    maxDrawdownPercent: 0,
    lastUpdated: Date.now(),
  };
  wallets.set(gladiatorId, wallet);
  return wallet;
}

/**
 * Compute random slippage within configured range
 */
function computeSlippage(): number {
  return PAPER_CONFIG.SLIPPAGE_MIN + Math.random() * (PAPER_CONFIG.SLIPPAGE_MAX - PAPER_CONFIG.SLIPPAGE_MIN);
}

/**
 * Execute a paper trade with REAL capital constraints
 * Returns executed:false if insufficient balance, too small, etc.
 */
export function executePaperTrade(
  gladiatorId: string,
  symbol: string,
  side: 'BUY' | 'SELL',
  price: number,
  requestedUsdAmount?: number,
): PaperTradeResult {
  const wallet = getWallet(gladiatorId);

  // Position sizing: max 5% of current balance
  const maxTradeSize = wallet.balance * PAPER_CONFIG.MAX_POSITION_PERCENT;
  const tradeAmount = Math.min(requestedUsdAmount || maxTradeSize, maxTradeSize);

  // Minimum trade check
  if (tradeAmount < PAPER_CONFIG.MIN_TRADE_USD) {
    return {
      gladiatorId, symbol, side, entryPrice: price, quantity: 0,
      usdAmount: 0, fee: 0, slippage: 0, executed: false,
      error: `Trade size $${tradeAmount.toFixed(2)} below minimum $${PAPER_CONFIG.MIN_TRADE_USD}`,
      balanceAfter: wallet.balance,
    };
  }

  // Insufficient balance check
  if (side === 'BUY' && tradeAmount > wallet.balance) {
    return {
      gladiatorId, symbol, side, entryPrice: price, quantity: 0,
      usdAmount: tradeAmount, fee: 0, slippage: 0, executed: false,
      error: `Insufficient balance: $${wallet.balance.toFixed(2)} < $${tradeAmount.toFixed(2)}`,
      balanceAfter: wallet.balance,
    };
  }

  // Compute costs
  const slippageRate = computeSlippage();
  const slippageCost = tradeAmount * slippageRate;
  const fee = tradeAmount * PAPER_CONFIG.FEE_RATE;
  const totalCost = fee + slippageCost;

  // Effective entry price after slippage
  const effectivePrice = side === 'BUY'
    ? price * (1 + slippageRate)
    : price * (1 - slippageRate);

  const quantity = tradeAmount / effectivePrice;

  // Deduct costs from balance
  wallet.balance -= totalCost;
  wallet.totalFeesPaid += fee;
  wallet.totalSlippage += slippageCost;
  wallet.totalTrades++;
  wallet.lastUpdated = Date.now();

  log.info(`[PAPER] ${side} ${symbol} | $${tradeAmount.toFixed(2)} @ $${effectivePrice.toFixed(4)} | Fee: $${fee.toFixed(2)} | Slip: $${slippageCost.toFixed(2)} | Bal: $${wallet.balance.toFixed(2)}`);

  return {
    gladiatorId, symbol, side,
    entryPrice: effectivePrice,
    quantity,
    usdAmount: tradeAmount,
    fee,
    slippage: slippageCost,
    executed: true,
    balanceAfter: wallet.balance,
  };
}

/**
 * Apply trade outcome (WIN/LOSS) to wallet balance
 * This is called when a phantom trade closes
 */
export function applyTradeOutcome(gladiatorId: string, pnlPercent: number, tradeSize: number): void {
  const wallet = getWallet(gladiatorId);

  // Apply PnL to balance (after fees already deducted on entry)
  const pnlAmount = tradeSize * (pnlPercent / 100);
  wallet.balance += pnlAmount;

  // Exit fee
  const exitFee = Math.abs(tradeSize + pnlAmount) * PAPER_CONFIG.FEE_RATE;
  wallet.balance -= exitFee;
  wallet.totalFeesPaid += exitFee;

  // Update peak and drawdown
  if (wallet.balance > wallet.peakBalance) {
    wallet.peakBalance = wallet.balance;
  }

  const currentDD = wallet.peakBalance > 0
    ? ((wallet.peakBalance - wallet.balance) / wallet.peakBalance) * 100
    : 0;

  if (currentDD > wallet.maxDrawdownPercent) {
    wallet.maxDrawdownPercent = currentDD;
  }

  wallet.lastUpdated = Date.now();

  log.info(`[PAPER] Outcome for ${gladiatorId}: PnL ${pnlPercent > 0 ? '+' : ''}${pnlPercent.toFixed(2)}% ($${pnlAmount.toFixed(2)}) | Exit fee: $${exitFee.toFixed(2)} | Balance: $${wallet.balance.toFixed(2)} | DD: ${currentDD.toFixed(2)}%`);
}

/**
 * Get all wallet states for dashboard/monitoring
 */
export function getAllWallets(): PaperWalletState[] {
  return Array.from(wallets.values());
}

/**
 * Reset a gladiator's wallet (for testing or restart)
 */
export function resetWallet(gladiatorId: string): void {
  wallets.delete(gladiatorId);
  log.info(`[PAPER] Wallet reset for ${gladiatorId}`);
}

/**
 * Load wallets from persisted state (call at boot)
 */
export function loadWallets(states: PaperWalletState[]): void {
  for (const state of states) {
    wallets.set(state.gladiatorId, state);
  }
  log.info(`[PAPER] Loaded ${states.length} paper wallets`);
}
