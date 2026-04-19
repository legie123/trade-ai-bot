// ============================================================
// /api/v2/diag/meta-label — FAZA 3 Batch 7/9
// ============================================================
// Diagnostic endpoint for meta-label stub predictor. PURE READ/COMPUTE.
// No writes, no decision impact.
//
// GET  → returns config + canonical scenarios evaluated with current
//        weights. Operators can sanity-check the stub without a live
//        signal.
// POST → body = Partial<MetaLabelFeatures> (see metaLabel.ts).
//        Returns full prediction + breakdown for that feature set.
//        Optional `threshold` override in body.
//
// Examples:
//   curl .../api/v2/diag/meta-label
//   curl -X POST .../api/v2/diag/meta-label \
//     -H 'content-type: application/json' \
//     -d '{"primaryConfidence":0.75,"microMlProb":0.7,"wilsonLowerWr":0.55,
//          "regimeMatch":1,"sentimentOk":1,"sizingMult":1.2,"sampleMaturity":0.8}'
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  predict,
  getMetaLabelConfig,
  CANONICAL_SCENARIOS,
  type MetaLabelFeatures,
} from '@/lib/v2/ml/metaLabel';
import { createLogger } from '@/lib/core/logger';

export const dynamic = 'force-dynamic';

const log = createLogger('DiagMetaLabel');

export async function GET() {
  try {
    const config = getMetaLabelConfig();
    const scenarios = CANONICAL_SCENARIOS.map((s) => ({
      name: s.name,
      features: s.features,
      prediction: predict(s.features),
    }));

    // Separation check: HIGH should have prob > NEUTRAL > LOW.
    // If not, weights are mis-tuned and the stub's signal is noise.
    const probs = scenarios.map((s) => s.prediction.prob);
    const monotonic =
      probs[0] > probs[1] && probs[1] > probs[2]; // HIGH > NEUTRAL > LOW

    return NextResponse.json({
      success: true,
      config,
      scenarios,
      sanity: {
        monotonic,
        note: monotonic
          ? 'HIGH > NEUTRAL > LOW as expected.'
          : 'Stub weights do not separate canonical scenarios — review W constants in metaLabel.ts.',
      },
    });
  } catch (err) {
    log.error('diag/meta-label GET failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

interface PostBody extends MetaLabelFeatures {
  threshold?: number;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as PostBody;
    const { threshold, ...features } = body ?? {};

    // Light validation: reject obviously out-of-range continuous inputs.
    // We accept 0..1 for probs/rates, 0..2 for sizingMult (aggregator can
    // theoretically exceed cap if caller overrides; log but don't throw).
    const violations: string[] = [];
    const in01 = (x: number | undefined, name: string) => {
      if (x === undefined) return;
      if (!Number.isFinite(x) || x < 0 || x > 1) violations.push(`${name}=${x}∉[0,1]`);
    };
    in01(features.primaryConfidence, 'primaryConfidence');
    in01(features.microMlProb, 'microMlProb');
    in01(features.wilsonLowerWr, 'wilsonLowerWr');
    in01(features.sampleMaturity, 'sampleMaturity');
    if (features.sizingMult !== undefined) {
      if (!Number.isFinite(features.sizingMult) || features.sizingMult < 0 || features.sizingMult > 3) {
        violations.push(`sizingMult=${features.sizingMult}∉[0,3]`);
      }
    }

    const prediction = predict(features, threshold);

    return NextResponse.json({
      success: true,
      mode: prediction.mode,
      features,
      prediction,
      ...(violations.length > 0
        ? { warnings: violations, note: 'Input out of expected range; stub will clamp but result may be misleading.' }
        : {}),
    });
  } catch (err) {
    log.error('diag/meta-label POST failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
