import type { DeepAddressForensicReport } from "../check/deepForensicCheck";
import type {
  IncomingDepositRiskBand,
  IncomingDepositUnifiedRiskSummary,
  RiskReport,
  StablecoinRestrictionProfile,
  WhereIsMoneyReport
} from "../types";
import {
  calculateUnifiedForensicRisk,
  type UnifiedForensicRiskResult
} from "./unifiedWalletRisk";

export type CalculateUnifiedIncomingDepositRiskInput = {
  senderAddress: string;
  receiverAddress: string;
  txHash: string;
  amountRaw: string;
  timestamp: Date;
  fastSenderRisk: RiskReport | null;
  senderStablecoinState: StablecoinRestrictionProfile | null;
  whereReport: WhereIsMoneyReport;
  deepReport?: DeepAddressForensicReport | null;
};

export function incomingRiskBandFromUnifiedScore(score: number): IncomingDepositRiskBand {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 45) return "MEDIUM";
  if (score >= 20) return "LOW-MEDIUM";
  return "LOW";
}

function fastRiskWithSenderBlacklist(
  fastSenderRisk: RiskReport | null,
  senderAddress: string,
  senderStablecoinState: StablecoinRestrictionProfile | null
): RiskReport | null {
  if (!senderStablecoinState?.isBlacklisted) return fastSenderRisk;

  const base: RiskReport = fastSenderRisk ?? {
    subjectAddress: senderAddress,
    level: "LOW",
    score: 0,
    reasons: []
  };

  return {
    ...base,
    level: "CRITICAL",
    score: Math.max(base.score, 95),
    reasons: [
      ...base.reasons,
      {
        code: "stablecoin_usdt_blacklisted",
        message: "Official TRON USDT contract blacklist state is active for the incoming deposit sender.",
        scoreImpact: 95,
        source: "stablecoin_contract",
        confidence: "high",
        severity: "critical"
      }
    ]
  };
}

export function calculateUnifiedIncomingDepositRisk(
  input: CalculateUnifiedIncomingDepositRiskInput
): UnifiedForensicRiskResult {
  return calculateUnifiedForensicRisk({
    subject: {
      scope: "incoming_deposit",
      senderAddress: input.senderAddress,
      receiverAddress: input.receiverAddress,
      txHash: input.txHash,
      amountRaw: input.amountRaw,
      timestamp: input.timestamp
    },
    fastReport: fastRiskWithSenderBlacklist(
      input.fastSenderRisk,
      input.senderAddress,
      input.senderStablecoinState
    ),
    deepReport: input.deepReport,
    whereReport: input.whereReport
  });
}

export function incomingUnifiedRiskSummary(
  result: UnifiedForensicRiskResult
): IncomingDepositUnifiedRiskSummary {
  return {
    finalScore: result.finalScore,
    finalLevel: result.finalLevel,
    finalDecision: result.finalDecision,
    hardEvidenceFloor: result.hardEvidenceFloor,
    policyFloor: result.policyFloor,
    assetContinuationFloor: result.assetContinuationFloor,
    patternFloor: result.patternFloor,
    dampener: result.dampener,
    activeAnchor: result.scoreBreakdown.activeAnchor
  };
}
