import type { ExchangeDecision, ProofLevel, UserExchangeDecision } from "../types";

export function userDecisionFromInternal(decision: ExchangeDecision): UserExchangeDecision {
  return decision === "ACCEPTABLE" ? "ACCEPTABLE" : "DECLINE";
}

export function proofLevelTitle(proofLevel: ProofLevel): string {
  switch (proofLevel) {
    case "exact_scam_or_taint_proof":
      return "Exact scam/taint proof";
    case "exact_approval_drain_provenance":
      return "Exact approval-drain provenance";
    case "exchange_policy_decline":
      return "Exchange-policy decline";
    case "exchange_policy_context":
      return "Exchange-policy context";
    case "insufficient_coverage":
      return "Insufficient coverage";
    case "llm_assisted_suspicion":
      return "AI-assisted suspicion";
    case "clean_source_proven":
      return "Clean source proven";
    case "operational_liquidity_context":
      return "Operational liquidity context";
  }
}
