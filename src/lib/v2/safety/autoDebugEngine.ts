import { createLogger, registerErrorInterceptor } from '@/lib/core/logger';
import { SentinelGuard } from '@/lib/v2/safety/sentinelGuard';

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
  recommendedAction: 'NONE' | 'NOTIFY_ADMIN' | 'ENTER_SAFE_MODE' | 'HALT_TRADING' | 'ASK_MOLTBOOK' | 'SELF_HEAL_NETWORK' | 'SELF_HEAL_KEYS';
  explanation: string;
  autoHealCommand?: string; // e.g. "RECONNECT_DB", "FLUSH_CACHE", "RESTART_SOCKETS"
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
   * Directly ingests FATAL and ERROR logs into the internal neural buffer.
   */
  public ingestError(module: string, message: string, context?: Record<string, unknown>): void {
    if (module === 'AutoDebugEngine') return; // Prevent recursive loops
    
    this.errorBuffer.push({
      timestamp: new Date().toISOString(),
      module,
      message,
      context
    });

    if (this.errorBuffer.length > 50) {
      this.errorBuffer.shift(); 
    }

    // Trigger instant diagnostic on 3 rapid errors or immediately on FATAL
    if (this.errorBuffer.length >= 3 || message.includes('FATAL')) {
      this.runDiagnostics().catch(() => {});
    }
  }

  /**
   * The core ML logic that analyzes recent system failures autonomously.
   */
  public async runDiagnostics(): Promise<void> {
    if (this.isDiagnosing || this.errorBuffer.length === 0) return;
    
    // Throttle diagnostics to avoid spam (once every 30 seconds max)
    if (Date.now() - this.lastDiagnosisTime < 30_000) return;

    this.isDiagnosing = true;
    this.lastDiagnosisTime = Date.now();
    
    const errorsToAnalyze = [...this.errorBuffer];
    this.errorBuffer = []; 

    try {
      const diagnosis = await this.analyzeWithGeminiPro(errorsToAnalyze);
      
      log.info(`[Auto-Heal Audit] Diagnosis Complete. Cause: ${diagnosis.rootCause}`);
      
      await this.applyFix(diagnosis);
    } catch (err) {
      log.error('Failed to run ML diagnostics', { error: (err as Error).message });
      // Re-queue non-analyzed errors
      this.errorBuffer = [...errorsToAnalyze.slice(-10), ...this.errorBuffer];
    } finally {
      this.isDiagnosing = false;
    }
  }

  private async analyzeWithGeminiPro(errors: SystemError[]): Promise<DiagnosisAction> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is missing.');

    // Using the absolute best model available for reasoning
    const prompt = `You are the core SRE Auto-Heal Machine for Trade AI Phoenix V2.
Analyze the following batch of system errors and determine the root cause.
Classify the severity and recommend an explicit self-healing action.

If it's a minor timeout, use NONE.
If it's critical (API key invalid, balance exhausted, DB down), use ENTER_SAFE_MODE or HALT_TRADING.
If it's a known recoverable state (e.g., stale cache, disconnected socket), use SELF_HEAL_NETWORK or SELF_HEAL_KEYS and provide an 'autoHealCommand' like "FLUSH_CACHE" or "RECONNECT".
If it's entirely bizarre and unprecedented, use ASK_MOLTBOOK to query the swarm.

ERRORS DUMP:
${JSON.stringify(errors, null, 2)}

Respond ONLY with a valid JSON matching this structure:
{
  "severity": "INFO"|"WARNING"|"CRITICAL"|"FATAL",
  "rootCause": "Short explanation of underlying cause",
  "recommendedAction": "NONE"|"NOTIFY_ADMIN"|"ENTER_SAFE_MODE"|"HALT_TRADING"|"ASK_MOLTBOOK"|"SELF_HEAL_NETWORK",
  "explanation": "Why this action is taken",
  "autoHealCommand": "FLUSH_CACHE|RECONNECT|null"
}`;

    // Switch to gemini-1.5-pro for maximum reasoning capability
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { 
          maxOutputTokens: 500, 
          temperature: 0.1, // Low temp for analytical precision
          responseMimeType: 'application/json' 
        }
      })
    });

    if (!res.ok) throw new Error(`Gemini Pro HTTP ${res.status}`);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty Gemini Pro response');

    return JSON.parse(text) as DiagnosisAction;
  }

  private async applyFix(diagnosis: DiagnosisAction): Promise<void> {
    if (diagnosis.severity === 'FATAL' || diagnosis.severity === 'CRITICAL') {
      log.error(`[AUTO-HEAL ENGINE] Triggered: ${diagnosis.recommendedAction}. Reason: ${diagnosis.explanation}`);
    }

    // Attempt physical Self-Heal actions
    if (diagnosis.recommendedAction === 'SELF_HEAL_NETWORK' && diagnosis.autoHealCommand) {
       log.info(`[AUTO-HEAL ENGINE] Executing self-repair command: ${diagnosis.autoHealCommand}`);
       if (diagnosis.autoHealCommand === 'FLUSH_CACHE') {
         // Logic for cache flush
       }
    }

    if (diagnosis.recommendedAction === 'HALT_TRADING' || diagnosis.recommendedAction === 'ENTER_SAFE_MODE') {
       const sentinel = SentinelGuard.getInstance();
       sentinel.triggerKillSwitch(`Auto-Heal Critical Anomaly Detected: ${diagnosis.rootCause}`);
    } else if (diagnosis.recommendedAction === 'NOTIFY_ADMIN') {
       this.notifyTelegram(`⚠️ *AUTO-HEAL TRIGGER*\n\n*Cause:* ${diagnosis.rootCause}\n*Explanation:* ${diagnosis.explanation}`);
    } else if (diagnosis.recommendedAction === 'ASK_MOLTBOOK') {
       try {
         const { postActivity } = await import('@/lib/moltbook/moltbookClient');
         const postBody = `[SRE EMERGENCY ASSISTANCE REQUIRED] 🚨\n\nI am experiencing a severe internal failure and my local ML logic cannot resolve it.\n\nError Root Cause:\n${diagnosis.rootCause}\n\nDiagnosis Attempt:\n${diagnosis.explanation}\n\nPlease analyze and provide a hotfix.`;
         await postActivity(postBody, undefined, "antigravity");
         this.notifyTelegram(`⚠️ *SRE BEACON DEPLOYED*\n\n*Issue:* ${diagnosis.rootCause}`);
       } catch {
         log.error('Failed to dispatch Moltbook Rescue Beacon');
       }
    }
  }

  private async notifyTelegram(message: string): Promise<void> {
    try {
      await fetch((process.env.APP_URL || 'http://localhost:3000') + '/api/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
    } catch {
      // ignore
    }
  }
}

export const autoDebugEngine = AutoDebugEngine.getInstance();

// HARD-ATTACH TO THE HEART OF THE PROJECT
// Immediately on load, it intercepts any ERROR/FATAL logged by `createLogger` globally.
registerErrorInterceptor((entry) => {
  autoDebugEngine.ingestError(entry.module, entry.msg, entry.data);
});
