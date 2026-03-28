import { NextResponse } from 'next/server';
import { runGlobalConsensusAudit } from '@/lib/engine/consensusAudit';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('ConsensusAPI');

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const scores = runGlobalConsensusAudit();
    
    const overview = {
      approved: scores.filter(s => s.verdict === 'active approved').length,
      probation: scores.filter(s => s.verdict === 'approved with caution / probation').length,
      cooldown: scores.filter(s => s.verdict === 'cooldown').length,
      retired: scores.filter(s => s.verdict === 'retired').length,
      premiumCandidate: scores.filter(s => s.verdict === 'premium candidate').length,
      premiumConfirmed: scores.filter(s => s.verdict === 'premium confirmed').length,
      unverified: scores.filter(s => s.verdict === 'NEVERIFICAT').length,
    };

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      overview,
      strategies: scores,
    });
  } catch (err) {
    log.error('Consensus Audit failed', { error: String(err) });
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
