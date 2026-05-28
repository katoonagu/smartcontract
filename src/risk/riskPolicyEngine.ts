import type {
  InternalExchangeDecision,
  PolicyReason,
  ProofLevel,
  RiskDecisionReasonCode,
  UserExchangeDecision
} from "../types";

export type RiskPolicySignal =
  | "exact_taint"
  | "approval_drain_exact"
  | "htx_huobi_source"
  | "whitebit_source"
  | "service_boundary"
  | "insufficient_coverage"
  | "llm_contract_suspicion"
  | "clean_cex_source";

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
  return Math.min(cap, values.reduce((sum, value) => sum + Math.max(0, value), 0));
}

function reason(code: RiskDecisionReasonCode, message: string): PolicyReason {
  return { code, message, evidenceIds: [] };
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
    riskScore,
    reasons
  };
}

export function decideRiskPolicy(input: ScoreComponents): PolicyDecision {
  if (input.signals.includes("exact_taint")) {
    return decision(
      "DECLINE",
      "DECLINE",
      "exact_scam_or_taint_proof",
      Math.max(input.taintScore, 90),
      [reason("internal_scam_label", "Exact scam/taint evidence was found.")]
    );
  }

  if (input.signals.includes("approval_drain_exact")) {
    return decision(
      "DECLINE",
      "DECLINE",
      "exact_approval_drain_provenance",
      Math.max(input.approvalDrainScore, 90),
      [reason("approval_drain_exact", "Exact approval-drain provenance was found.")]
    );
  }

  if (input.signals.includes("htx_huobi_source")) {
    return decision(
      "DECLINE",
      "DECLINE",
      "exchange_policy_decline",
      Math.max(input.moneyOriginScore, 78),
      [reason("htx_huobi_source", "Balance-forming path reaches HTX/Huobi source boundary.")]
    );
  }

  if (input.signals.includes("whitebit_source")) {
    return decision(
      "DECLINE",
      "DECLINE",
      "exchange_policy_decline",
      Math.max(input.moneyOriginScore, 35),
      [reason("whitebit_source", "Balance-forming path has WhiteBIT policy exposure.")]
    );
  }

  if (input.signals.includes("service_boundary")) {
    return decision(
      "DECLINE",
      "DECLINE",
      "exchange_policy_decline",
      Math.max(input.serviceBoundaryScore, 65),
      [reason("service_boundary", "Clean source is not proven after a service/contract boundary.")]
    );
  }

  if (input.signals.includes("insufficient_coverage")) {
    return decision(
      "REVIEW",
      "DECLINE",
      "insufficient_coverage",
      Math.max(input.coverageRiskScore, 65),
      [reason("insufficient_coverage", "Clean source is not proven due to limited coverage.")]
    );
  }

  if (input.signals.includes("llm_contract_suspicion")) {
    return decision(
      "REVIEW",
      "DECLINE",
      "llm_assisted_suspicion",
      Math.max(input.llmAssistedScore, input.contractRiskScore, 65),
      [reason("llm_contract_suspicion", "AI contract verdict indicates suspicious contract context.")]
    );
  }

  if (input.signals.includes("clean_cex_source")) {
    return decision(
      "ACCEPTABLE",
      "ACCEPTABLE",
      "clean_source_proven",
      Math.max(0, input.moneyOriginScore - input.dampenerScore),
      [reason("clean_cex_source", "Balance-forming path reaches allowlisted CEX through clean on-chain hops.")]
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
    Math.max(45, contextualScore - input.dampenerScore),
    [reason("insufficient_coverage", "Clean source is not proven.")]
  );
}
