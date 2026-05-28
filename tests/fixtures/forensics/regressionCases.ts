export const regressionCases = [
  {
    name: "Binance through clean EOA is acceptable",
    expectedDecision: "ACCEPTABLE",
    expectedProofLevel: "clean_source_proven"
  },
  {
    name: "HTX through clean EOA is high policy decline",
    expectedDecision: "DECLINE",
    expectedProofLevel: "exchange_policy_decline"
  },
  {
    name: "WhiteBIT small share is medium policy decline",
    expectedDecision: "DECLINE",
    expectedProofLevel: "exchange_policy_decline"
  },
  {
    name: "Unknown contract boundary is policy decline not scam proof",
    expectedDecision: "DECLINE",
    expectedProofLevel: "exchange_policy_decline"
  },
  {
    name: "Known DEX router approval with output is guarded, not drainer proof",
    expectedDecision: "DECLINE",
    expectedProofLevel: "exchange_policy_decline"
  },
  {
    name: "Wrapper transferFrom path to checked wallet is exact approval-drain decline",
    expectedDecision: "DECLINE",
    expectedProofLevel: "exact_approval_drain_provenance"
  },
  {
    name: "LLM timeout on uncertain contract is user decline with no cache",
    expectedDecision: "DECLINE",
    expectedProofLevel: "insufficient_coverage"
  },
  {
    name: "Fingerprint clone with different flow does not reuse drainer verdict",
    expectedDecision: "DECLINE",
    expectedProofLevel: "exchange_policy_decline"
  }
] as const;
