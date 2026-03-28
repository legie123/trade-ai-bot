import { TradingStrategy } from '@/lib/types/strategy';
import { createLogger } from '@/lib/core/logger';
import { runCloudBacktest } from '@/lib/engine/cloudBacktester';
import { saveStrategy, getStrategies, saveBotConfig } from '@/lib/store/db';

const log = createLogger('DiscoveryLLM');

// Requires OPENAI_API_KEY in .env
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const TAVILY_KEY = process.env.TAVILY_API_KEY || '';

async function fetchLatestQuantResearch(): Promise<string> {
   if (!TAVILY_KEY) return '';
   log.info('Executing deep web search via Tavily for the latest quant strategies...');
   try {
       const res = await fetch('https://api.tavily.com/search', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({
               api_key: TAVILY_KEY,
               query: "highly profitable algorithmic day trading crypto strategy PineScript rules",
               search_depth: "advanced",
               max_results: 3,
               include_answer: true
           })
       });
       if (res.ok) {
           const data = await res.json();
           return data.answer || JSON.stringify(data.results.map((r: { content: string }) => r.content));
       }
   } catch (e) {
       log.warn('Tavily search failed', { error: String(e) });
   }
   return '';
}

const SYSTEM_PROMPT = `
You are an Autonomous Trading AI Expert and Strategy Extractor.
CRITICAL RULE: NEVER INVENT RANDOM STRATEGIES. 
Your ONLY objective is to recall and extract REAL, famous, publicly documented trading strategies from the internet (e.g., from TradingView, Quantopian, famous quantitative books, top YouTube quant channels).
Extract the strategy's exact logic, indicators, entry/exit conditions, and timeframe.
Name the strategy precisely as it is known online (e.g., "LazyBear Squeeze Momentum", "MACD + RSI Trend Pullback").
CRITICAL RISK RULE (ATR DYNAMICS):
You MUST use dynamic ATR (Average True Range) multipliers for Stop-Loss and Take-Profit instead of static rigid percentages. 
Set "useAtrMultipliers": true, and provide "atrStopLossMultiplier" (e.g., 1.5 to 2.5) and "atrTakeProfitMultiplier" (e.g. 3.0 to 5.0) which accurately reflect the strategy's real-world logic. Keep "stopLossPercent" / "takeProfitPercent" as deep disaster-fallbacks (e.g., 5.0 and 10.0).

You must output ONLY raw JSON that perfectly matches the TradingStrategy schema. No markdown, no explanations.

SCHEMA:
export type IndicatorName = 'RSI' | 'MACD' | 'VWAP' | 'BB' | 'EMA' | 'VOLUME' | 'PRICE' | 'FUNDING_RATE' | 'OB';
export type ComparisonOperator = '>' | '<' | '>=' | '<=' | '==' | 'CROSS_UP' | 'CROSS_DOWN' | 'WITHIN_PERCENT';

export interface StrategyCondition {
  indicator: IndicatorName;
  params: Record<string, number | string>;
  operator: ComparisonOperator;
  value: number | string;
  timeframe: '5m' | '15m' | '1h' | '4h' | '1d';
}

export interface RiskProfile {
  stopLossPercent: number; 
  takeProfitPercent: number;
  trailingStopEnabled: boolean;
  trailingStopOffsetPercent?: number;
}

export interface TradingStrategy {
  id: string; // must start with "ai_gen_"
  name: string; // a cool, descriptive name
  description: string;
  targetAssets: string[]; // e.g., ["BTC", "SOL", "ETH"]
  status: 'probation'; 
  entryConditions: StrategyCondition[];
  minConditionsRequired: number;
  exitConditions: StrategyCondition[];
  risk: RiskProfile;
  createdBy: 'AI_DISCOVERY';
  createdAt: string; // use ISO string
  lastUpdated: string;
}

EXAMPLE JSON OUTPUT:
{
  "id": "ai_gen_sol_ema_reversion",
  "name": "AI Gen: SOL Deep EMA Reversion",
  "description": "Buys when price is stretched far below 4H EMA 200 and 15m RSI is deeply oversold.",
  "targetAssets": ["SOL"],
  "status": "probation",
  "entryConditions": [
    { "indicator": "PRICE", "params": { "percent": 5 }, "operator": "WITHIN_PERCENT", "value": "EMA", "timeframe": "4h" },
    { "indicator": "RSI", "params": { "length": 14 }, "operator": "<", "value": 25, "timeframe": "15m" }
  ],
  "minConditionsRequired": 2,
  "exitConditions": [
    { "indicator": "RSI", "params": { "length": 14 }, "operator": ">", "value": 60, "timeframe": "15m" }
  ],
  "risk": { 
     "stopLossPercent": 5.0, 
     "takeProfitPercent": 10.0,
     "useAtrMultipliers": true,
     "atrStopLossMultiplier": 1.5,
     "atrTakeProfitMultiplier": 3.0,
     "trailingStopEnabled": true, 
     "trailingStopOffsetPercent": 1.5 
  },
  "createdBy": "AI_DISCOVERY",
  "createdAt": "2024-03-22T00:00:00.000Z",
  "lastUpdated": "2024-03-22T00:00:00.000Z"
}

INSTRUCTIONS:
1. Scan your knowledge base for a highly effective, PUBLICLY documented crypto trading strategy.
2. Convert its exact rules into our StrategyCondition format.
3. If a strategy's logic requires indicators we don't support, DO NOT USE IT. Only use the listed IndicatorNames.
4. Output ONLY valid JSON.
`;

export async function generateAndDeployNewStrategy(): Promise<{ success: boolean; message: string; strategy?: TradingStrategy }> {
  if (!OPENAI_KEY) {
    log.error('Missing OPENAI_API_KEY. Cannot invent strategies.');
    return { success: false, message: 'Missing OPENAI_API_KEY' };
  }

  log.info('Requesting new strategy invention from LLM...');

  const recentResearch = await fetchLatestQuantResearch();
  const finalSystemPrompt = recentResearch 
    ? `${SYSTEM_PROMPT}\n\n=== LIVE INTERNET RESEARCH ===\nThe following is real-time extracted data from the web. Base your strategy precisely on these modern mechanics if applicable:\n${recentResearch}`
    : SYSTEM_PROMPT;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
         'Content-Type': 'application/json',
         'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
         model: 'gpt-4o',
         messages: [
           { role: 'system', content: finalSystemPrompt },
           { role: 'user', content: 'Extract a highly profitable, publicly documented, real-world trading strategy from the internet that uses our supported indicators. Output JSON ONLY.' }
         ],
         temperature: 0.7,
      })
    });

    if (!res.ok) {
       const errBody = await res.text();
       if (res.status === 429 || errBody.toLowerCase().includes('insufficient_quota') || errBody.toLowerCase().includes('billing')) {
         saveBotConfig({ aiStatus: 'NO_CREDIT' });
       }
       throw new Error(`OpenAI error ${res.status}: ${errBody}`);
    }

    // Ping OK, reset status
    saveBotConfig({ aiStatus: 'OK' });

    const data = await res.json();
    let content = data.choices[0].message.content.trim();

    // Strip markdown formatting if the LLM wrapped it in ```json ... ```
    if (content.startsWith('```json')) {
      content = content.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (content.startsWith('```')) {
      content = content.replace(/^```/, '').replace(/```$/, '').trim();
    }

    const strategy: TradingStrategy = JSON.parse(content);
    
    // Safety overrides
    strategy.id = `ai_gen_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    strategy.status = 'probation';
    strategy.createdBy = 'AI_DISCOVERY';
    strategy.createdAt = new Date().toISOString();
    strategy.lastUpdated = new Date().toISOString();

    log.info(`LLM successfully generated: ${strategy.name}`);

    // --- IMMEDIATE BACKTEST PHASE ---
    log.info(`Running mandatory 180-day deep Multi-Asset backtest on ${strategy.name}...`);
    const primaryAsset = strategy.targetAssets.length > 0 && strategy.targetAssets[0] !== 'ALL' ? strategy.targetAssets[0] : 'BTC';
    const secondaryAsset = primaryAsset === 'BTC' ? 'SOL' : 'BTC';
    
    // We run 180 days (6 months) cross-validated on two un-correlated assets
    const report1 = await runCloudBacktest(strategy, primaryAsset, 180);
    const report2 = await runCloudBacktest(strategy, secondaryAsset, 180);

    const totalTrades = report1.totalTrades + report2.totalTrades;
    const totalWins = report1.wins + report2.wins;
    const compositeWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;

    strategy.backtestScore = compositeWinRate;

    // Strict Promotion Filter - Fails backtest? Reject it
    if (totalTrades < 10) {
       log.warn(`AI Strategy rejected: Too few combined trades (${totalTrades}) in 180 days across BTC+SOL.`);
       return { success: false, message: 'Failed backtest: Too few trades generated.' };
    }

    if (compositeWinRate < 60) {
       log.warn(`AI Strategy rejected: Multi-asset win rate too low (${compositeWinRate}%). Proves curve-fitting.`);
       return { success: false, message: `Failed backtest: Low composite win rate (${compositeWinRate}%)` };
    }

    // Anti-Cannibalization / Deduplication Check
    const activeStrategies = getStrategies();
    const isDuplicate = activeStrategies.some(active => 
       JSON.stringify(active.entryConditions) === JSON.stringify(strategy.entryConditions) &&
       active.targetAssets.join(',') === strategy.targetAssets.join(',')
    );

    if (isDuplicate) {
       log.warn(`AI Strategy rejected: Duplicate entry logic detected for same asset.`);
       return { success: false, message: 'Failed duplicate check: Strategy logic already exists in the system.' };
    }

    // Passes backtest and deduplication -> Deploy to Database!
    log.info(`AI Strategy PASSED backtest with ${compositeWinRate.toFixed(1)}% WR over ${totalTrades} trades! Saving to database.`);
    saveStrategy(strategy);

    return { 
      success: true, 
      message: `Strategy ${strategy.name} generated and deployed to Probation! WR: ${compositeWinRate.toFixed(1)}%, Trades: ${totalTrades}`,
      strategy
    };

  } catch (err) {
    log.error('LLM Discovery failed', { error: String(err) });
    return { success: false, message: String(err) };
  }
}
