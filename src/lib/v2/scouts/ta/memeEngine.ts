// ============================================================
// Multi-Coin Signal Engine — Inteligenta Artificiala pentru Memecoins
// ============================================================
import { Signal } from '@/lib/types/radar';
import { createLogger } from '@/lib/core/logger';
import { fetchWithRetry } from '@/lib/providers/base';
import { routeSignal } from '@/lib/router/signalRouter';
import { trySignal } from '@/lib/v2/scouts/ta/signalCooldown';
import { gladiatorStore } from '@/lib/store/gladiatorStore';

const log = createLogger('MemeEngine');

export interface MemeTokenProfile {
  chainId: string;
  tokenAddress: string;
  icon?: string;
  header?: string;
  description?: string;
  links?: { type: string; url: string }[];
}

export interface MemeAnalysis {
  tokenAddress: string;
  chainId: string;
  score: number;
  momentum: string;
  timestamp: string;
}

export interface MemeResult {
  tokens: MemeAnalysis[];
  signals: Signal[];
  totalPotentials: number;
  timestamp: string;
}

// Global cache
interface CacheEntry<T> { data: T; ts: number; }
const g = globalThis as unknown as {
  __memeCache?: {
    result: CacheEntry<MemeResult>;
  };
};
if (!g.__memeCache) {
  g.__memeCache = {
    result: { data: { tokens: [], signals: [], totalPotentials: 0, timestamp: '' }, ts: 0 },
  };
}
const cache = g.__memeCache;
const CACHE_TTL = 3 * 60_000; // 3 minute Cache

/**
 * Scan DexScreener Token Boosts (Latest)
 */
async function fetchTrendingMemes(): Promise<MemeTokenProfile[]> {
  try {
    const res = await fetchWithRetry(`https://api.dexscreener.com/token-profiles/latest/v1`, {
      retries: 2, timeoutMs: 8000,
    });
    const profiles: MemeTokenProfile[] = await res.json();
    return profiles || [];
  } catch (error) {
    log.error(`[MemeEngine] Structura DexScreener inaccesibila`, { error });
    return [];
  }
}

/**
 * Core Execution Engine pentru Memes
 * Filtreaza oportunitatile si le ruteaza CĂTRE Sindicat doar daca exista Gladiator Live cu parametrii validati
 */
export async function runMemeEngineScan(): Promise<MemeResult> {
  log.info(`[MemeEngine] Initiez scanare OSINT pentru memecoins...`);

  // CIRCUIT BREAKER #1: Verificare existenta Gladiatori capabili pe sistem
  if (!gladiatorStore.hasSkillLive('MEME_SNIPER')) {
    log.warn(`[MemeEngine] Halted. Niciun Gladiator Live nu deține capabilitatea [MEME_SNIPER]. Ignorăm piața meme pentru siguranța capitalului.`);
    return cache.result.data;
  }

  const now = Date.now();
  if (now - cache.result.ts < CACHE_TTL && cache.result.data.tokens.length > 0) {
    return cache.result.data;
  }

  const rawProfiles = await fetchTrendingMemes();
  if (rawProfiles.length === 0) {
    log.info(`[MemeEngine] Niciun token cu momentum detectat.`);
    return cache.result.data;
  }

  // Filtram strict doar retelele ultra-rapide (Solana/Base)
  const validProfiles = rawProfiles.filter(p => p.chainId === 'solana' || p.chainId === 'base');
  
  const tokens: MemeAnalysis[] = [];
  const signalsOut: Signal[] = [];
  let signalSentCount = 0;

  for (const profile of validProfiles.slice(0, 5)) { // Luam doar top 5 hype pentru analiza
    
    // Extragem prețul real pentru a trece de "Zero-Data Ban" din ManagerVizionar
    let currentPrice = 0;
    try {
      const priceRes = await fetchWithRetry(`https://api.dexscreener.com/latest/dex/tokens/${profile.tokenAddress}`, { retries: 1, timeoutMs: 3000 });
      const priceData = await priceRes.json();
      if (priceData && priceData.pairs && priceData.pairs.length > 0) {
        currentPrice = parseFloat(priceData.pairs[0].priceUsd) || 0;
      }
    } catch (e) {
      log.warn(`[MemeEngine] Nu am putut extrage prețul pentru ${profile.tokenAddress}`, { error: String(e) });
    }

    // Trecem mai departe DOAR dacă avem date de preț (fără phantom data)
    if (currentPrice <= 0) continue;

    // AUDIT FIX T1.3: Replace random scoring with deterministic heuristic
    // Score based on actual observable data: price existence + chain quality + profile completeness
    let heuristicScore = 50; // Base: neutral
    if (currentPrice > 0) heuristicScore += 15; // Has real price data
    if (profile.description && profile.description.length > 20) heuristicScore += 5; // Has description
    if (profile.links && profile.links.length >= 2) heuristicScore += 5; // Has multiple links (website, twitter, etc)
    if (profile.icon) heuristicScore += 3; // Has icon (not abandoned)
    if (profile.header) heuristicScore += 2; // Has header image
    // Chain bonus: Solana is faster execution
    if (profile.chainId === 'solana') heuristicScore += 5;
    // Cap at 85 — meme tokens should NEVER auto-pass the 90 threshold without real TA confirmation
    heuristicScore = Math.min(heuristicScore, 85);

    const analysis: MemeAnalysis = {
      tokenAddress: profile.tokenAddress,
      chainId: profile.chainId,
      score: heuristicScore,
      momentum: heuristicScore >= 75 ? 'EXPLOSIVE_HYPE' : heuristicScore >= 60 ? 'MODERATE' : 'WEAK',
      timestamp: new Date().toISOString()
    };
    
    tokens.push(analysis);

    // Daca score e exceptional si sistemul nu e in push guard, alertam router-ul !
    if (analysis.score >= 90) {
      const allowed = trySignal(`MEME_SNIPER_${profile.tokenAddress}`, 'LONG');
      if (allowed) {
        log.info(`[MemeEngine] Potențial masiv detectat pe ${profile.tokenAddress} (${profile.chainId}). Lansez propunerea către Sindicat!`);
        
        const signal: Signal = {
          id: `meme_${Date.now()}_${profile.tokenAddress}`,
          symbol: `${profile.tokenAddress}_${profile.chainId.toUpperCase()}`,
          timeframe: '5m',
          signal: 'LONG', // Memecoins are mostly long hype
          price: currentPrice, // OBLIGATORIU: Nu mai e 0, a fost spartă interdicția
          confidence: analysis.score / 100, // max 0.99
          source: 'Meme OSINT Engine',
          timestamp: new Date().toISOString(),
          message: `Momentum OSINT exploziv detectat în Top DexScreener Profiles. Se cere execuție rapidă via MEME_SNIPER.`
        };

        signalsOut.push(signal);
        signalSentCount++;
        routeSignal(signal); 
      }
    }
  }

  const result: MemeResult = {
    tokens,
    signals: signalsOut,
    totalPotentials: signalSentCount,
    timestamp: new Date().toISOString()
  };

  cache.result = { data: result, ts: now };
  return result;
}
