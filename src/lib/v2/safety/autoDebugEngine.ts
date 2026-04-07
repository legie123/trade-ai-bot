import { createLogger } from '@/lib/core/logger';
import { SentinelGuard } from '@/lib/v2/safety/sentinelGuard';
import { supabase } from '@/lib/store/db';

// ... other code doesn't matter here until we reach the bottom where error is:


const log = createLogger('AutoDebugEngine');

export interface SystemError {
  timestamp: string;
  module: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface DiagnosisAction {
  severity: 'INFO' | 'WARNING' | 'CRITICAL' | 'FATAL';
  rootCause: string;
  recommendedAction: 'NONE' | 'NOTIFY_ADMIN' | 'ENTER_SAFE_MODE' | 'HALT_TRADING';
  explanation: string;
}

class AutoDebugEngine {
  private static instance: AutoDebugEngine;
  private errorBuffer: SystemError[] = [];
  private isDiagnosing = false;
  private lastDiagnosisTime = 0;

  private constructor() {}

  public static getInstance(): AutoDebugEngine {
    if (!AutoDebugEngine.instance) {
      AutoDebugEngine.instance = new AutoDebugEngine();
    }
    return AutoDebugEngine.instance;
  }

  /**
   * Called by the logger automatically whenever an ERROR or FATAL log occurs.
   */
  public ingestError(module: string, message: string, context?: Record<string, unknown>): void {
    // Avoid recursive logging loops
    if (module === 'AutoDebugEngine') return;
    
    this.errorBuffer.push({
      timestamp: new Date().toISOString(),
      module,
      message,
      context
    });

    if (this.errorBuffer.length > 50) {
      this.errorBuffer.shift(); // Keep buffer sized
    }

    // Attempt diagnostic if we accumulate suddenly or enough time passed
    if (this.errorBuffer.length >= 5) {
      this.runDiagnostics().catch(() => {});
    }
  }

  /**
   * The core ML logic that analyzes recent system failures.
   */
  public async runDiagnostics(): Promise<void> {
    if (this.isDiagnosing || this.errorBuffer.length === 0) return;
    
    // Throttle diagnostics to avoid spam (once every 2 mins max per instance)
    if (Date.now() - this.lastDiagnosisTime < 120_000) return;

    this.isDiagnosing = true;
    this.lastDiagnosisTime = Date.now();
    
    const errorsToAnalyze = [...this.errorBuffer];
    this.errorBuffer = []; // clear buffer so we don't re-analyze the same ones next tick

    try {
      const diagnosis = await this.analyzeWithGemini(errorsToAnalyze);
      
      log.info(`[SRE Audit] Diagnosis Complete. Cause: ${diagnosis.rootCause}`);
      
      await this.applyFix(diagnosis);
    } catch (err) {
      log.error('Failed to run ML diagnostics', { error: (err as Error).message });
      // push back errors if we failed, but drop oldest
      this.errorBuffer = [...errorsToAnalyze.slice(-25), ...this.errorBuffer];
    } finally {
      this.isDiagnosing = false;
    }
  }

  private async analyzeWithGemini(errors: SystemError[]): Promise<DiagnosisAction> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured for Auto-Debug');

    const prompt = `You are the core SRE Diagnostician for the Trade AI.
Analyze the following batch of system errors and determine the root cause.
Classify the severity and recommend an explicit self-healing action.
If the error is temporary (like a slight network timeout), action is NONE or NOTIFY_ADMIN.
If the error is crippling (like invalid API keys, insufficient balance, IP whitelisting errors), action is ENTER_SAFE_MODE or HALT_TRADING.

ERRORS DUMP:
${JSON.stringify(errors, null, 2)}

Respond ONLY with a valid JSON matching this structure:
{
  "severity": "INFO"|"WARNING"|"CRITICAL"|"FATAL",
  "rootCause": "Short explanation of underlying cause",
  "recommendedAction": "NONE"|"NOTIFY_ADMIN"|"ENTER_SAFE_MODE"|"HALT_TRADING",
  "explanation": "Why this action is taken"
}`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { 
          maxOutputTokens: 300, 
          temperature: 0.2, 
          responseMimeType: 'application/json' 
        }
      })
    });

    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty Gemini response');

    return JSON.parse(text) as DiagnosisAction;
  }

  private async applyFix(diagnosis: DiagnosisAction): Promise<void> {
    // 1. Log the verdict
    if (diagnosis.severity === 'FATAL' || diagnosis.severity === 'CRITICAL') {
      log.error(`[AUTO-DEBUG FLUX] Sentinel Auto-Healing triggered: ${diagnosis.recommendedAction}. Reason: ${diagnosis.explanation}`, { cause: diagnosis.rootCause });
    }

    // 2. Persist to DB for transparency (so user can see SRE audits if needed)
    if (supabase) {
      supabase.from('syndicate_audits').insert({
        id: `sre-${Date.now()}`,
        timestamp: new Date().toISOString(),
        symbol: 'SYSTEM',
        signal: diagnosis.severity,
        weightedConfidence: 1,
        finalDecision: diagnosis.recommendedAction, // mapped to finalDecision
        masterOpinions: [{ masterId: 'AutoDebugEngine', direction: diagnosis.recommendedAction, confidence: 1, reasoning: diagnosis.explanation }]
      }).then(({ error }) => {
        if (error) log.error('SRE audit insert failed', { error: error.message });
      });
    }

    // 3. Take Physical Action
    if (diagnosis.recommendedAction === 'HALT_TRADING' || diagnosis.recommendedAction === 'ENTER_SAFE_MODE') {
       // Pull emergency stop through Sentinel
       const sentinel = SentinelGuard.getInstance();
       sentinel.triggerKillSwitch(`Auto-Debug Critical Anomaly: ${diagnosis.rootCause}`);
    } else if (diagnosis.recommendedAction === 'NOTIFY_ADMIN') {
       // Send telegram alert
       this.notifyTelegram(`⚠️ *SRE DIAGNOSIS*\n\n*Cause:* ${diagnosis.rootCause}\n*Explanation:* ${diagnosis.explanation}`);
    }
  }

  private async notifyTelegram(message: string): Promise<void> {
    try {
      await fetch(process.env.APP_URL + '/api/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
    } catch {
      // Background fail
    }
  }
}

export const autoDebugEngine = AutoDebugEngine.getInstance();
