import type {
  ContractLlmVerdictSummary,
  IncomingDepositHardBadEvidence,
  IncomingDepositOriginPath,
  IncomingDepositRiskBand,
  IncomingDepositRiskReport,
  RiskReport
} from "../types";

export type BuildIncomingDepositRiskReportInput = {
  depositTxHash: string;
  watchedWallet: string;
  sender: string;
  amountRaw: string;
  fastSenderRisk: RiskReport | null;
  originPaths: IncomingDepositOriginPath[];
  originCoverage: number;
  senderRole: string | null;
  senderCurrentBalanceRaw: string | null;
  contractVerdicts: ContractLlmVerdictSummary[];
  warnings: string[];
};

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function rawUsdt(value: string): number {
  if (!/^\d+$/.test(value)) return 0;
  return Number(BigInt(value) / 1_000_000n);
}

function band(score: number): IncomingDepositRiskBand {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 45) return "MEDIUM";
  if (score >= 20) return "LOW-MEDIUM";
  return "LOW";
}

function highestPathRisk(paths: IncomingDepositOriginPath[]): number {
  return Math.max(0, ...paths.map((path) => path.score));
}

function hardEvidence(
  paths: IncomingDepositOriginPath[],
  verdicts: ContractLlmVerdictSummary[],
  fast: RiskReport | null
): IncomingDepositHardBadEvidence[] {
  const evidence: IncomingDepositHardBadEvidence[] = [];
  if (fast && fast.score >= 85) {
    evidence.push({
      kind: "scam_or_blacklist",
      score: fast.score,
      message: `Fast sender check has critical score ${fast.score}/100.`,
      evidenceIds: fast.reasons.map((reason) => reason.evidenceRef ?? reason.code)
    });
  }
  for (const path of paths) {
    if (path.stoppedReason === "htx_huobi_reached") {
      evidence.push({
        kind: "htx_huobi_source",
        score: Math.max(78, path.score),
        message: path.reasons[0] ?? "Deposit path reaches HTX/Huobi.",
        evidenceIds: path.txHashes
      });
    }
    if (path.stoppedReason === "bridge_router_dex_reached") {
      evidence.push({
        kind: "bridge_router_dex_boundary",
        score: Math.max(70, path.score),
        message: path.reasons[0] ?? "Deposit path reaches bridge/router/DEX.",
        evidenceIds: path.txHashes
      });
    }
  }
  for (const verdict of verdicts) {
    if (
      verdict.verdict === "drainer_like" &&
      verdict.decisionRecommendation === "DECLINE" &&
      (verdict.confidence >= 0.75 || verdict.contractRiskScore >= 90)
    ) {
      evidence.push({
        kind: "llm_contract_suspicion",
        score: Math.max(85, verdict.contractRiskScore),
        message: `LLM contract verdict is drainer_like with score ${verdict.contractRiskScore}/100.`,
        evidenceIds: verdict.citedEvidenceIds
      });
    }
  }
  return evidence.sort((left, right) => right.score - left.score);
}

function provenanceConfidence(paths: IncomingDepositOriginPath[], originCoverage: number): number {
  const cleanShare = paths.some((path) => path.stoppedReason === "clean_cex_reached") ? 50 : 0;
  const continuityBonus = Math.max(
    0,
    ...paths.map((path) => (path.amountContinuity === "strong" ? 20 : path.amountContinuity === "medium" ? 10 : 0))
  );
  return clamp(20 + originCoverage * 30 + cleanShare + continuityBonus);
}

function dataQuality(paths: IncomingDepositOriginPath[], coverage: number): "low" | "medium" | "high" {
  if (coverage >= 0.85 && paths.length > 0) return "high";
  if (coverage >= 0.45) return "medium";
  return "low";
}

function isOperational(role: string | null): boolean {
  return role === "operational_liquidity_wallet" || role === "clean_cex_funded_wallet";
}

function hasUnknownContract(paths: IncomingDepositOriginPath[]): boolean {
  return paths.some((path) => path.stoppedReason === "unknown_contract_reached");
}

function hasSuspiciousUnknownContract(verdicts: ContractLlmVerdictSummary[]): boolean {
  return verdicts.some(
    (verdict) =>
      verdict.decisionRecommendation === "DECLINE" &&
      (verdict.verdict === "unknown_suspicious" || verdict.verdict === "drainer_like")
  );
}

function hasMaterialCloseWhitebitPath(paths: IncomingDepositOriginPath[], amount: number): boolean {
  return paths.some((path) =>
    path.stoppedReason === "whitebit_reached" &&
    path.proximityHops <= 2 &&
    path.amountCoverageRatio >= 0.5 &&
    amount >= 10_000
  );
}

export function buildIncomingDepositRiskReport(input: BuildIncomingDepositRiskReportInput): IncomingDepositRiskReport {
  const hard = hardEvidence(input.originPaths, input.contractVerdicts, input.fastSenderRisk);
  const confidence = provenanceConfidence(input.originPaths, input.originCoverage);
  const quality = dataQuality(input.originPaths, input.originCoverage);
  const topHard = hard[0] ?? null;

  if (topHard) {
    const score = clamp(Math.max(topHard.score, highestPathRisk(input.originPaths)));
    return {
      decision: "DECLINE",
      depositRiskScore: score,
      riskBand: band(score),
      fastSenderRisk: input.fastSenderRisk,
      originPaths: input.originPaths,
      originCoverage: input.originCoverage,
      provenanceConfidence: confidence,
      dataQuality: quality,
      senderRole: input.senderRole,
      hardBadEvidence: hard,
      contractVerdicts: input.contractVerdicts,
      reasons: [topHard.message],
      warnings: input.warnings
    };
  }

  const amount = rawUsdt(input.amountRaw);
  const unknownContractRisk = hasUnknownContract(input.originPaths);
  const suspiciousContract = hasSuspiciousUnknownContract(input.contractVerdicts);
  const freshOneShot = input.senderRole === "fresh_one_shot_wallet" || input.senderRole === "unknown_wallet";

  if (hasMaterialCloseWhitebitPath(input.originPaths, amount)) {
    const score = clamp(Math.max(52, highestPathRisk(input.originPaths), input.fastSenderRisk?.score ?? 0));
    return {
      decision: "DECLINE",
      depositRiskScore: score,
      riskBand: band(score),
      fastSenderRisk: input.fastSenderRisk,
      originPaths: input.originPaths,
      originCoverage: input.originCoverage,
      provenanceConfidence: confidence,
      dataQuality: quality,
      senderRole: input.senderRole,
      hardBadEvidence: [],
      contractVerdicts: input.contractVerdicts,
      reasons: ["Deposit has close WhiteBIT provenance covering a material share; WhiteBIT is medium policy risk, not hard scam proof."],
      warnings: input.warnings
    };
  }

  if ((unknownContractRisk || suspiciousContract) && freshOneShot && amount >= 10_000) {
    const score = clamp(
      Math.max(60, highestPathRisk(input.originPaths), ...input.contractVerdicts.map((verdict) => verdict.contractRiskScore))
    );
    return {
      decision: "DECLINE",
      depositRiskScore: score,
      riskBand: band(score),
      fastSenderRisk: input.fastSenderRisk,
      originPaths: input.originPaths,
      originCoverage: input.originCoverage,
      provenanceConfidence: confidence,
      dataQuality: quality,
      senderRole: input.senderRole,
      hardBadEvidence: [],
      contractVerdicts: input.contractVerdicts,
      reasons: ["Large deposit has close unknown contract funding and sender is not established as operational liquidity."],
      warnings: input.warnings
    };
  }

  if (isOperational(input.senderRole)) {
    const score = clamp(Math.min(40, Math.max(25, 25 + Math.max(0, 70 - confidence) * 0.15 + Math.max(0, 0.7 - input.originCoverage) * 15)));
    return {
      decision: "ACCEPTABLE",
      depositRiskScore: score,
      riskBand: band(score),
      fastSenderRisk: input.fastSenderRisk,
      originPaths: input.originPaths,
      originCoverage: input.originCoverage,
      provenanceConfidence: confidence,
      dataQuality: quality,
      senderRole: input.senderRole,
      hardBadEvidence: [],
      contractVerdicts: input.contractVerdicts,
      reasons: ["Sender looks like an operational/liquidity wallet and no hard bad evidence was found."],
      warnings: input.warnings
    };
  }

  const unresolvedScore = clamp(Math.max(45, highestPathRisk(input.originPaths), input.fastSenderRisk?.score ?? 0));
  return {
    decision: unresolvedScore >= 45 ? "DECLINE" : "ACCEPTABLE",
    depositRiskScore: unresolvedScore,
    riskBand: band(unresolvedScore),
    fastSenderRisk: input.fastSenderRisk,
    originPaths: input.originPaths,
    originCoverage: input.originCoverage,
    provenanceConfidence: confidence,
    dataQuality: quality,
    senderRole: input.senderRole,
    hardBadEvidence: [],
    contractVerdicts: input.contractVerdicts,
    reasons: ["Clean source is not proven and sender does not match the operational/liquidity profile."],
    warnings: input.warnings
  };
}
