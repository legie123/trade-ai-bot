import { createClient } from '@supabase/supabase-js';
import { initDB, saveBotConfig, addDecision, clearSystemHealthData, recalculatePerformance } from '../lib/store/db';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function seedPaper() {
  await initDB();
  
  console.log("Clearing old data from DB...");
  clearSystemHealthData();
  
  const { error } = await supabase.from('equity_history').delete().neq('timestamp', '0');
  if (error) console.log("Warning: Could not clear equity_history: ", error.message);
  else console.log("Cleared equity_history successfully.");

  const { error: liveErr } = await supabase.from('live_positions').delete().neq('id', '0');
  if (liveErr) console.log("Warning: Could not clear live_positions: ", liveErr.message);
  else console.log("Cleared live_positions successfully.");
  
  saveBotConfig({ mode: 'PAPER', paperBalance: 1000, riskPerTrade: 1.5 });
  
  console.log("Initialized PAPER mode with $1000.");
  
  const now = Date.now();
  for(let i = 15; i >= 0; i--) {
     const isWin = Math.random() > 0.40;
     const pnlPercent = isWin ? (Math.random() * 2.5 + 0.5) : -(Math.random() * 1.5 + 0.3);
     addDecision({
       id: `paper-seed-${i}`,
       signalId: `paper-seed-${i}`,
       timestamp: new Date(now - ((i + 1) * 3600000)).toISOString(),
       symbol: ['BTCUSDT', 'SOLUSDT', 'ETHUSDT', 'DOGEUSDT'][Math.floor(Math.random()*4)],
       source: 'Alpha Scouts (Paper)',
       action: Math.random() > 0.5 ? 'LONG' : 'SHORT',
       price: 100 + i,
       confidence: Math.floor(Math.random() * 20 + 75),
       signal: Math.random() > 0.5 ? 'BUY' : 'SELL',
       ema50: 100, ema200: 95, ema800: 90,
       pnlPercent: parseFloat(pnlPercent.toFixed(2)),
       outcome: isWin ? 'WIN' : 'LOSS',
       evaluatedAt: new Date(now - ((i + 1) * 3600000) + 1800000).toISOString()
     } as any);
  }
  
  recalculatePerformance();
  
  console.log("✅ Seeded 15 highly realistic PAPER TRADING decisions. The UI will now bootstrap the pure $1000 equity curve.");
}

seedPaper().then(() => {
  setTimeout(() => process.exit(0), 1000); // give supabase time
}).catch(console.error);
