import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { DNAExtractor } from '../superai/dnaExtractor';
import { createLogger } from '@/lib/core/logger';

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
}
