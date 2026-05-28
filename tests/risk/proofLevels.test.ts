import { describe, expect, it } from "vitest";
import { proofLevelTitle, userDecisionFromInternal } from "../../src/risk/proofLevels";

describe("proof levels", () => {
  it("maps internal review states to user-facing decline for exchange UX", () => {
    expect(userDecisionFromInternal("REVIEW")).toBe("DECLINE");
    expect(userDecisionFromInternal("DECLINE")).toBe("DECLINE");
    expect(userDecisionFromInternal("ACCEPTABLE")).toBe("ACCEPTABLE");
  });

  it("keeps exact proof wording separate from policy wording", () => {
    expect(proofLevelTitle("exact_scam_or_taint_proof")).toBe("Exact scam/taint proof");
    expect(proofLevelTitle("exchange_policy_decline")).toBe("Exchange-policy decline");
    expect(proofLevelTitle("llm_assisted_suspicion")).toBe("AI-assisted suspicion");
    expect(proofLevelTitle("clean_source_proven")).toBe("Clean source proven");
  });
});
