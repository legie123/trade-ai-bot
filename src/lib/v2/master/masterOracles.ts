import { MasterConsensus, ArenaType } from '../../types/gladiator';
import { getFundingRate } from '../scouts/ta/fundingRate';
import { getOpenInterest } from '../scouts/ta/openInterest';
import { createLogger } from '@/lib/core/logger';
const log = createLogger('MasterOracles');

/**
 * Master Oracles
 * Reads the macro state of the market (Funding, Open Interest) to decide
 * which arenas are currently safe for gladiators to fight in.
 */
export class MasterOracles {
  public async evaluateMacroState(): Promise<MasterConsensus> {
    try {
      // Fetch macro environment indicators — parallel (independent APIs)
      const [funding, oi] = await Promise.all([
        getFundingRate('BTCUSDT'),
        getOpenInterest('BTCUSDT'),
      ]);

      let direction: 'LONG' | 'SHORT' | 'FLAT' = 'FLAT';
      let confidence = 0.5;

      const baseArenas: ArenaType[] = ['SCALPING', 'DAY_TRADING', 'SWING', 'DEEP_WEB'];
      const allowedArenas = [...baseArenas];

      // Extreme Funding indicates squeeze
      if (funding.signal === 'BUY' && funding.strength > 0.8) {
        direction = 'LONG';
        confidence += 0.2;
      } else if (funding.signal === 'SELL' && funding.strength > 0.8) {
        direction = 'SHORT';
        confidence += 0.2;
      }

      // Open Interest Divergence confirms or changes state
      if (oi.divergence === 'BULLISH_DIV') {
        direction = 'LONG';
        confidence += 0.2;
      } else if (oi.divergence === 'BEARISH_DIV') {
        direction = 'SHORT';
        confidence += 0.2;
      }

      // Macro Filter Constraints
      // If macro confidence is very low or volatile, we block SWING/DEEP_WEB
      if (confidence < 0.6) {
        const indexSwing = allowedArenas.indexOf('SWING');
        if (indexSwing > -1) allowedArenas.splice(indexSwing, 1);
        
        const indexDeep = allowedArenas.indexOf('DEEP_WEB');
        if (indexDeep > -1) allowedArenas.splice(indexDeep, 1);
      }

      return {
        agreedDirection: direction,
        macroConfidence: Math.min(confidence, 1.0),
        allowedArenas,
      };
    } catch (err) {
      log.error('Failed to evaluate macro state, returning safe defaults', { error: String(err) });
      return {
        agreedDirection: 'FLAT',
        macroConfidence: 0,
        allowedArenas: ['SCALPING', 'DAY_TRADING'], // Restrict arenas on failure
      };
    }
  }
}
