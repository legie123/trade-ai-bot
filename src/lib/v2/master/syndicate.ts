import { 
  MasterSeat, 
  SyndicateOpinion, 
  SyndicateConsensus, 
  ArenaType 
} from '../../types/gladiator';
import { addSyndicateAudit } from '@/lib/store/db';

import { GoogleGenerativeAI } from '@google/generative-ai';

interface LLMAdapter {
  id: MasterSeat;
  invoke(prompt: string, timeout: number): Promise<SyndicateOpinion>;
}

class OpenRouterAdapter implements LLMAdapter {
  constructor(public id: MasterSeat, private model: string) {}
  async invoke(prompt: string, timeout: number): Promise<SyndicateOpinion> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }]
        }),
        signal: controller.signal
      });
      clearTimeout(timer);
      
      const data = await response.json();
      return MasterSyndicate.parseResponse(this.id, data.choices[0].message.content);
    } catch {
      return { seat: this.id, direction: 'FLAT', confidence: 0, reasoning: 'Timeout or API Error' };
    }
  }
}

class GeminiAdapter implements LLMAdapter {
  id: MasterSeat = 'GEMINI_CLAUDE';
  private genAI: GoogleGenerativeAI;
  private fallback: LLMAdapter;

  constructor(fallback: LLMAdapter) {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    this.fallback = fallback;
  }

  async invoke(prompt: string, timeout: number): Promise<SyndicateOpinion> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const model = this.genAI.getGenerativeModel({ model: "gemini-2.0-pro-exp-02-05" });
      const result = await model.generateContent(prompt, { signal: controller.signal } as any);
      const response = await result.response;
      clearTimeout(timer);
      const text = response.text();
      if (!text || text.length < 10) throw new Error("Empty Gemini response");
      return MasterSyndicate.parseResponse(this.id, text);
    } catch (err) {
      clearTimeout(timer);
      console.warn(`[Syndicate] Gemini failed, invoking Claude Fallback...`, err);
      // Fallback to Claude (no timeout reset, uses remaining time conceptually or full timeout)
      return this.fallback.invoke(prompt, timeout);
    }
  }
}

class PerplexityAdapter implements LLMAdapter {
  id: MasterSeat = 'SONAR';
  async invoke(prompt: string, timeout: number): Promise<SyndicateOpinion> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'sonar-pro',
          messages: [{ role: 'user', content: prompt }]
        }),
        signal: controller.signal
      });
      clearTimeout(timer);
      const data = await response.json();
      return MasterSyndicate.parseResponse(this.id, data.choices[0].message.content);
    } catch {
      return { seat: this.id, direction: 'FLAT', confidence: 0, reasoning: 'Perplexity Search Error' };
    }
  }
}

export class MasterSyndicate {
  private adapters: LLMAdapter[];
  private weights: Record<MasterSeat, number> = {
    GEMINI_CLAUDE: 0.30,
    DEEPSEEK_R1: 0.25,
    LLAMA_4: 0.20,
    SONAR: 0.15,
    QWEN_3: 0.10
  };

  constructor() {
    // Claude 3.5 Sonnet is our Elite Fallback for Gemini
    const claudeFallback = new OpenRouterAdapter('GEMINI_CLAUDE', 'anthropic/claude-3.5-sonnet');
    
    this.adapters = [
      new GeminiAdapter(claudeFallback),
      new PerplexityAdapter(),
      new OpenRouterAdapter('DEEPSEEK_R1', 'deepseek/deepseek-r1'),
      new OpenRouterAdapter('LLAMA_4', 'meta-llama/llama-3.1-405b'),
      new OpenRouterAdapter('QWEN_3', 'qwen/qwen-2.5-72b-instruct'),
    ];
  }

  private consensusThreshold = 0.70;
  private timeoutMs = 10000;

  public static parseResponse(seat: MasterSeat, text: string): SyndicateOpinion {
    const directionMatch = text.match(/DIRECTION:\s*(LONG|SHORT|FLAT)/i);
    const confidenceMatch = text.match(/CONFIDENCE:\s*([\d.]+)/);
    
    return {
      seat,
      direction: (directionMatch?.[1].toUpperCase() as 'LONG' | 'SHORT' | 'FLAT') || 'FLAT',
      confidence: parseFloat(confidenceMatch?.[1] || '0.5'),
      reasoning: text.slice(0, 500) // Keep reasoning concise
    };
  }

  public async getConsensus(marketData: Record<string, unknown>, arena: ArenaType): Promise<SyndicateConsensus> {
    const prompt = `Analyze this market data: ${JSON.stringify(marketData)}. 
    Response MUST follow this format exactly:
    DIRECTION: [LONG/SHORT/FLAT]
    CONFIDENCE: [0.0-1.0]
    REASONING: [Brief explanation]`;
    
    const opinionsPromises = this.adapters.map(adapter => adapter.invoke(prompt, this.timeoutMs));
    const results = await Promise.allSettled(opinionsPromises);
    
    const validOpinions: SyndicateOpinion[] = results
      .filter((r): r is PromiseFulfilledResult<SyndicateOpinion> => r.status === 'fulfilled')
      .map(r => r.value);

    const consensus = this.calculateWeightedVote(validOpinions, arena);
    
    // Combat Audit: Persist reasoning to DB with contextual symbol
    addSyndicateAudit({
      ...consensus,
      symbol: (marketData as any).symbol || 'UNKNOWN_ASSET'
    });
    
    return consensus;
  }

  private calculateWeightedVote(opinions: SyndicateOpinion[], arena: ArenaType): SyndicateConsensus {
    let longScore = 0;
    let shortScore = 0;
    let totalWeightUsed = 0;

    opinions.forEach(op => {
      const weight = this.weights[op.seat];
      totalWeightUsed += weight;

      if (op.direction === 'LONG') longScore += op.confidence * weight;
      if (op.direction === 'SHORT') shortScore += op.confidence * weight;
    });

    // Normalize scores based on available votes
    const normalizedLong = totalWeightUsed > 0 ? longScore / totalWeightUsed : 0;
    const normalizedShort = totalWeightUsed > 0 ? shortScore / totalWeightUsed : 0;

    let finalDirection: 'LONG' | 'SHORT' | 'FLAT' = 'FLAT';
    let finalConfidence = 0;

    if (normalizedLong > normalizedShort && normalizedLong >= this.consensusThreshold) {
      finalDirection = 'LONG';
      finalConfidence = normalizedLong;
    } else if (normalizedShort > normalizedLong && normalizedShort >= this.consensusThreshold) {
      finalDirection = 'SHORT';
      finalConfidence = normalizedShort;
    }

    // Apply Deep Web Veto Logic if needed
    if (arena === 'DEEP_WEB') {
      const llamaOpinion = opinions.find(o => o.seat === 'LLAMA_4');
      if (llamaOpinion && (llamaOpinion.direction === 'FLAT' || llamaOpinion.confidence < 0.6)) {
        finalDirection = 'FLAT'; // Vetoed by Security Sentinel
      }
    }

    return {
      finalDirection,
      weightedConfidence: finalConfidence,
      opinions,
      timestamp: Date.now()
    };
  }
}
