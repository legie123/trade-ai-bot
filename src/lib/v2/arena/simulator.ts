import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { DNAExtractor } from '../superai/dnaExtractor';
import { createLogger } from '@/lib/core/logger';
import { RoutedSignal } from '@/lib/router/signalRouter';
import { addPhantomTrade, getPhantomTrades, removePhantomTrade, PhantomTrade } from '@/lib/store/db';

const log = createLogger('ArenaSimulator');

export class ArenaSimulator {
  private static instance: ArenaSimulator;
  private dnaBank: DNAExtractor;

  private constructor() {
    this.dnaBank = DNAExtractor.getInstance();
  }

  public static getInstance(): ArenaSimulator {
    if (!ArenaSimulator.instance) {
      ArenaSimulator.instance = new ArenaSimulator();
    }
    return ArenaSimulator.instance;
  }

  /**
   * Triggers a wave of simulation battles across all registered gladiators.
   * In a real deployment, this might pull historical candles and run backtests.
   * Here we simulate battles taking place across live market ticks.
   */
  public async unleashBattles(numberOfBattles = 50): Promise<void> {
    log.info(`[Arena] Unleashing ${numberOfBattles} chaotic battles across the Colosseum...`);
    const allGladiators = gladiatorStore.getLeaderboard(); // all active gladiators
    
    if (allGladiators.length === 0) {
      log.warn('[Arena] No gladiators available for battle.');
      return;
    }

    // Simulate battles
    for (let i = 0; i < numberOfBattles; i++) {
       // Pick a random gladiator and a random symbol to fight on
       const gladiator = allGladiators[Math.floor(Math.random() * allGladiators.length)];
       const mockupSymbols = ['BTCUSDT', 'SOLUSDT', 'ETHUSDT', 'XRPUSDT', 'MEMEUSDT'];
       const symbol = mockupSymbols[Math.floor(Math.random() * mockupSymbols.length)];
       
       // Simulate chaotic outcome
       const entryPrice = Math.random() * 50000 + 1000;
       // 50-50 win chance, heavily influenced by their original specs later
       const isWin = Math.random() > 0.45; // slight edge to simulating 55% win rate for testing
       
       const volatility = Math.random() * 5; 
       const pnlPercent = isWin ? volatility : -volatility;
       const outcomePrice = entryPrice * (1 + (pnlPercent / 100));
       
       const decision = Math.random() > 0.5 ? 'LONG' : 'SHORT';

       await this.dnaBank.logBattle({
         id: `btl_${Date.now()}_${Math.floor(Math.random()*1000)}`,
         gladiatorId: gladiator.id,
         symbol,
         decision,
         entryPrice,
         outcomePrice,
         pnlPercent,
         isWin,
         timestamp: Date.now(),
         marketContext: { volatility, dummySentiment: 'NEUTRAL' }
       });
       
       // Update pseudo-stats on the gladiator (in-memory)
       gladiatorStore.updateGladiatorStats(gladiator.id, {
          pnlPercent,
          isWin
       });
    }

    log.info(`[Arena] The dust settles. The Super AI has consumed ${numberOfBattles} new experiences.`);
  }

  /**
   * Called when a live signal hits the system. Distributes it to all gladiators
   * to enter Phantom Trades for real-time testing.
   */
  public distributeSignalToGladiators(routedSignal: RoutedSignal) {
    const allGladiators = gladiatorStore.getLeaderboard();
    if (!allGladiators.length) return;

    // Determine pseudo-market price since we don't always have a strict numerical feed
    // Ideally signal contains 'price' or we fetch it.
    const currentPrice = routedSignal.price || parseFloat((routedSignal as unknown as { metadata?: { price?: string } })?.metadata?.price || '') || (Math.random() * 50000 + 1000);

    allGladiators.forEach(g => {
      // For massive combat, all gladiators take the trade to measure their metrics
      const trade: PhantomTrade = {
        id: `phantom_${Date.now()}_${g.id.substring(0, 5)}`,
        gladiatorId: g.id,
        symbol: routedSignal.symbol,
        signal: routedSignal.normalized,
        entryPrice: currentPrice,
        timestamp: new Date().toISOString()
      };
      
      addPhantomTrade(trade);
    });
    
    log.info(`[Combat Engine] Deployed Phantom Trades for ${allGladiators.length} Gladiators on ${routedSignal.symbol}`);
  }

  /**
   * Invoked continually by the cron/heartbeat to evaluate open shadow positions.
   * Extracts winning DNA and updates Gladiator stats dynamically.
   */
  public async evaluatePhantomTrades(): Promise<void> {
    const activePhantoms = getPhantomTrades();
    if (!activePhantoms.length) return;

    let totalClosed = 0;

    for (const trade of activePhantoms) {
      // Allow trade to breathe (simulate hold duration)
      const elapsedSec = (Date.now() - new Date(trade.timestamp).getTime()) / 1000;
      if (elapsedSec < 15) continue; 

      // Resolve combat with slight noise/volatility
      const isWin = Math.random() > 0.48;
      const volatility = (Math.random() * 2) + 0.5;
      const pnlPercent = isWin ? volatility : -volatility;
      const outcomePrice = trade.entryPrice * (1 + (pnlPercent / 100));

      // 1. Clean up phantom position
      removePhantomTrade(trade.id);
      
      // 2. DNA Extraction (The Forge) if victorious
      if (isWin) {
         await this.dnaBank.logBattle({
           id: trade.id,
           gladiatorId: trade.gladiatorId,
           symbol: trade.symbol,
           decision: (trade.signal === 'BUY' ? 'LONG' : trade.signal === 'SELL' ? 'SHORT' : 'FLAT'),
           entryPrice: trade.entryPrice,
           outcomePrice,
           pnlPercent,
           isWin: true,
           timestamp: Date.now(),
           marketContext: {
             source: 'Phantom Engine Live Entry',
             volatility,
             holdTimeMs: elapsedSec * 1000
           }
         });
      }

      // 3. Update Gladiator's lifetime record
      gladiatorStore.updateGladiatorStats(trade.gladiatorId, {
         pnlPercent,
         isWin
      });

      totalClosed++;
    }

    if (totalClosed > 0) {
      log.info(`[Combat Engine] Closed ${totalClosed} shadow battles. Winning vectors sent to The Forge.`);
    }
  }
}
