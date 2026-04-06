import { 
  DualMasterIdentity, 
  MasterOpinion, 
  DualConsensus, 
  ArenaType 
} from '../../types/gladiator';
import { addSyndicateAudit } from '@/lib/store/db';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface MasterLLM {
  identity: DualMasterIdentity;
  invoke(prompt: string, timeout: number): Promise<MasterOpinion>;
}

class ArchitectMaster implements MasterLLM {
  identity: DualMasterIdentity = 'ARCHITECT';
  private genAI: GoogleGenerativeAI;

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  }

  async invoke(prompt: string, timeout: number): Promise<MasterOpinion> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const model = this.genAI.getGenerativeModel({ model: "gemini-2.0-pro-exp-02-05" });
      const promptWithPersona = `You are the ARCHITECT (Master 1). Your focus is pure logic, probability, risk management, and math. Analyze the following data strictly objectively and numerically.
      
      Data: ${prompt}
      
      Response EXACTLY as:
      DIRECTION: [LONG/SHORT/FLAT]
      CONFIDENCE: [0.0-1.0]
      REASONING: [Brief logical breakdown]`;

      const result = await model.generateContent(promptWithPersona, { signal: controller.signal } as unknown as Parameters<typeof model.generateContent>[1]);
      const text = result.response.text();
      clearTimeout(timer);
      
      if (!text || text.length < 10) throw new Error("Empty response");
      return DualMasterConsciousness.parseResponse(this.identity, text);
    } catch (err) {
      clearTimeout(timer);
      console.warn(`[DualMaster] Architect failed to respond...`, (err as Error).message);
      return { identity: this.identity, direction: 'FLAT', confidence: 0, reasoning: 'Architect API Failure' };
    }
  }
}

class OracleMaster implements MasterLLM {
  identity: DualMasterIdentity = 'ORACLE';
  
  async invoke(prompt: string, timeout: number): Promise<MasterOpinion> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const promptWithPersona = `You are the ORACLE (Master 2). Your focus is intuition, sentiment edge, contrarian plays, and market psychology. Look beyond the math to the chaotic human element.
      
      Data: ${prompt}
      
      Response EXACTLY as:
      DIRECTION: [LONG/SHORT/FLAT]
      CONFIDENCE: [0.0-1.0]
      REASONING: [Brief intuitive/sentiment breakdown]`;

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'anthropic/claude-3.5-sonnet',
          messages: [{ role: 'user', content: promptWithPersona }]
        }),
        signal: controller.signal
      });
      clearTimeout(timer);
      
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error("Invalid Oracle response");
      return DualMasterConsciousness.parseResponse(this.identity, text);
    } catch (err) {
      clearTimeout(timer);
      console.warn(`[DualMaster] Oracle failed to respond...`, (err as Error).message);
      return { identity: this.identity, direction: 'FLAT', confidence: 0, reasoning: 'Oracle API Failure' };
    }
  }
}

export class DualMasterConsciousness {
  private architect: ArchitectMaster;
  private oracle: OracleMaster;
  private timeoutMs = 12000;

  constructor() {
    this.architect = new ArchitectMaster();
    this.oracle = new OracleMaster();
  }

  public static parseResponse(identity: DualMasterIdentity, text: string): MasterOpinion {
    const directionMatch = text.match(/DIRECTION:\s*(LONG|SHORT|FLAT)/i);
    const confidenceMatch = text.match(/CONFIDENCE:\s*([\d.]+)/);
    
    return {
      identity,
      direction: (directionMatch?.[1].toUpperCase() as 'LONG' | 'SHORT' | 'FLAT') || 'FLAT',
      confidence: parseFloat(confidenceMatch?.[1] || '0.5'),
      reasoning: text.slice(0, 500)
    };
  }

  public async getConsensus(marketData: Record<string, unknown>, gladiatorDnaContext: Record<string, unknown>, _arena: ArenaType): Promise<DualConsensus> {
    const prompt = `Market State: ${JSON.stringify(marketData)}. Gladiator DNA/Experience Context: ${JSON.stringify(gladiatorDnaContext)}`;
    
    // Both masters analyze simultaneously
    const [architectOpinion, oracleOpinion] = await Promise.all([
      this.architect.invoke(prompt, this.timeoutMs),
      this.oracle.invoke(prompt, this.timeoutMs)
    ]);
    
    const consensus = this.arbitrate(architectOpinion, oracleOpinion, _arena);
    
    addSyndicateAudit({
      ...consensus,
      symbol: (marketData as Record<string, unknown>).symbol || 'UNKNOWN_ASSET',
      opinions: [architectOpinion, oracleOpinion] // Replace legacy format
    } as unknown as Parameters<typeof addSyndicateAudit>[0]);

    return consensus;
  }

  private arbitrate(architect: MasterOpinion, oracle: MasterOpinion, _arena: ArenaType): DualConsensus {
    let finalDirection: 'LONG' | 'SHORT' | 'FLAT' = 'FLAT';
    let finalConfidence = 0;

    // Both agree
    if (architect.direction === oracle.direction && architect.direction !== 'FLAT') {
      finalDirection = architect.direction;
      finalConfidence = Math.max(architect.confidence, oracle.confidence); // Synergy
    } 
    // Disagreement -> Negotiation Math
    else if (architect.direction !== 'FLAT' && oracle.direction === 'FLAT') {
      // Architect overrides flat Oracle if confidence is very high
      if (architect.confidence >= 0.8) {
         finalDirection = architect.direction;
         finalConfidence = architect.confidence * 0.8; 
      }
    } 
    else if (oracle.direction !== 'FLAT' && architect.direction === 'FLAT') {
      // Oracle overrides flat Architect if instinct is overwhelming
      if (oracle.confidence >= 0.85) {
         finalDirection = oracle.direction;
         finalConfidence = oracle.confidence * 0.7; // Penalized more for lack of logic
      }
    }
    // Hard contradiction (LONG vs SHORT) -> always FLAT for safety
    else if (architect.direction !== 'FLAT' && oracle.direction !== 'FLAT' && architect.direction !== oracle.direction) {
       finalDirection = 'FLAT';
       finalConfidence = 0;
    }

    return {
      finalDirection,
      weightedConfidence: Math.min(finalConfidence, 1),
      opinions: [architect, oracle],
      timestamp: Date.now()
    };
  }
}
