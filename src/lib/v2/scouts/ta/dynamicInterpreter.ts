import { TradingStrategy, StrategyCondition } from '@/lib/types/strategy';
import { calcRSI } from '@/lib/v2/scouts/ta/rsiIndicator';
import { calcBollingerBands } from '@/lib/v2/scouts/ta/bollingerBands';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('DynamicInterpreter');

export interface MarketContext {
  symbol: string;
  price: number;
  closes15m: number[];
  closes1h: number[];
  closes4h: number[];
  vwap?: number;
  fundingRate?: number;
  volumeMA?: number;
}

function evaluateCondition(cond: StrategyCondition, context: MarketContext): boolean {
  try {
    const closes = cond.timeframe === '1h' ? context.closes1h : 
                   cond.timeframe === '4h' ? context.closes4h : context.closes15m;
    
    let indicatorValue = 0;

    switch (cond.indicator) {
      case 'PRICE': {
        indicatorValue = context.price;
        break;
      }
      case 'RSI': {
        indicatorValue = calcRSI(closes, (cond.params.length as number) || 14);
        break;
      }
      case 'BB': {
        const bb = calcBollingerBands(closes, (cond.params.length as number) || 20, (cond.params.mult as number) || 2);
        if (cond.value === 'UPPER_BAND') return bb.signal === 'BB_SELL';
        if (cond.value === 'LOWER_BAND') return bb.signal === 'BB_BUY';
        indicatorValue = bb.percentB; 
        break;
      }
      case 'EMA': {
        const emaCalc = (vals: number[], p: number) => {
          if (vals.length < p) return vals[vals.length - 1] || 0;
          let e = vals.slice(0, p).reduce((a, b) => a + b, 0) / p;
          const k = 2 / (p + 1);
          for (let i = p; i < vals.length; i++) e = vals[i] * k + e * (1 - k);
          return e;
        };
        const period = (cond.params.fast as number) || 50;
        indicatorValue = emaCalc(closes, period);
        break;
      }
      case 'VWAP': {
        indicatorValue = context.vwap || context.price;
        break;
      }
      case 'VOLUME': {
        indicatorValue = context.volumeMA || 1; // 1 = average, 2 = 2x average
        break;
      }
      case 'FUNDING_RATE': {
        indicatorValue = context.fundingRate || 0;
        break;
      }
      default:
        return false;
    }

    let targetValue = 0;
    if (typeof cond.value === 'number') {
      targetValue = cond.value;
    } else if (cond.value === 'PRICE') {
      targetValue = context.price;
    }

    switch (cond.operator) {
      case '>': return indicatorValue > targetValue;
      case '<': return indicatorValue < targetValue;
      case '>=': return indicatorValue >= targetValue;
      case '<=': return indicatorValue <= targetValue;
      case '==': return indicatorValue === targetValue;
      case 'WITHIN_PERCENT': {
        const pctDiff = Math.abs((indicatorValue - targetValue) / targetValue) * 100;
        return pctDiff <= ((cond.params.percent as number) || 1.0);
      }
      default:
        return false;
    }
  } catch (err) {
    log.error(`Failed to evaluate condition ${cond.indicator}`, { error: String(err) });
    return false;
  }
}

export function evaluateStrategy(strategy: TradingStrategy, context: MarketContext): boolean {
  if (strategy.entryConditions.length === 0) return false;
  
  let passed = 0;
  for (const cond of strategy.entryConditions) {
    if (evaluateCondition(cond, context)) {
      passed++;
    }
  }

  return passed >= strategy.minConditionsRequired;
}
