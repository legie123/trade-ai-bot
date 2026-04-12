import { config } from 'dotenv';
config({ path: '.env.local' });

import { testMexcConnection } from '../lib/exchange/mexcClient';
import { DualMasterConsciousness } from '../lib/v2/master/dualMaster';

async function runHardDiagnostic() {
  console.log("\n" + "=".repeat(60));
  console.log("🚀 TRADE AI PHOENIX V2 — HARD DIAGNOSTIC SUITE 🚀");
  console.log("=".repeat(60) + "\n");

  const results: Record<string, boolean> = {
    env: false,
    mexc: false,
    llm: false,
    arena: false,
    memory: false
  };

  // 1. Environment Check
  console.log("Checking Environment Secrets...");
  const required = ['MEXC_API_KEY', 'MEXC_API_SECRET', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY', 'NEXT_PUBLIC_SUPABASE_URL'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.log(`❌ Missing Secrets: ${missing.join(', ')}`);
  } else {
    console.log("✅ All core secrets present.");
    results.env = true;
  }

  // 2. Exchange Latency
  console.log("\nMeasuring MEXC Connectivity...");
  const startMexc = Date.now();
  const mexc = await testMexcConnection();
  const latMexc = Date.now() - startMexc;
  if (mexc.ok) {
    console.log(`✅ MEXC Connected (${mexc.mode}) | Latency: ${latMexc}ms`);
    results.mexc = true;
  } else {
    console.log(`❌ MEXC Failed: ${mexc.error}`);
  }

  // 3. LLM Engine Benchmarks (Parallel)
  console.log("\nBenchmarking DualMaster AI Engines...");
  const consciousness = new DualMasterConsciousness();
  const testMarketData = {
    symbol: 'BTCUSDT',
    price: 65000,
    change24h: 2.5,
    volume24h: 1200000000,
    ema50: 64000,
    ema200: 60000,
    rsi: 62,
    direction: 'BULLISH'
  };
  const testDna = {
    symbol: 'BTCUSDT',
    confidenceModifier: 1.1,
    digest: 'Gladiator has 75% win rate on BTC in the last 24h.'
  };

  const startLLM = Date.now();
  try {
    const consensus = await consciousness.getConsensus(testMarketData, testDna);
    const latLLM = Date.now() - startLLM;
    console.log(`✅ AI Consensus Obtained in ${latLLM}ms`);
    console.log(`    Verdict: ${consensus.finalDirection} (${(consensus.weightedConfidence * 100).toFixed(1)}% Confidence)`);
    results.llm = true;
  } catch (err) {
    console.log(`❌ LLM Engine Failed: ${(err as Error).message}`);
  }

  // 4. Memory Profiling
  const used = process.memoryUsage();
  console.log("\nMemory Profile:");
  console.log(`   RSS: ${(used.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   Heap Total: ${(used.heapTotal / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   Heap Used: ${(used.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  results.memory = true;

  console.log("\n" + "=".repeat(60));
  const successCount = Object.values(results).filter(v => v === true).length;
  console.log(`DIAGNOSTIC COMPLETE: ${successCount}/${Object.keys(results).length} SYSTEMS OPERATIONAL`);
  console.log("=".repeat(60) + "\n");

  if (successCount === Object.keys(results).length) {
    console.log("🟢 SYSTEM IS BATTLE-READY.");
  } else {
    console.log("🔴 CRITICAL VULNERABILITIES DETECTED.");
  }
}

runHardDiagnostic().catch(err => {
  console.error("DIAGNOSTIC CRASHED:", err);
  process.exit(1);
});
