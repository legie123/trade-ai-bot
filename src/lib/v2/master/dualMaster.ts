import { 
  DualMasterIdentity, 
  MasterOpinion, 
  DualConsensus 
} from '../../types/gladiator';
import { addSyndicateAudit } from '@/lib/store/db';

// ─── Shared LLM call with retry + timeout (DRY) ───
async function callOpenAI(prompt: string, timeout: number, signal?: AbortSignal): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  // Chain external signal if provided
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,       // Cap response size for speed
        temperature: 0.4,      // More deterministic for trading
      }),
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`OpenAI HTTP ${response.status}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text || text.length < 10) throw new Error('Empty LLM response');
    return text;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function parseResponse(identity: DualMasterIdentity, text: string): MasterOpinion {
  const directionMatch = text.match(/DIRECTION:\s*(LONG|SHORT|FLAT)/i);
  const confidenceMatch = text.match(/CONFIDENCE:\s*([\d.]+)/);

  return {
    identity,
    direction: (directionMatch?.[1].toUpperCase() as 'LONG' | 'SHORT' | 'FLAT') || 'FLAT',
    confidence: parseFloat(confidenceMatch?.[1] || '0.5'),
    reasoning: text.slice(0, 500)
  };
}

const PERSONAS: Record<DualMasterIdentity, string> = {
  ARCHITECT: `You are the ARCHITECT (Master 1). Your focus is pure logic, probability, risk management, and math. Analyze the following data strictly objectively and numerically.`,
  ORACLE: `You are the ORACLE (Master 2). Your focus is intuition, sentiment edge, contrarian plays, and market psychology. Look beyond the math to the chaotic human element.`
};

async function invokeMaster(identity: DualMasterIdentity, prompt: string, timeout: number): Promise<MasterOpinion> {
  const fullPrompt = `${PERSONAS[identity]}
      
Data: ${prompt}
      
Response EXACTLY as:
DIRECTION: [LONG/SHORT/FLAT]
CONFIDENCE: [0.0-1.0]
REASONING: [Brief breakdown]`;

  try {
    const text = await callOpenAI(fullPrompt, timeout);
    return parseResponse(identity, text);
  } catch (err) {
    console.warn(`[DualMaster] ${identity} failed:`, (err as Error).message);
    return { identity, direction: 'FLAT', confidence: 0, reasoning: `${identity} API Failure` };
  }
}

export class DualMasterConsciousness {
  private timeoutMs = 12000;

  public async getConsensus(marketData: Record<string, unknown>, gladiatorDnaContext: Record<string, unknown>): Promise<DualConsensus> {
    const prompt = `Market State: ${JSON.stringify(marketData)}. Gladiator DNA/Experience Context: ${JSON.stringify(gladiatorDnaContext)}`;
    
    // Both masters analyze simultaneously (parallel)
    const [architectOpinion, oracleOpinion] = await Promise.all([
      invokeMaster('ARCHITECT', prompt, this.timeoutMs),
      invokeMaster('ORACLE', prompt, this.timeoutMs)
    ]);
    
    const consensus = this.arbitrate(architectOpinion, oracleOpinion);
    
    // Single audit write (removed duplicate from processSignal)
    addSyndicateAudit({
      ...consensus,
      symbol: (marketData as Record<string, unknown>).symbol || 'UNKNOWN_ASSET',
      opinions: [architectOpinion, oracleOpinion]
    } as unknown as Parameters<typeof addSyndicateAudit>[0]);

    return consensus;
  }

  private arbitrate(architect: MasterOpinion, oracle: MasterOpinion): DualConsensus {
    let finalDirection: 'LONG' | 'SHORT' | 'FLAT' = 'FLAT';
    let finalConfidence = 0;

    // Both agree
    if (architect.direction === oracle.direction && architect.direction !== 'FLAT') {
      finalDirection = architect.direction;
      finalConfidence = Math.max(architect.confidence, oracle.confidence);
    } 
    // Architect leads, Oracle flat
    else if (architect.direction !== 'FLAT' && oracle.direction === 'FLAT') {
      if (architect.confidence >= 0.8) {
         finalDirection = architect.direction;
         finalConfidence = architect.confidence * 0.8; 
      }
    } 
    // Oracle leads, Architect flat
    else if (oracle.direction !== 'FLAT' && architect.direction === 'FLAT') {
      if (oracle.confidence >= 0.85) {
         finalDirection = oracle.direction;
         finalConfidence = oracle.confidence * 0.7;
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
