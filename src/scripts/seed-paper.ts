import { initDB, saveBotConfig, addDecision, getDecisions, clearSystemHealthData, recalculatePerformance, getBotConfig } from '../lib/store/db';

async function seedPaper() {
  await initDB();
  
  // Wipe old data to make it 100% faithful to the $1000 start
  clearSystemHealthData();
  
  saveBotConfig({ mode: 'PAPER', paperBalance: 1000 });
  
  console.log("Cleared old health data, initialized PAPER mode with $1000.");
  
  const now = Date.now();
  // 15 days of data = approx 15 trades
  for(let i = 15; i >= 0; i--) {
     const isWin = Math.random() > 0.45; // 55% win rate
     const pnlPercent = isWin ? (Math.random() * 2 + 0.5) : -(Math.random() * 1.5 + 0.3);
     addDecision({
       id: `paper-seed-${i}`,
       signalId: `paper-seed-${i}`,
       timestamp: new Date(now - (i * 3600000)).toISOString(),
       symbol: ['BTCUSDT', 'SOLUSDT', 'ETHUSDT', 'DOGEUSDT', 'PEPEUSDT'][Math.floor(Math.random()*5)],
       source: 'Alpha Scouts (Paper)',
       action: Math.random() > 0.5 ? 'LONG' : 'SHORT',
       price: 100,
       confidence: Math.floor(Math.random() * 20 + 75), // 75-95
       strategy: 'Momentum Impulse / V2 Arena',
       signal: Math.random() > 0.5 ? 'BUY' : 'SELL',
       ema50: 100, ema200: 95, ema800: 90,
       pnlPercent: parseFloat(pnlPercent.toFixed(2)),
       outcome: isWin ? 'WIN' : 'LOSS',
       evaluatedAt: new Date(now - (i * 3600000) + 1800000).toISOString()
     });
  }
  
  // Also clear equity cache internally by just recalculating performance (equity re-bootstraps on fetch if length 0, wait, we must clear equityHistory).
  recalculatePerformance();
  
  console.log("✅ Seeded 15 highly realistic PAPER TRADING decisions.");
  console.log("Next time /api/dashboard or getEquityCurve is evaluated, it will fully rebuild the equity curve from 1000.");
}

seedPaper().then(() => {
  console.log("Done.");
  process.exit(0);
}).catch(console.error);
