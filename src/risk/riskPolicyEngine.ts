import type {
  InternalExchangeDecision,
  PolicyReason,
  ProofLevel,
  RiskDecisionReasonCode,
  UserExchangeDecision
} from "../types";

export type RiskPolicySignalCode =
  | "exact_taint"
  | "approval_drain_exact"
  | "htx_huobi_source"
  | "whitebit_source"
  | "service_boundary"
  | "insufficient_coverage"
  | "llm_contract_suspicion"
  | "clean_cex_source";

export type RiskPolicySignal = RiskPolicySignalCode | {
  code: RiskPolicySignalCode;
  evidenceIds?: string[];
};

export type ScoreComponents = {
  taintScore: number;
  approvalDrainScore: number;
  moneyOriginScore: number;
  serviceBoundaryScore: number;
  contractRiskScore: number;
  operationalPatternScore: number;
  fastWalletScore: number;
  coverageRiskScore: number;
  llmAssistedScore: number;
  dampenerScore: number;
  signals: RiskPolicySignal[];
};

export type PolicyDecision = {
  internalDecision: InternalExchangeDecision;
  userDecision: UserExchangeDecision;
  proofLevel: ProofLevel;
  riskScore: number;
  reasons: PolicyReason[];
};

function cappedSum(values: number[], cap: number): number {
  return Math.min(cap, values.reduce((sum, value) => sum + boundedScore(value), 0));
}

function boundedScore(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreAtLeast(value: number, minimum: number): number {
  return Math.max(boundedScore(value), minimum);
}

function signalCode(signal: RiskPolicySignal): RiskPolicySignalCode {
  return typeof signal === "string" ? signal : signal.code;
}

function hasSignal(signals: RiskPolicySignal[], code: RiskPolicySignalCode): boolean {
  return signals.some((signal) => signalCode(signal) === code);
}

function evidenceIdsFor(signals: RiskPolicySignal[], code: RiskPolicySignalCode): string[] {
  return signals.flatMap((signal) => {
    if (typeof signal === "string" || signal.code !== code) return [];
    return signal.evidenceIds ?? [];
  });
}

function reason(
  input: ScoreComponents,
  code: RiskDecisionReasonCode,
  message: string,
  signal: RiskPolicySignalCode = code as RiskPolicySignalCode
): PolicyReason {
  return { code, message, evidenceIds: evidenceIdsFor(input.signals, signal) };
}

function decision(
  internalDecision: InternalExchangeDecision,
  userDecision: UserExchangeDecision,
  proofLevel: ProofLevel,
  riskScore: number,
  reasons: PolicyReason[]
): PolicyDecision {
  return {
    internalDecision,
    userDecision,
    proofLevel,
    riskScore: boundedScore(riskScore),
    reasons
  };
}

export function decideRiskPolicy(input: ScoreComponents): PolicyDecision {
  if (hasSignal(input.signals, "exact_taint")) {
    return decision(
      "DECLINE",
      "DECLINE",
      "exact_scam_or_taint_proof",
      scoreAtLeast(input.taintScore, 90),
      [reason(input, "internal_scam_label", "Exact scam/taint evidence was found.", "exact_taint")]
    );
  }

  if (hasSignal(input.signals, "approval_drain_exact")) {
    return decision(
      "DECLINE",
      "DECLINE",
      "exact_approval_drain_provenance",
      scoreAtLeast(input.approvalDrainScore, 90),
      [reason(input, "approval_drain_exact", "Exact approval-drain provenance was found.")]
    );
  }

  if (hasSignal(input.signals, "htx_huobi_source")) {
    return decision(
      "DECLINE",
      "DECLINE",
      "exchange_policy_decline",
      scoreAtLeast(input.moneyOriginScore, 78),
      [reason(input, "htx_huobi_source", "Balance-forming path reaches HTX/Huobi source boundary.")]
    );
  }

  if (hasSignal(input.signals, "whitebit_source")) {
    return decision(
      "DECLINE",
      "DECLINE",
      "exchange_policy_decline",
      scoreAtLeast(input.moneyOriginScore, 35),
      [reason(input, "whitebit_source", "Balance-forming path has WhiteBIT policy exposure.")]
    );
  }

  if (hasSignal(input.signals, "service_boundary")) {
    return decision(
      "DECLINE",
      "DECLINE",
      "exchange_policy_decline",
      scoreAtLeast(input.serviceBoundaryScore, 65),
      [reason(input, "service_boundary", "Clean source is not proven after a service/contract boundary.")]
    );
  }

  if (hasSignal(input.signals, "insufficient_coverage")) {
    return decision(
      "REVIEW",
      "DECLINE",
      "insufficient_coverage",
      scoreAtLeast(input.coverageRiskScore, 65),
      [reason(input, "insufficient_coverage", "Clean source is not proven due to limited coverage.")]
    );
  }

  if (hasSignal(input.signals, "llm_contract_suspicion")) {
    return decision(
      "REVIEW",
      "DECLINE",
      "llm_assisted_suspicion",
      Math.max(boundedScore(input.llmAssistedScore), boundedScore(input.contractRiskScore), 65),
      [reason(input, "llm_contract_suspicion", "AI contract verdict indicates suspicious contract context.")]
    );
  }

  if (hasSignal(input.signals, "clean_cex_source")) {
    return decision(
      "ACCEPTABLE",
      "ACCEPTABLE",
      "clean_source_proven",
      Math.max(0, boundedScore(input.moneyOriginScore) - boundedScore(input.dampenerScore)),
      [reason(input, "clean_cex_source", "Balance-forming path reaches allowlisted CEX through clean on-chain hops.")]
    );
  }

  const contextualScore = cappedSum([
    input.moneyOriginScore,
    input.serviceBoundaryScore,
    input.contractRiskScore,
    input.operationalPatternScore,
    input.fastWalletScore,
    input.coverageRiskScore,
    input.llmAssistedScore
  ], 85);

  return decision(
    "REVIEW",
    "DECLINE",
    "insufficient_coverage",
    Math.max(45, contextualScore - boundedScore(input.dampenerScore)),
    [reason(input, "insufficient_coverage", "Clean source is not proven.")]
  );
}
