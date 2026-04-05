import { SentinelStatus } from '../../types/gladiator';

export class SentinelGuard {
  private globalStatus: SentinelStatus = 'SAFE';

  public evaluateRisk(drawdown: number, rapidRequests: number): SentinelStatus {
    if (rapidRequests > 100) return 'HALTED'; // Anti-whale / API attack
    if (drawdown > 15) return 'CRITICAL';
    if (drawdown > 5) return 'WARNING';
    return 'SAFE';
  }

  public engageKillSwitch(): void {
    this.globalStatus = 'HALTED';
  }

  public disengageKillSwitch(): void {
    this.globalStatus = 'SAFE';
  }

  public getStatus(): SentinelStatus {
    return this.globalStatus;
  }

  public validateTrade(): SentinelStatus {
    return this.globalStatus;
  }
}

