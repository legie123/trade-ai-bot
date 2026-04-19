// ============================================================
// FAZA A BATCH 3 — Cron handler instrumentation wrapper
//
// Wraps a Next.js route handler so every cron tick records:
//   - tradeai_cron_runs_total{job, result}     (Counter)
//   - tradeai_cron_duration_seconds{job}       (Histogram)
//
// `result` heuristic from the Response status:
//   200..299 → ok
//   300..499 → skipped  (e.g. 401 unauthed, 304 noop, 200-with-skip-body still ok)
//   500..   → error
// Thrown exceptions also record `error` then re-throw.
//
// Fail-soft: metric inc/observe never throws (safeInc/safeObserve swallow).
// Zero-cost on the response — does not modify status / headers / body.
// ============================================================
import { metrics, safeInc, safeObserve } from './metrics';

type Handler = (request: Request) => Promise<Response>;

export function instrumentCron(job: string, handler: Handler): Handler {
  return async (request: Request) => {
    const startedAt = Date.now();
    try {
      const res = await handler(request);
      const durSec = (Date.now() - startedAt) / 1000;
      const status = res.status;
      const result = status >= 500 ? 'error' : status >= 300 ? 'skipped' : 'ok';
      safeInc(metrics.cronRuns, { job, result });
      safeObserve(metrics.cronDuration, durSec, { job });
      return res;
    } catch (e) {
      const durSec = (Date.now() - startedAt) / 1000;
      safeInc(metrics.cronRuns, { job, result: 'error' });
      safeObserve(metrics.cronDuration, durSec, { job });
      throw e;
    }
  };
}
