import { describe, expect, it } from "vitest";
import { proofLevelTitle, userDecisionFromInternal } from "../../src/risk/proofLevels";

describe("proof levels", () => {
  it("keeps internal review as a user-facing review state", () => {
    expect(userDecisionFromInternal("REVIEW")).toBe("REVIEW");
    expect(userDecisionFromInternal("DECLINE")).toBe("DECLINE");
    expect(userDecisionFromInternal("ACCEPTABLE")).toBe("ACCEPTABLE");
  });

  it("keeps exact proof wording separate from policy wording", () => {
    expect(proofLevelTitle("exact_scam_or_taint_proof")).toBe("Exact scam/taint proof");
    expect(proofLevelTitle("exchange_policy_decline")).toBe("Exchange-policy decline");
    expect(proofLevelTitle("llm_assisted_suspicion")).toBe("AI-assisted suspicion");
    expect(proofLevelTitle("clean_source_proven")).toBe("Clean source proven");
    expect(proofLevelTitle("operational_liquidity_context")).toBe("Operational liquidity context");
  });
});
