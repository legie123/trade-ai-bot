import { createLogger } from '@/lib/core/logger';
import { PromoterData } from '@/lib/types/gladiator';
import { WsStreamManager } from '@/lib/providers/wsStreams';

const log = createLogger('AlphaScout');

export interface ZScoreData {
  volumeZScore: number;
  oib: number;
}

export class AlphaScout {
  private static instance: AlphaScout;
  private wsManager: WsStreamManager;
  
  // Rolling data storage
  private klineData: Map<string, { close: number, volume: number }[]> = new Map();
  private depthData: Map<string, { bids: number, asks: number }> = new Map();
  // RECALIBRATED 2026-04-18 FAZA 4: 60→30 periods (30min on 1m candles).
  // 60 periods was too sluggish — volume spikes decayed before Z-Score reacted.
  // 30 catches crypto pump patterns within 5-10 candles of onset.
  private readonly WINDOW_SIZE = 30;
  
  // Hardcoded tracking list for High Volatility Pairs
  private readonly TRACKED_SYMBOLS = [
    'btcusdt', 'ethusdt', 'solusdt', 'xrpusdt', 'dogeusdt',
    'avaxusdt', 'wifusdt', 'bonkusdt', 'jupusdt', 'pepeusdt'
  ];

  private constructor() {
    this.wsManager = WsStreamManager.getInstance();
    this.initStreams();
  }

  public static getInstance(): AlphaScout {
    if (!AlphaScout.instance) {
      AlphaScout.instance = new AlphaScout();
    }
    return AlphaScout.instance;
  }

  private initStreams() {
    const streams: string[] = [];
    for (const sym of this.TRACKED_SYMBOLS) {
      streams.push(`${sym}@kline_1m`); // Volume & Price
      streams.push(`${sym}@depth10@100ms`); // Top 10 Order Book Depth
      this.klineData.set(sym, []);
    }
    
    this.wsManager.subscribe(streams);

    // Listen to all messages
    this.wsManager.on('message', (payload: { stream: string; data: unknown }) => {
      const streamName: string = payload.stream;
      if (streamName.includes('@kline_1m')) {
        this.processKline(payload.data as { s: string; k?: { x: boolean; c: string; v: string } });
      } else if (streamName.includes('@depth')) {
        this.processDepth(payload.data as { s: string; b?: string[][]; a?: string[][] });
      }
    });
  }

  private processKline(data: { s: string; k?: { x: boolean; c: string; v: string } }) {
    const sym = data.s.toLowerCase();
    const k = data.k;
    if (!k) return;

    if (k.x) { // kline closed
      const arr = this.klineData.get(sym) || [];
      arr.push({ close: parseFloat(k.c), volume: parseFloat(k.v) });
      if (arr.length > this.WINDOW_SIZE) arr.shift(); // Keep moving window
      this.klineData.set(sym, arr);
    }
  }

  private processDepth(data: { s: string; b?: string[][]; a?: string[][] }) {
    const sym = data.s.toLowerCase();
    const bids = data.b || [];
    const asks = data.a || [];

    let totalBids = 0;
    let totalAsks = 0;

    for (let i = 0; i < bids.length; i++) totalBids += parseFloat(bids[i][1]);
    for (let i = 0; i < asks.length; i++) totalAsks += parseFloat(asks[i][1]);

    this.depthData.set(sym, { bids: totalBids, asks: totalAsks });
  }

  /**
   * Calculates current Volume Z-Score based on rolling window.
   */
  private getVolumeZScore(sym: string): number {
    const arr = this.klineData.get(sym);
    if (!arr || arr.length < 10) return 0; // Not enough data yet
    
    const volumes = arr.map(k => k.volume);
    const lastVolume = volumes[volumes.length - 1];
    
    // Mean
    const mean = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    
    // Standard Deviation
    const sqDiffs = volumes.map(v => Math.pow(v - mean, 2));
    const variance = sqDiffs.reduce((a, b) => a + b, 0) / sqDiffs.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;
    return (lastVolume - mean) / stdDev;
  }

  /**
   * Order Book Imbalance (Bid/Ask pressure)
   * > 0.6 = Heavy Buy Pressure
   * < 0.4 = Heavy Sell Pressure
   */
  private getOrderBookImbalance(sym: string): number {
    const depth = this.depthData.get(sym);
    if (!depth) return 0.5;
    const total = depth.bids + depth.asks;
    if (total === 0) return 0.5;
    return depth.bids / total;
  }

  /**
   * Computes VWAP shift directly.
   */
  private getVwapShift(sym: string): number {
    const arr = this.klineData.get(sym);
    if (!arr || arr.length < 2) return 0;
    
    let sumPV = 0;
    let sumV = 0;
    for (const k of arr) {
      sumPV += k.close * k.volume;
      sumV += k.volume;
    }
    const vwap = sumPV / sumV;
    const lastPrice = arr[arr.length - 1].close;
    
    return ((lastPrice - vwap) / vwap) * 100;
  }

  /**
   * Fetches computed quant signals for all tracked assets.
   * This REPLACES the lagging CoinGecko polling logic.
   */
  public async getMarketSignals(): Promise<PromoterData[]> {
    log.info('🛰️ [AlphaScout] Aggregating Live Quant Matrix...');
    const signals: PromoterData[] = [];

    for (const sym of this.TRACKED_SYMBOLS) {
      const zScore = this.getVolumeZScore(sym);
      const oib = this.getOrderBookImbalance(sym);
      const shift = this.getVwapShift(sym);
      const uppercaseSym = sym.toUpperCase();

      let sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
      let confidence = 0.5;

      // RECALIBRATED 2026-04-18 FAZA 4: Z-Score 2.5→2.0 (was too rare on 1m candles,
      // produced near-zero signals). 2.0 sigma captures top ~2.3% volume events.
      // OIB thresholds tightened 0.65→0.60 / 0.35→0.40 to compensate for lower Z bar.
      // Confidence scaled by Z-Score instead of flat 0.85 — stronger anomalies → higher confidence.
      if (zScore > 2.0 && oib > 0.60) {
        if (shift < 3.0) {
          sentiment = 'BULLISH';
          confidence = Math.min(0.95, 0.70 + (zScore - 2.0) * 0.10);
        } else {
          log.warn(`🎯 [AlphaScout] FOMO BLOCKED: ${uppercaseSym} | Shift: ${shift.toFixed(2)}% | Z:${zScore.toFixed(2)}`);
        }
      } else if (zScore > 2.0 && oib < 0.40) {
        sentiment = 'BEARISH';
        confidence = Math.min(0.95, 0.70 + (zScore - 2.0) * 0.10);
      }

      if (sentiment !== 'NEUTRAL') {
        signals.push({
          source: 'LIVE_QUANT_WS',
          symbol: uppercaseSym,
          sentiment,
          confidenceRate: confidence,
          rawPayload: {
            zScore: parseFloat(zScore.toFixed(3)),
            oib: parseFloat(oib.toFixed(3)),
            vwapShift: parseFloat(shift.toFixed(3)),
          },
          timestamp: Date.now(),
        });
        log.info(`🎯 [AlphaScout] Quant Trigger: ${uppercaseSym} | Z:${zScore.toFixed(2)} | OIB:${oib.toFixed(2)} -> ${sentiment}`);
      }
    }

    // Connect to WS if not connected during first signals request
    if (this.klineData.get(this.TRACKED_SYMBOLS[0])?.length === 0) {
        this.wsManager.connect();
    }

    return signals;
  }

  /**
   * Replaces legacy CC/Gecko dive. Yields immediate memory quant output.
   */
  public async analyzeToken(symbol: string): Promise<string> {
    const cleanSymbol = symbol.toLowerCase().replace('usd', 'usdt');
    if (!this.TRACKED_SYMBOLS.includes(cleanSymbol)) {
      return `Quant Data Unavailable. Token ${symbol} is outside real-time VWAP matrix.`;
    }

    const zScore = this.getVolumeZScore(cleanSymbol).toFixed(3);
    const oib = this.getOrderBookImbalance(cleanSymbol).toFixed(3);
    const vwapShift = this.getVwapShift(cleanSymbol).toFixed(3);

    return `[QUANT MATRIX LIVE] Z-Score: ${zScore} | OIB: ${oib} | VWAP Shift: ${vwapShift}%`;
  }
}

